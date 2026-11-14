// The admin side of place submissions: the queue, and the three decisions
// (approve, return for changes, reject).
//
// Every decision is one transaction and is conditional on the version the
// admin was looking at. The submission's row is locked first, so two admins
// deciding at the same moment wait for each other: the first wins, the second
// is told the submission changed (409) and nothing is done twice.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { paginate } = require('../utils/pagination');
const { toPlaceHoursRows } = require('../utils/hours');
const { snapshotOf } = require('./submission');
const { findPossibleDuplicates } = require('./duplicates');

const STATUSES = ['pending', 'changes_requested', 'approved', 'rejected'];
const number = (decimal) => (decimal === null || decimal === undefined ? null : Number(decimal));

function present(submission) {
  const { latitude, longitude, events, ...rest } = submission;
  return {
    ...rest,
    latitude: number(latitude),
    longitude: number(longitude),
    ...(events && { events: events.map(({ actorId, ...event }) => event) }),
  };
}

// The queue. Pending submissions are shown oldest first, so nobody waits
// behind newer ones; other lists show the most recently decided first.
async function list({ status = 'pending', page = 1, pageSize = 20 } = {}) {
  const where = STATUSES.includes(status) ? { status } : {};
  const total = await prisma.submission.count({ where });
  const pagination = paginate(total, page, pageSize);
  if (pagination.page > pagination.totalPages) pagination.page = pagination.totalPages;
  const rows = await prisma.submission.findMany({
    where,
    orderBy: status === 'pending' ? [{ updatedAt: 'asc' }, { id: 'asc' }] : [{ updatedAt: 'desc' }, { id: 'desc' }],
    skip: (pagination.page - 1) * pageSize,
    take: pageSize,
    include: { category: { select: { id: true, name: true } }, user: { select: { id: true, username: true } } },
  });
  return { data: rows.map(present), pagination };
}

function pendingCount() {
  return prisma.submission.count({ where: { status: 'pending' } });
}

// One submission in full, with its history, its author and possible duplicates.
async function find(id) {
  const submission = await prisma.submission.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      user: { select: { id: true, username: true, email: true } },
      events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { actor: { select: { id: true, username: true } } } },
    },
  });
  if (!submission) throw AppError.notFound('ไม่พบคำขอนี้');
  // Empty for approved / rejected submissions: nothing left to decide.
  const duplicates = await findPossibleDuplicates(submission);
  return { ...present(submission), possibleDuplicates: duplicates };
}

// Locks the submission's row and checks that it is still pending at the
// version the admin saw. Returns the row.
async function lockPending(tx, id, version) {
  await tx.$queryRaw`SELECT id FROM submissions WHERE id = ${id} FOR UPDATE`;
  const submission = await tx.submission.findUnique({ where: { id }, include: { category: { select: { name: true } } } });
  if (!submission) throw AppError.notFound('ไม่พบคำขอนี้');
  if (submission.status !== 'pending') {
    throw new AppError(409, 'INVALID_STATE', 'คำขอนี้ถูกตัดสินไปแล้ว หรือไม่ได้อยู่ในสถานะรอตรวจสอบ');
  }
  if (submission.version !== version) {
    throw new AppError(409, 'STALE_VERSION', 'คำขอนี้ถูกเปลี่ยนแปลงไปแล้ว กรุณาโหลดหน้าใหม่แล้วตรวจอีกครั้ง');
  }
  return submission;
}

const samePin = (a, b) => number(a.latitude) === b.latitude && number(a.longitude) === b.longitude;

// Approves a submission and publishes it as a place, all or nothing:
// the place, its seven opening-hours rows, the submission's new status and
// the history event are written together. `pin` is the corrected position
// when the admin moved the pin, or null to keep the member's.
async function approve(adminId, id, version, pin = null) {
  return prisma.$transaction(async (tx) => {
    const submission = await lockPending(tx, id, version);
    const moved = Boolean(pin) && !samePin(submission, pin);
    const position = moved ? pin : { latitude: number(submission.latitude), longitude: number(submission.longitude) };

    const place = await tx.place.create({
      data: {
        categoryId: submission.categoryId,
        name: submission.name,
        description: submission.description,
        address: submission.address,
        latitude: position.latitude,
        longitude: position.longitude,
        phone: submission.phone,
        websiteUrl: submission.websiteUrl,
        imagePath: submission.imagePath,
        createdById: adminId,
        hours: { create: toPlaceHoursRows(submission.hours) },
      },
      select: { id: true },
    });

    // Photos 2..5 become the gallery, in the member's order. The files are
    // shared with the submission, which keeps pointing at them.
    if (submission.extraImagePaths.length > 0) {
      await tx.placePhoto.createMany({
        data: submission.extraImagePaths.map((imagePath, position) => ({ placeId: place.id, imagePath, position })),
      });
    }

    const updated = await tx.submission.update({
      where: { id },
      data: { status: 'approved', placeId: place.id, version: { increment: 1 }, latitude: position.latitude, longitude: position.longitude },
    });
    await tx.submissionEvent.create({
      data: {
        submissionId: id,
        actorId: adminId,
        action: 'approved',
        // The member can see in the history that their pin was moved.
        note: moved
          ? `ผู้ดูแลปรับตำแหน่งหมุดจาก ${number(submission.latitude)}, ${number(submission.longitude)} เป็น ${pin.latitude}, ${pin.longitude}`
          : null,
        snapshot: snapshotOf(updated, submission.category.name),
      },
    });
    return { submission: present(updated), placeId: place.id };
  });
}

// Returns a submission to its author, or rejects it, with a reason.
async function decide(adminId, id, version, reason, { status, action }) {
  return prisma.$transaction(async (tx) => {
    const submission = await lockPending(tx, id, version);
    const updated = await tx.submission.update({ where: { id }, data: { status, reviewNote: reason, version: { increment: 1 } } });
    await tx.submissionEvent.create({
      data: { submissionId: id, actorId: adminId, action, note: reason, snapshot: snapshotOf(updated, submission.category.name) },
    });
    return present(updated);
  });
}

const returnForChanges = (adminId, id, version, reason) => decide(adminId, id, version, reason, { status: 'changes_requested', action: 'returned' });
const reject = (adminId, id, version, reason) => decide(adminId, id, version, reason, { status: 'rejected', action: 'rejected' });

module.exports = { list, find, pendingCount, approve, returnForChanges, reject, STATUSES };
