// Reports of a review, sent by members and handled by admins.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');

// What the reporting member gets back. Who resolved it is for admins only.
const publicFields = { id: true, reviewId: true, reason: true, details: true, status: true, createdAt: true };

const notFound = () => AppError.notFound('ไม่พบรีวิวนี้');

// Creates an open report. Only an active review of a published place can be
// reported; anything else answers 404 so a hidden review is not revealed.
// The partial unique index (one open report per member per review) decides
// duplicates, so two quick clicks cannot both get through.
async function create(userId, reviewId, { reason, details = null }) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { userId: true, status: true, place: { select: { status: true } } },
  });
  if (!review || review.status !== 'active' || review.place.status !== 'published') throw notFound();
  if (review.userId === userId) throw new AppError(409, 'INVALID_STATE', 'รายงานรีวิวของตัวเองไม่ได้');
  try {
    return await prisma.reviewReport.create({ data: { userId, reviewId, reason, details }, select: publicFields });
  } catch (err) {
    if (err.code === 'P2002') throw new AppError(409, 'REPORT_EXISTS', 'คุณรายงานรีวิวนี้ไว้แล้ว ผู้ดูแลกำลังตรวจสอบ');
    // The review was deleted between the check and the insert.
    if (err.code === 'P2003') throw notFound();
    throw err;
  }
}

// Admin: the open reports shown under a review card (what listAll includes).
const openReportsInclude = {
  where: { status: 'open' },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  select: { id: true, reason: true, details: true, createdAt: true, user: { select: { id: true, username: true } } },
};

// The admin "reported" filter: a review still on show with an open report of
// its own, or with a reply still on show that has an open report.
const reportedReviewWhere = {
  status: 'active',
  OR: [
    { reports: { some: { status: 'open' } } },
    { replies: { some: { status: 'active', reports: { some: { status: 'open' } } } } },
  ],
};

// For the admin dashboard: reviews (or their replies) waiting on a report.
function countReviewsWithOpen() {
  return prisma.review.count({ where: reportedReviewWhere });
}

// For the place page when an admin views it: open reports per review, as
// { id: count } (ids without an open report are left out).
async function openCountsByReview(ids) {
  if (!ids.length) return {};
  const rows = await prisma.reviewReport.groupBy({ by: ['reviewId'], where: { reviewId: { in: ids }, status: 'open' }, _count: { _all: true } });
  return Object.fromEntries(rows.map((row) => [row.reviewId, row._count._all]));
}

// Admin: "no action". Closes every open report of one review at once.
async function dismissOpen(adminId, reviewId) {
  const review = await prisma.review.findUnique({ where: { id: reviewId }, select: { id: true } });
  if (!review) throw notFound();
  const { count } = await prisma.reviewReport.updateMany({
    where: { reviewId, status: 'open' },
    data: { status: 'dismissed', resolvedById: adminId, resolvedAt: new Date() },
  });
  if (count === 0) throw new AppError(409, 'INVALID_STATE', 'รีวิวนี้ไม่มีรายงานที่รอตรวจ');
  return { reviewId, dismissed: count };
}

module.exports = { create, openReportsInclude, reportedReviewWhere, countReviewsWithOpen, openCountsByReview, dismissOpen };
