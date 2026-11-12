// Reviews: one per member per place, 1–5 stars, soft-deleted.
//
// Every change runs in a transaction that first locks the place's row and
// finishes by recalculating the place's rating from the reviews table. The
// lock makes two members reviewing the same place at the same moment wait
// for each other, so the stored average can never miss a review.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { paginate } = require('../utils/pagination');

const authorFields = { select: { id: true, username: true } };

// What a review looks like outside this file. The admin's id is never shown.
function present(review) {
  const { removedById, ...rest } = review;
  return rest;
}

const notFound = () => AppError.notFound('ไม่พบรีวิวนี้');

// Locks the place's row for the rest of the transaction, and checks it is
// published (only published places can be reviewed).
async function lockPublishedPlace(tx, placeId) {
  const rows = await tx.$queryRaw`SELECT id FROM places WHERE id = ${placeId} AND status = 'published' FOR UPDATE`;
  if (!rows.length) throw AppError.notFound('ไม่พบสถานที่นี้');
}

// Locks the place's row whatever its status. Used when a member edits or
// deletes a review they already wrote: if an admin unpublishes the place
// afterwards, the author must still be able to take their review down.
async function lockPlace(tx, placeId) {
  await tx.$queryRaw`SELECT id FROM places WHERE id = ${placeId} FOR UPDATE`;
}

// A page number past the end shows the last page instead of an empty list
// (like /places), so an old or edited link still shows something.
function pageWithin(total, page, pageSize) {
  const pagination = paginate(total, page, pageSize);
  if (pagination.page > pagination.totalPages) pagination.page = pagination.totalPages;
  return pagination;
}

// Recalculates the average and the count from the active reviews.
// Never incremented, so it cannot drift from the reviews table.
async function recalculateRating(tx, placeId) {
  await tx.$executeRaw`
    UPDATE places
    SET rating_count = stats.count,
        rating_avg = stats.average,
        updated_at = now()
    FROM (
      SELECT count(*)::int AS count, round(avg(rating), 2) AS average
      FROM reviews
      WHERE place_id = ${placeId} AND status = 'active'
    ) AS stats
    WHERE places.id = ${placeId}`;
}

// Writes a review. A member who deleted their own review may write again
// (the same row is reused); a review removed by an admin stays removed.
async function create(userId, placeId, { rating, comment }) {
  try {
    return await prisma.$transaction(async (tx) => {
      await lockPublishedPlace(tx, placeId);
      const existing = await tx.review.findUnique({ where: { userId_placeId: { userId, placeId } } });

      if (existing?.status === 'active') {
        throw new AppError(409, 'REVIEW_EXISTS', 'คุณรีวิวสถานที่นี้แล้ว แก้ไขรีวิวเดิมได้ที่หน้ารีวิวของฉัน');
      }
      if (existing?.status === 'removed') {
        throw new AppError(409, 'INVALID_STATE', 'รีวิวของคุณสำหรับสถานที่นี้ถูกผู้ดูแลนำออกแล้ว จึงเขียนใหม่ไม่ได้');
      }

      const data = { rating, comment, status: 'active' };
      const review = existing
        ? await tx.review.update({ where: { id: existing.id }, data: { ...data, createdAt: new Date() }, include: { user: authorFields } })
        : await tx.review.create({ data: { ...data, userId, placeId }, include: { user: authorFields } });

      await recalculateRating(tx, placeId);
      return present(review);
    });
  } catch (err) {
    // Two requests from the same member at the same moment: the unique
    // (user, place) key stops the second one.
    if (err.code === 'P2002') throw new AppError(409, 'REVIEW_EXISTS', 'คุณรีวิวสถานที่นี้แล้ว');
    throw err;
  }
}

// Finds the member's own active review, inside a transaction, locking the
// place first. Someone else's review is reported as "not found", so its
// existence is not revealed. The place does not have to be published any
// more (see lockPlace).
async function lockOwnActive(tx, userId, reviewId) {
  const review = await tx.review.findUnique({ where: { id: reviewId }, select: { userId: true, placeId: true, status: true } });
  if (!review || review.userId !== userId) throw notFound();
  await lockPlace(tx, review.placeId);
  // Read again under the lock: the status may have changed while waiting.
  const current = await tx.review.findUnique({ where: { id: reviewId } });
  if (current.status !== 'active') throw notFound();
  return current;
}

// Partial update: only the fields that were sent (not undefined) change, so
// a new rating alone keeps the comment. A comment of null clears it.
async function update(userId, reviewId, { rating, comment }) {
  const data = {};
  if (rating !== undefined) data.rating = rating;
  if (comment !== undefined) data.comment = comment;
  return prisma.$transaction(async (tx) => {
    const review = await lockOwnActive(tx, userId, reviewId);
    const updated = await tx.review.update({ where: { id: review.id }, data, include: { user: authorFields } });
    await recalculateRating(tx, review.placeId);
    return present(updated);
  });
}

// Soft delete: the row stays, so the member can write again later, and a
// removed review can never be deleted to dodge moderation.
async function remove(userId, reviewId) {
  await prisma.$transaction(async (tx) => {
    const review = await lockOwnActive(tx, userId, reviewId);
    await tx.review.update({ where: { id: review.id }, data: { status: 'deleted' } });
    await recalculateRating(tx, review.placeId);
  });
}

// Active reviews of a published place, newest first.
async function listForPlace(placeId, { page = 1, pageSize = 10 } = {}) {
  const where = { placeId, status: 'active', place: { status: 'published' } };
  const total = await prisma.review.count({ where });
  const pagination = pageWithin(total, page, pageSize);
  const rows = await prisma.review.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (pagination.page - 1) * pageSize,
    take: pageSize,
    include: { user: authorFields },
  });
  return { data: rows.map(present), pagination };
}

// The member's own review of a place, whatever its status, or null.
async function findOwnForPlace(userId, placeId) {
  const review = await prisma.review.findUnique({ where: { userId_placeId: { userId, placeId } } });
  return review && present(review);
}

// The member's reviews (active and removed; deleted ones are gone from
// their point of view), with the place each belongs to.
async function listOwn(userId, { page = 1, pageSize = 20 } = {}) {
  const where = { userId, status: { not: 'deleted' } };
  const total = await prisma.review.count({ where });
  const pagination = pageWithin(total, page, pageSize);
  const rows = await prisma.review.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    skip: (pagination.page - 1) * pageSize,
    take: pageSize,
    include: { place: { select: { id: true, name: true, status: true } } },
  });
  return { data: rows.map(present), pagination };
}

module.exports = { create, update, remove, listForPlace, findOwnForPlace, listOwn, recalculateRating };
