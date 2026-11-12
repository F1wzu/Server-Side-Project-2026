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

module.exports = { create, listOpenCount };
