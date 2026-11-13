// Reports of wrong information about a place, sent by members.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');

// The columns sent back to the member who reported. Who resolved a report
// is for admins only.
const publicFields = { id: true, placeId: true, reason: true, details: true, status: true, createdAt: true };

const reportExists = () => new AppError(409, 'REPORT_EXISTS', 'คุณแจ้งข้อมูลสถานที่นี้ไว้แล้ว ผู้ดูแลกำลังตรวจสอบ');

// Creates an open report. The caller has already checked that the place is
// published. The partial unique index (one open report per member per place)
// decides duplicates, so two quick clicks cannot both get through.
async function create(userId, placeId, { reason, details = null }) {
  try {
    return await prisma.placeReport.create({ data: { userId, placeId, reason, details }, select: publicFields });
  } catch (err) {
    if (err.code === 'P2002') throw reportExists();
    throw err;
  }
}

// For the admin dashboard: how many reports still wait for a decision.
function listOpenCount() {
  return prisma.placeReport.count({ where: { status: 'open' } });
}

// ---------- admin ----------

const REPORT_STATUSES = ['open', 'resolved', 'dismissed'];

// Reports for the admin list. Open ones come oldest first (the longest
// waiting is at the top); closed ones newest first.
async function listAll({ status = 'open', page = 1, pageSize = 20 } = {}) {
  const where = REPORT_STATUSES.includes(status) ? { status } : {};
  const total = await prisma.placeReport.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, totalPages);
  const rows = await prisma.placeReport.findMany({
    where,
    orderBy: [{ createdAt: status === 'open' ? 'asc' : 'desc' }, { id: status === 'open' ? 'asc' : 'desc' }],
    skip: (current - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      placeId: true,
      reason: true,
      details: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
      place: { select: { id: true, name: true } },
      user: { select: { id: true, username: true } },
      resolvedBy: { select: { id: true, username: true } },
    },
  });
  return { data: rows, pagination: { page: current, pageSize, total, totalPages } };
}

// Closes an open report. The update itself only matches an open row, so
// two admins closing the same report cannot both succeed.
async function close(adminId, reportId, status) {
  const { count } = await prisma.placeReport.updateMany({
    where: { id: reportId, status: 'open' },
    data: { status, resolvedById: adminId, resolvedAt: new Date() },
  });
  if (count === 0) {
    const exists = await prisma.placeReport.findUnique({ where: { id: reportId }, select: { id: true } });
    if (!exists) throw AppError.notFound('ไม่พบรายการแจ้งนี้');
    throw new AppError(409, 'INVALID_STATE', 'รายการแจ้งนี้ถูกปิดไปแล้ว');
  }
  return prisma.placeReport.findUnique({
    where: { id: reportId },
    select: { id: true, placeId: true, reason: true, details: true, status: true, createdAt: true, resolvedAt: true },
  });
}

module.exports = { create, listOpenCount, listAll, close, REPORT_STATUSES };
