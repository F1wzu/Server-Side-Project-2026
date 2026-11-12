const { randomBytes } = require('node:crypto');
const bcrypt = require('bcrypt');
const prisma = require('../config/db');
const env = require('../config/env');
const AppError = require('../utils/AppError');

// Cost 12 takes about a quarter of a second per hash, which is what slows
// down password guessing. The tests use the minimum so they stay fast.
const BCRYPT_COST = env.isTest ? 4 : 12;

// The only columns that ever leave this file. password_hash is not one of them.
const publicFields = { id: true, username: true, email: true, role: true, createdAt: true };

const emailTaken = () =>
  new AppError(409, 'EMAIL_TAKEN', 'อีเมลนี้ถูกใช้สมัครสมาชิกแล้ว', [{ field: 'email', message: 'อีเมลนี้ถูกใช้สมัครสมาชิกแล้ว' }]);

// Creates a member. The role is never taken from user input.
async function register({ username, email, password }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  try {
    return await prisma.user.create({ data: { username, email, passwordHash }, select: publicFields });
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
// version (which never leaves the server).
function findForSession(id) {
  return prisma.user.findUnique({ where: { id }, select: { ...publicFields, sessionVersion: true } });
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

function emailExists(email) {
  return prisma.user.findUnique({ where: { email }, select: { id: true } }).then(Boolean);
}

module.exports = { register, authenticate, findById, findForSession, updateUsername, changePassword, endOtherSessions, createOrPromoteAdmin, emailExists };
