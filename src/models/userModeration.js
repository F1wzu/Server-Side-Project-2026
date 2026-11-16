// Admin moderation of members: the member list, one member, suspend and
// unsuspend. A suspension is stored on the users row (suspended_at/until/
// reason) and every change is also written to user_moderation_events, so the
// history stays after the suspension is lifted. Enforcement is in
// middleware/suspension.js.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { paginate } = require('../utils/pagination');
const { activeSuspension } = require('../utils/suspension');
const { DELETED_NAME } = require('./user');

const STATUSES = ['all', 'suspended', 'active'];
const DAY_MS = 24 * 60 * 60 * 1000;

// In a LIKE pattern % and _ are wildcards: escape them so "%" is not "everything".
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// A deleted account stays in the table, emptied (models/user.js deleteAccount):
// the name is DELETED_NAME and the email is deleted-<id>@deleted.invalid. All
// three marks must match, so a member who merely picks that name is not hidden.
const LIVE = {
  NOT: {
    username: DELETED_NAME,
    email: { startsWith: 'deleted-', endsWith: '@deleted.invalid' },
  },
};

const suspendedNow = (now) => ({ suspendedAt: { not: null }, OR: [{ suspendedUntil: null }, { suspendedUntil: { gt: now } }] });

const notFound = () => AppError.notFound('ไม่พบสมาชิกนี้');

// Row shape for the list and the detail.
const rowSelect = {
  id: true,
  username: true,
  email: true,
  role: true,
  createdAt: true,
  suspendedAt: true,
  suspendedUntil: true,
  suspendedReason: true,
  _count: {
    select: {
      reviews: { where: { status: 'active' } },
      submissions: true,
    },
  },
};

// Reviews and replies an admin took down, per member: one grouped query each.
async function removedCounts(db, ids) {
  if (ids.length === 0) return new Map();
  const [reviews, replies] = await Promise.all([
    db.review.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: 'removed' }, _count: { _all: true } }),
    db.reviewReply.groupBy({ by: ['userId'], where: { userId: { in: ids }, status: 'removed' }, _count: { _all: true } }),
  ]);
  const counts = new Map();
  for (const row of [...reviews, ...replies]) counts.set(row.userId, (counts.get(row.userId) ?? 0) + row._count._all);
  return counts;
}

function shape(row, removed, now) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    createdAt: row.createdAt,
    suspension: activeSuspension(row, now),
    reviews: row._count.reviews,
    removed: removed.get(row.id) ?? 0,
    submissions: row._count.submissions,
  };
}

// The members, newest first. `q` is part of the username or the email.
async function list({ q = '', status = 'all', page = 1, pageSize = 20 } = {}) {
  const now = new Date();
  const and = [LIVE];
  if (q) {
    const contains = { contains: escapeLike(q), mode: 'insensitive' };
    and.push({ OR: [{ username: contains }, { email: contains }] });
  }
  if (status === 'suspended') and.push(suspendedNow(now));
  if (status === 'active') and.push({ OR: [{ suspendedAt: null }, { suspendedUntil: { lte: now } }] });
  const where = { AND: and };

  const total = await prisma.user.count({ where });
  const pagination = paginate(total, Math.min(page, Math.max(1, Math.ceil(total / pageSize))), pageSize);
  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (pagination.page - 1) * pageSize,
    take: pageSize,
    select: rowSelect,
  });
  const removed = await removedCounts(prisma, rows.map((row) => row.id));
  return { data: rows.map((row) => shape(row, removed, now)), pagination };
}

// One member with the moderation history (newest first). Answers 404 for an
// unknown id and for an emptied (deleted) account. `db` lets suspend and
// unsuspend read the result inside their transaction.
async function findById(id, db = prisma) {
  const now = new Date();
  const row = await db.user.findFirst({
    where: { id, ...LIVE },
    select: {
      ...rowSelect,
      moderationEvents: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, action: true, note: true, until: true, createdAt: true, actor: { select: { id: true, username: true } } },
      },
    },
  });
  if (!row) throw notFound();
  const { moderationEvents, ...rest } = row;
  return { ...shape(rest, await removedCounts(db, [id]), now), events: moderationEvents };
}

// Locks the member's row for the rest of the transaction (two admins acting on
// the same member at once cannot both pass the "already suspended" check) and
// returns it, or throws 404.
async function lockMember(tx, id) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
  const user = await tx.user.findFirst({
    where: { id, ...LIVE },
    select: { id: true, role: true, suspendedAt: true, suspendedUntil: true, suspendedReason: true },
  });
  if (!user) throw notFound();
  return user;
}

// Suspends a member for `days` days, or until an admin lifts it (days null).
// Admin accounts (including the acting admin's own) cannot be suspended, and
// a member who is suspended now cannot be suspended again; one whose earlier
// suspension has expired can, and the columns are overwritten.
function suspend(adminId, id, { reason, days = null }) {
  return prisma.$transaction(async (tx) => {
    const user = await lockMember(tx, id);
    if (user.role === 'admin') throw new AppError(409, 'INVALID_STATE', 'ระงับบัญชีผู้ดูแลไม่ได้');
    if (activeSuspension(user)) throw new AppError(409, 'INVALID_STATE', 'สมาชิกคนนี้ถูกระงับอยู่แล้ว');

    const at = new Date();
    const until = days ? new Date(at.getTime() + days * DAY_MS) : null;
    await tx.user.update({ where: { id }, data: { suspendedAt: at, suspendedUntil: until, suspendedReason: reason } });
    await tx.userModerationEvent.create({ data: { userId: id, actorId: adminId, action: 'suspended', note: reason, until } });
    return findById(id, tx);
  });
}

// Lifts a suspension that is in force now.
function unsuspend(adminId, id, { note = null } = {}) {
  return prisma.$transaction(async (tx) => {
    const user = await lockMember(tx, id);
    if (!activeSuspension(user)) throw new AppError(409, 'INVALID_STATE', 'สมาชิกคนนี้ไม่ได้ถูกระงับอยู่');

    await tx.user.update({ where: { id }, data: { suspendedAt: null, suspendedUntil: null, suspendedReason: null } });
    await tx.userModerationEvent.create({ data: { userId: id, actorId: adminId, action: 'unsuspended', note } });
    return findById(id, tx);
  });
}

// For the admin dashboard: members suspended now (emptied accounts excluded).
function countSuspended() {
  return prisma.user.count({ where: { AND: [LIVE, suspendedNow(new Date())] } });
}

module.exports = { list, findById, suspend, unsuspend, countSuspended, STATUSES };
