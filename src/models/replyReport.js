// Reports of a reply under a review, sent by members and handled by admins.
// Works like models/reviewReport.js.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');

// What the reporting member gets back. Who resolved it is for admins only.
const publicFields = { id: true, replyId: true, reason: true, details: true, status: true, createdAt: true };

const notFound = () => AppError.notFound('ไม่พบความเห็นตอบกลับนี้');

// Creates an open report. Only an active reply to an active review of a
// published place can be reported; anything else answers 404 so a hidden
// reply is not revealed. The partial unique index (one open report per member
// per reply) decides duplicates, so two quick clicks cannot both get through.
async function create(userId, replyId, { reason, details = null }) {
  const reply = await prisma.reviewReply.findUnique({
    where: { id: replyId },
    select: { userId: true, status: true, review: { select: { status: true, place: { select: { status: true } } } } },
  });
  if (!reply || reply.status !== 'active' || reply.review.status !== 'active' || reply.review.place.status !== 'published') throw notFound();
  if (reply.userId === userId) throw new AppError(409, 'INVALID_STATE', 'รายงานความเห็นของตัวเองไม่ได้');
  try {
    return await prisma.replyReport.create({ data: { userId, replyId, reason, details }, select: publicFields });
  } catch (err) {
    if (err.code === 'P2002') throw new AppError(409, 'REPORT_EXISTS', 'คุณรายงานความเห็นนี้ไว้แล้ว ผู้ดูแลกำลังตรวจสอบ');
    // The reply was deleted between the check and the insert.
    if (err.code === 'P2003') throw notFound();
    throw err;
  }
}

// Admin: the open reports shown under a reply (what reply.includeAll includes).
const openReportsInclude = {
  where: { status: 'open' },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  select: { id: true, reason: true, details: true, createdAt: true, user: { select: { id: true, username: true } } },
};

// For the place page when an admin views it: open reports per reply, as
// { id: count } (ids without an open report are left out).
async function openCountsByReply(ids) {
  if (!ids.length) return {};
  const rows = await prisma.replyReport.groupBy({ by: ['replyId'], where: { replyId: { in: ids }, status: 'open' }, _count: { _all: true } });
  return Object.fromEntries(rows.map((row) => [row.replyId, row._count._all]));
}

// Admin: "no action". Closes every open report of one reply at once.
async function dismissOpen(adminId, replyId) {
  const reply = await prisma.reviewReply.findUnique({ where: { id: replyId }, select: { id: true } });
  if (!reply) throw notFound();
  const { count } = await prisma.replyReport.updateMany({
    where: { replyId, status: 'open' },
    data: { status: 'dismissed', resolvedById: adminId, resolvedAt: new Date() },
  });
  if (count === 0) throw new AppError(409, 'INVALID_STATE', 'ความเห็นนี้ไม่มีรายงานที่รอตรวจ');
  return { replyId, dismissed: count };
}

module.exports = { create, openReportsInclude, openCountsByReply, dismissOpen };
