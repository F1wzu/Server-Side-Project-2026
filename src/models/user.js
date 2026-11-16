const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const prisma = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { POLICY_VERSION } = require('../config/policy');
const { recalculateRating } = require('./review');
const { unusedUploads, photoPathsOf } = require('./photoUsage');

// Cost 12 takes about a quarter of a second per hash, which is what slows
// down password guessing. The tests use the minimum so they stay fast.
const BCRYPT_COST = env.isTest ? 4 : 12;

// The only columns that ever leave this file. password_hash is not one of them.
const publicFields = { id: true, username: true, email: true, role: true, createdAt: true };

const emailTaken = () =>
  new AppError(409, 'EMAIL_TAKEN', 'อีเมลนี้ถูกใช้สมัครสมาชิกแล้ว', [{ field: 'email', message: 'อีเมลนี้ถูกใช้สมัครสมาชิกแล้ว' }]);

// Creates a member. The role is never taken from user input. Registering
// requires accepting the privacy policy (validation/auth.js), so the moment
// and the policy version are recorded with the account.
async function register({ username, email, password }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  try {
    return await prisma.user.create({
      data: { username, email, passwordHash, policyAcceptedAt: new Date(), policyVersion: POLICY_VERSION },
      select: publicFields,
    });
  } catch (err) {
    if (err.code === 'P2002') throw emailTaken();
    throw err;
  }
}

// A hash of a random password, compared against when the email is unknown,
// so a wrong email takes as long to answer as a wrong password.
let dummyHash;

// Returns the user when the email and password match; otherwise throws the
// same error for an unknown email and for a wrong password.
async function authenticate(email, password) {
  const user = await prisma.user.findUnique({ where: { email } });
  dummyHash ??= await bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_COST);
  const matches = await bcrypt.compare(password, user ? user.passwordHash : dummyHash);

  if (!user || !matches) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
  return findById(user.id);
}

function findById(id) {
  return prisma.user.findUnique({ where: { id }, select: publicFields });
}

// The account as the login check needs it: public fields plus the session
// version and the suspension columns (neither leaves the server as raw
// columns; middleware/auth.js turns the suspension into req.user.suspension).
function findForSession(id) {
  return prisma.user.findUnique({
    where: { id },
    select: { ...publicFields, sessionVersion: true, suspendedAt: true, suspendedUntil: true, suspendedReason: true },
  });
}

function updateUsername(id, username) {
  return prisma.user.update({ where: { id }, data: { username }, select: publicFields });
}

// Replaces the password after checking the current one.
async function changePassword(id, { currentPassword, newPassword }) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw AppError.notFound();

  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'รหัสผ่านเดิมไม่ถูกต้อง', [{ field: 'currentPassword', message: 'รหัสผ่านเดิมไม่ถูกต้อง' }]);
  }
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  // Raising the session version logs out every session made before this
  // moment (see middleware/auth.js), including ones a running request might
  // still write back after they were deleted.
  await prisma.user.update({ where: { id }, data: { passwordHash, sessionVersion: { increment: 1 } } });
}

// Logs the account out everywhere except the session that is kept.
// Used after a password change, so a stolen session stops working.
function endOtherSessions(id, keepSessionId) {
  return prisma.$executeRaw`
    DELETE FROM sessions
    WHERE (sess ->> 'userId')::int = ${id} AND sid <> ${keepSessionId}`;
}

// Used only by scripts/create-admin.js. Creates an admin account, or turns
// an existing account with that email into an admin (its password is kept).
async function createOrPromoteAdmin({ username, email, password }) {
  const existing = await prisma.user.findUnique({ where: { email }, select: publicFields });
  if (existing) {
    const user = await prisma.user.update({ where: { id: existing.id }, data: { role: 'admin' }, select: publicFields });
    return { user, created: false };
  }
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const user = await prisma.user.create({ data: { username, email, passwordHash, role: 'admin' }, select: publicFields });
  return { user, created: true };
}

// The name shown where a deleted account's past activity stays visible
// (an approved submission's history, an admin's report list).
const DELETED_NAME = 'ผู้ใช้ที่ลบบัญชี';

// Deletes a member's own account after checking their password.
//
// The users row cannot simply be deleted: approved submissions, their
// history and closed reports keep pointing at it (and must, for the places
// they created). So the account is emptied instead, in one transaction:
// - reviews and replies are taken down (status "deleted", as if the member
//   deleted each one) and the ratings of those places recalculated;
// - saved places and undecided submissions are deleted;
// - the row keeps no personal data: the name becomes DELETED_NAME, the email a
//   placeholder (so the real address can register again), the password a hash
//   of random bytes nobody knows, and every session is ended.
// Admins are refused: the site must never lose its last admin by accident,
// and an admin account is removed by whoever runs the database.
// Returns the photo files nothing uses any more, for the caller to delete.
async function deleteAccount(id, password) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw AppError.notFound();
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'รหัสผ่านไม่ถูกต้อง', [{ field: 'password', message: 'รหัสผ่านไม่ถูกต้อง' }]);
  }
  if (user.role === 'admin') {
    throw new AppError(409, 'INVALID_STATE', 'บัญชีผู้ดูแลลบจากหน้าเว็บไม่ได้ กรุณาติดต่อผู้ดูแลระบบฐานข้อมูล');
  }
  const unusable = await bcrypt.hash(randomBytes(32).toString('hex'), BCRYPT_COST);

  return prisma.$transaction(async (tx) => {
    // Lock every place the member has an active review on, in id order (so two
    // such transactions cannot deadlock), the same lock reviews take.
    const reviewed = await tx.review.findMany({ where: { userId: id, status: 'active' }, select: { placeId: true }, orderBy: { placeId: 'asc' } });
    const placeIds = reviewed.map((review) => review.placeId);
    for (const placeId of placeIds) await tx.$queryRaw`SELECT id FROM places WHERE id = ${placeId} FOR UPDATE`;
    await tx.review.updateMany({ where: { userId: id, status: 'active' }, data: { status: 'deleted' } });
    for (const placeId of placeIds) await recalculateRating(tx, placeId);
    await tx.reviewReply.updateMany({ where: { userId: id, status: 'active' }, data: { status: 'deleted' } });
    await tx.favorite.deleteMany({ where: { userId: id } });

    const undecided = await tx.submission.findMany({
      where: { userId: id, status: { in: ['draft', 'pending', 'changes_requested'] } },
      select: { id: true, imagePath: true, extraImagePaths: true, events: { select: { snapshot: true } } },
    });
    await tx.submission.deleteMany({ where: { id: { in: undecided.map((submission) => submission.id) } } });
    const paths = undecided.flatMap((submission) => [...photoPathsOf(submission), ...submission.events.flatMap((event) => photoPathsOf(event.snapshot))]);

    await tx.user.update({
      where: { id },
      data: { username: DELETED_NAME, email: `deleted-${id}@deleted.invalid`, passwordHash: unusable, sessionVersion: { increment: 1 } },
    });
    await tx.$executeRaw`DELETE FROM sessions WHERE (sess ->> 'userId')::int = ${id}`;
    return { unusedFiles: await unusedUploads(tx, paths) };
  });
}

function emailExists(email) {
  return prisma.user.findUnique({ where: { email }, select: { id: true } }).then(Boolean);
}

module.exports = { register, authenticate, findById, findForSession, updateUsername, changePassword, endOtherSessions, createOrPromoteAdmin, emailExists, deleteAccount, DELETED_NAME };
