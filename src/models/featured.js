// The home page's "ทีมงานชวนไป" picks, managed as one ordered list
// (/admin/featured). The order is stored as places.featured_order (1, 2, 3 ...);
// admins never type those numbers here: they add, move and remove places, and
// setOrder renumbers the whole list in one transaction.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { FEATURED_LIMIT } = require('./place');

const listFields = {
  id: true,
  name: true,
  status: true,
  imagePath: true,
  featuredOrder: true,
  category: { select: { id: true, name: true } },
};

// The picks in order, plus the published places that could still be added
// (for the "add" list, by name).
async function overview() {
  const [picks, candidates] = await Promise.all([
    prisma.place.findMany({ where: { featuredOrder: { not: null } }, orderBy: [{ featuredOrder: 'asc' }, { name: 'asc' }], select: listFields }),
    prisma.place.findMany({
      where: { featuredOrder: null, status: 'published' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, imagePath: true, address: true, category: { select: { id: true, name: true } } },
    }),
  ]);
  return { picks, candidates, limit: FEATURED_LIMIT };
}

const invalid = (message) => new AppError(400, 'VALIDATION_ERROR', message, [{ field: 'placeIds', message }]);

// Replaces the picks with `placeIds`, in that order. Every place must exist;
// a newly added one must be published (a hidden place would not show). The
// list may not grow past FEATURED_LIMIT; a list that is already longer (set
// before this page existed) may still be reordered or shortened.
async function setOrder(placeIds) {
  if (!Array.isArray(placeIds) || placeIds.some((id) => !Number.isInteger(id) || id < 1)) throw invalid('รายการสถานที่ไม่ถูกต้อง');
  if (new Set(placeIds).size !== placeIds.length) throw invalid('มีสถานที่ซ้ำในรายการ');

  return prisma.$transaction(async (tx) => {
    const current = await tx.place.findMany({ where: { featuredOrder: { not: null } }, select: { id: true } });
    const limit = Math.max(FEATURED_LIMIT, current.length);
    if (placeIds.length > limit) throw invalid(`เลือกได้ไม่เกิน ${FEATURED_LIMIT} แห่ง`);

    const places = await tx.place.findMany({ where: { id: { in: placeIds } }, select: { id: true, status: true, name: true } });
    if (places.length !== placeIds.length) throw AppError.notFound('ไม่พบสถานที่บางแห่งในรายการ');
    const already = new Set(current.map((place) => place.id));
    const hiddenNew = places.find((place) => !already.has(place.id) && place.status !== 'published');
    if (hiddenNew) throw invalid(`"${hiddenNew.name}" ถูกซ่อนอยู่ เผยแพร่ก่อนจึงจะเลือกได้`);

    await tx.place.updateMany({ where: { featuredOrder: { not: null }, id: { notIn: placeIds } }, data: { featuredOrder: null } });
    for (const [index, id] of placeIds.entries()) {
      await tx.place.update({ where: { id }, data: { featuredOrder: index + 1 } });
    }
    return tx.place.findMany({ where: { featuredOrder: { not: null } }, orderBy: { featuredOrder: 'asc' }, select: listFields });
  });
}

// The current picks' ids, in order (for the page's add / move / remove).
async function currentIds() {
  const rows = await prisma.place.findMany({ where: { featuredOrder: { not: null } }, orderBy: [{ featuredOrder: 'asc' }, { name: 'asc' }], select: { id: true } });
  return rows.map((row) => row.id);
}

// How many picks the home page shows right now (published ones, at most the limit).
async function shownCount() {
  const count = await prisma.place.count({ where: { featuredOrder: { not: null }, status: 'published' } });
  return Math.min(count, FEATURED_LIMIT);
}

module.exports = { overview, setOrder, currentIds, shownCount };
