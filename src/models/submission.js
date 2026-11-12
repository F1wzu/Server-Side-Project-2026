// Place submissions from members, and their history.
//
// A submission is only a proposal: public pages never read this table. Every
// change runs in a transaction that writes the change and its history event
// together. Changes are conditional on the version the member last saw
// (optimistic concurrency): if the submission changed in the meantime, the
// update matches no row and the member is told to reload instead of
// silently overwriting someone else's change.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { paginate } = require('../utils/pagination');

const number = (decimal) => (decimal === null || decimal === undefined ? null : Number(decimal));

// The content of a submission, as stored in each history event.
function snapshotOf(submission, categoryName) {
  return {
    name: submission.name,
    categoryId: submission.categoryId,
    categoryName,
    description: submission.description,
    address: submission.address,
    latitude: number(submission.latitude),
    longitude: number(submission.longitude),
    phone: submission.phone,
    websiteUrl: submission.websiteUrl,
    imagePath: submission.imagePath,
    hours: submission.hours,
  };
}

// What leaves this file: plain numbers instead of Decimal objects. Each event
// keeps its actor's id and display name (shown in the history), not the raw
// actorId column.
function present(submission) {
  const { latitude, longitude, events, ...rest } = submission;
  return {
    ...rest,
    latitude: number(latitude),
    longitude: number(longitude),
    ...(events && {
      events: events.map(({ actorId, ...event }) => event),
    }),
  };
}

// A category must exist; otherwise the member picked something stale.
async function categoryName(tx, categoryId) {
  const category = await tx.category.findUnique({ where: { id: categoryId }, select: { name: true } });
  if (!category) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', [{ field: 'categoryId', message: 'ไม่พบหมวดหมู่นี้ กรุณาเลือกใหม่' }]);
  }
  return category.name;
}

const contentData = (data) => ({
  name: data.name,
  categoryId: data.categoryId,
  description: data.description,
  address: data.address,
  latitude: data.latitude,
  longitude: data.longitude,
  phone: data.phone,
  websiteUrl: data.websiteUrl,
  hours: data.hours,
});

const detailInclude = {
  category: { select: { id: true, name: true } },
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { actor: { select: { id: true, username: true } } } },
};

// A new submission starts as pending at version 1, with a "submitted" event.
async function create(userId, data, imagePath) {
  const submission = await prisma.$transaction(async (tx) => {
    const name = await categoryName(tx, data.categoryId);
    const created = await tx.submission.create({ data: { ...contentData(data), imagePath, userId } });
    await tx.submissionEvent.create({ data: { submissionId: created.id, actorId: userId, action: 'submitted', snapshot: snapshotOf(created, name) } });
    return created;
  });
  return present(submission);
}

// A page number past the end shows the last page instead of an empty list.
async function listOwn(userId, { page = 1, pageSize = 20 } = {}) {
  const where = { userId };
  const total = await prisma.submission.count({ where });
  const pagination = paginate(total, page, pageSize);
  if (pagination.page > pagination.totalPages) pagination.page = pagination.totalPages;
  const rows = await prisma.submission.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    skip: (pagination.page - 1) * pageSize,
    take: pageSize,
    include: { category: { select: { id: true, name: true } } },
  });
  return { data: rows.map(present), pagination };
}

// One of the member's own submissions with its history. Someone else's
// submission is reported as "not found", so its existence is not revealed.
async function findOwn(userId, id) {
  const submission = await prisma.submission.findFirst({ where: { id, userId }, include: detailInclude });
  if (!submission) throw AppError.notFound('ไม่พบคำขอนี้');
  return present(submission);
}

// After a conditional update matched no row: work out why.
async function explainNoMatch(tx, userId, id) {
  const current = await tx.submission.findUnique({ where: { id }, select: { userId: true, status: true } });
  if (!current || current.userId !== userId) return AppError.notFound('ไม่พบคำขอนี้');
  if (current.status !== 'changes_requested') {
    return new AppError(409, 'INVALID_STATE', 'แก้ไขหรือส่งใหม่ได้เฉพาะคำขอที่ผู้ดูแลส่งกลับให้แก้ไขเท่านั้น');
  }
  return new AppError(409, 'STALE_VERSION', 'คำขอนี้ถูกเปลี่ยนแปลงไปแล้ว กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง');
}

// Edits a returned submission. Returns the submission and the photo it
// replaced (if any), so the caller can delete that file once this succeeded.
async function updateOwn(userId, id, version, data, newImagePath) {
  return prisma.$transaction(async (tx) => {
    const name = await categoryName(tx, data.categoryId);
    const before = await tx.submission.findUnique({ where: { id }, select: { imagePath: true } });
    const { count } = await tx.submission.updateMany({
      where: { id, userId, status: 'changes_requested', version },
      data: { ...contentData(data), ...(newImagePath && { imagePath: newImagePath }), version: { increment: 1 } },
    });
    if (count === 0) throw await explainNoMatch(tx, userId, id);

    const updated = await tx.submission.findUnique({ where: { id } });
    await tx.submissionEvent.create({ data: { submissionId: id, actorId: userId, action: 'edited', snapshot: snapshotOf(updated, name) } });
    return { submission: present(updated), replacedImagePath: newImagePath ? before.imagePath : null };
  });
}

// Sends a returned submission back to the admin queue.
async function resubmit(userId, id, version) {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.submission.updateMany({
      where: { id, userId, status: 'changes_requested', version },
      data: { status: 'pending', version: { increment: 1 } },
    });
    if (count === 0) throw await explainNoMatch(tx, userId, id);

    const updated = await tx.submission.findUnique({ where: { id }, include: { category: { select: { name: true } } } });
    await tx.submissionEvent.create({
      data: { submissionId: id, actorId: userId, action: 'resubmitted', snapshot: snapshotOf(updated, updated.category.name) },
    });
    return present(updated);
  });
}

module.exports = { create, listOwn, findOwn, updateOwn, resubmit, snapshotOf };
