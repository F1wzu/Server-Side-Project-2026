const prisma = require('../config/db');

// Public pages only ever see published places. Every function here filters
// on that, so no page can show an unpublished place by accident.
const published = { status: 'published' };

// What a place card needs.
const cardFields = {
  id: true,
  name: true,
  description: true,
  imagePath: true,
  ratingAvg: true,
  ratingCount: true,
  category: { select: { id: true, name: true } },
};

const SORTS = {
  name: [{ name: 'asc' }],
  rating: [{ ratingAvg: { sort: 'desc', nulls: 'last' } }, { ratingCount: 'desc' }, { name: 'asc' }],
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
};

function countPublished() {
  return prisma.place.count({ where: published });
}

// Places an admin picked for the home page, in the order the admin set.
function featured(limit = 6) {
  return prisma.place.findMany({
    where: { ...published, featuredOrder: { not: null } },
    orderBy: [{ featuredOrder: 'asc' }, { name: 'asc' }],
    take: limit,
    select: cardFields,
  });
}

// In a LIKE pattern % and _ are wildcards. Prisma sends the search text as a
// parameter (so it cannot change the query) but does not escape these two,
// so they are escaped here; otherwise a search for "%" matches everything.
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// Almost every address ends with these words. A search for part of them
// (for example "ตลาด", which hides inside "เขตลาดกระบัง") must not match
// every address, so such a search skips the address column.
const ADDRESS_BOILERPLATE = 'แขวงลาดกระบัง เขตลาดกระบัง กรุงเทพมหานคร 10520';

// Search by text and category.
function list({ q = '', categoryId = null, sort = 'name' } = {}) {
  const where = { ...published };
  if (categoryId) where.categoryId = categoryId;
  if (q) {
    const contains = { contains: escapeLike(q), mode: 'insensitive' };
    where.OR = [{ name: contains }, { description: contains }, { category: { name: contains } }];
    if (!ADDRESS_BOILERPLATE.includes(q)) where.OR.push({ address: contains });
  }
  return prisma.place.findMany({ where, orderBy: SORTS[sort] ?? SORTS.name, select: cardFields });
}

// One published place with its category and seven opening-hours rows, or null.
function findPublishedById(id) {
  return prisma.place.findFirst({
    where: { id, ...published },
    include: { category: { select: { id: true, name: true } }, hours: { orderBy: { weekday: 'asc' } } },
  });
}

// Other places in the same category, for "more like this".
function sameCategory(place, limit = 3) {
  return prisma.place.findMany({
    where: { ...published, categoryId: place.categoryId, id: { not: place.id } },
    orderBy: [{ ratingAvg: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
    take: limit,
    select: cardFields,
  });
}

// The id of one published place chosen at random, or null when there are none.
async function randomId({ categoryId = null } = {}) {
  const where = { ...published, ...(categoryId ? { categoryId } : {}) };
  const total = await prisma.place.count({ where });
  if (!total) return null;
  const [place] = await prisma.place.findMany({ where, orderBy: { id: 'asc' }, skip: Math.floor(Math.random() * total), take: 1, select: { id: true } });
  return place?.id ?? null;
}

module.exports = { countPublished, featured, list, findPublishedById, sameCategory, randomId, SORTS };
