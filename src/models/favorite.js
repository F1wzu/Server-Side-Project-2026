// Saved places. A favorite is a (member, place) pair; saving twice is harmless.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');

// Saves a published place. Returns { created: true } the first time and
// { created: false } when it was already saved, so the API can answer 201 or 200.
async function save(userId, placeId) {
  const place = await prisma.place.findFirst({ where: { id: placeId, status: 'published' }, select: { id: true } });
  if (!place) throw AppError.notFound('ไม่พบสถานที่นี้');
  // skipDuplicates turns the second save (even two at the same moment) into a no-op.
  const { count } = await prisma.favorite.createMany({ data: [{ userId, placeId }], skipDuplicates: true });
  return { created: count === 1 };
}

// Removing something that is not saved is not an error: the result is the same.
async function remove(userId, placeId) {
  await prisma.favorite.deleteMany({ where: { userId, placeId } });
}

async function isSaved(userId, placeId) {
  return Boolean(await prisma.favorite.findUnique({ where: { userId_placeId: { userId, placeId } }, select: { placeId: true } }));
}

// Which of these places has this member saved? One query for a whole page of
// cards, so the heart buttons need no query per card. Returns a Set of ids.
async function savedPlaceIds(userId, placeIds) {
  const ids = [...new Set(placeIds)].filter((id) => Number.isInteger(id));
  if (!userId || ids.length === 0) return new Set();
  const rows = await prisma.favorite.findMany({ where: { userId, placeId: { in: ids } }, select: { placeId: true } });
  return new Set(rows.map((row) => row.placeId));
}

module.exports = { save, remove, isSaved, savedPlaceIds };
