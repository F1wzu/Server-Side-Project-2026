const prisma = require('../config/db');
const { openStatus, openNowFilter, toClock } = require('../utils/openingHours');
const { paginate } = require('../utils/pagination');

// Public pages only ever see published places. Every function here filters
// on that, so no page or endpoint can show an unpublished place by accident.
const published = { status: 'published' };

// The columns that may leave this file. Internal ones (status, created_by)
// are not listed, so they are never sent to a page or an API client.
const publicFields = {
  id: true,
  name: true,
  description: true,
  address: true,
  latitude: true,
  longitude: true,
  imagePath: true,
  phone: true,
  websiteUrl: true,
  ratingAvg: true,
  ratingCount: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  hours: { orderBy: { weekday: 'asc' } },
};

const SORTS = {
  name: [{ name: 'asc' }, { id: 'asc' }],
  rating: [{ ratingAvg: { sort: 'desc', nulls: 'last' } }, { ratingCount: 'desc' }, { name: 'asc' }, { id: 'asc' }],
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
};

// "Top rated" needs enough reviews for the average to mean something.
const MIN_REVIEWS_FOR_TOP_RATED = 3;
const NEARBY_KM = 2;

const number = (decimal) => (decimal === null ? null : Number(decimal));

// Turns a database row into the plain object that pages and the API use:
// numbers instead of Decimal objects, and the open / closed status worked out.
// The week of opening hours is included only where a page shows it.
function present(place, now, { withHours = false } = {}) {
  const { hours, latitude, longitude, ratingAvg, ...rest } = place;
  return {
    ...rest,
    latitude: number(latitude),
    longitude: number(longitude),
    ratingAvg: number(ratingAvg),
    openStatus: openStatus(hours, now),
    ...(withHours && {
      hours: hours.map((day) => ({
        weekday: day.weekday,
        state: day.state,
        opensAt: day.opensAt ? toClock(day.opensAt) : null,
        closesAt: day.closesAt ? toClock(day.closesAt) : null,
        closesNextDay: day.closesNextDay,
      })),
    }),
  };
}

// In a LIKE pattern % and _ are wildcards. Prisma sends the search text as a
// parameter (so it cannot change the query) but does not escape these two,
// so they are escaped here; otherwise a search for "%" matches everything.
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// Almost every address ends with the district's own name. A search for a
// word hidden inside it (for example "ตลาด" inside "เขตลาดกระบัง") must not
// match every address, so addresses are searched with these words blanked
// out. The rest of the address (road, soi, landmark) is still searched.
const ADDRESS_BOILERPLATE = 'แขวงลาดกระบัง|เขตลาดกระบัง|กรุงเทพมหานคร|กรุงเทพฯ|10520';

// Searching for the district itself: every place in this site is in it, so
// every place matches by address and the text filter is simply dropped.
const DISTRICT_WORDS = new Set(['ลาดกระบัง', 'แขวงลาดกระบัง', 'เขตลาดกระบัง', 'กรุงเทพ', 'กรุงเทพฯ', 'กรุงเทพมหานคร', '10520']);

// Ids of places whose address, without the district words, contains `q`.
// Prisma cannot express regexp_replace, so this is a raw query; the values
// are still sent as parameters, never pasted into the SQL text.
// ILIKE only folds the case of ASCII letters here (Thai has no case).
async function idsByAddress(q) {
  const pattern = `%${escapeLike(q)}%`;
  const rows = await prisma.$queryRaw`
    SELECT id FROM places
    WHERE regexp_replace(address, ${ADDRESS_BOILERPLATE}, ' ', 'g') ILIKE ${pattern} ESCAPE '\\'`;
  return rows.map((row) => row.id);
}

async function buildWhere({ q = '', categoryId = null, openNow = false } = {}, now) {
  const conditions = [published];
  if (categoryId) conditions.push({ categoryId });
  if (openNow) conditions.push(openNowFilter(now));
  if (q && !DISTRICT_WORDS.has(q.trim().toLowerCase())) {
    const contains = { contains: escapeLike(q), mode: 'insensitive' };
    const fields = [{ name: contains }, { description: contains }, { category: { name: contains } }, { id: { in: await idsByAddress(q) } }];
    conditions.push({ OR: fields });
  }
  return { AND: conditions };
}

function countPublished() {
  return prisma.place.count({ where: published });
}

// Search, filter, sort and page through published places.
// With `clamp`, a page number past the end shows the last page instead of nothing.
async function list({ q, categoryId, openNow, sort = 'name', page = 1, pageSize = 12, clamp = false } = {}, now = new Date()) {
  const where = await buildWhere({ q, categoryId, openNow }, now);
  const total = await prisma.place.count({ where });
  const pagination = paginate(total, page, pageSize);
  if (clamp && pagination.page > pagination.totalPages) pagination.page = pagination.totalPages;

  const rows = await prisma.place.findMany({
    where,
    orderBy: SORTS[sort] ?? SORTS.name,
    skip: (pagination.page - 1) * pageSize,
    take: pageSize,
    select: publicFields,
  });
  return { data: rows.map((row) => present(row, now)), pagination };
}

// Places an admin picked for the home page, in the order the admin set.
async function featured(limit = 6, now = new Date()) {
  const rows = await prisma.place.findMany({
    where: { ...published, featuredOrder: { not: null } },
    orderBy: [{ featuredOrder: 'asc' }, { name: 'asc' }],
    take: limit,
    select: publicFields,
  });
  return rows.map((row) => present(row, now));
}

async function highlyRated(limit = 4, now = new Date()) {
  const rows = await prisma.place.findMany({
    where: { ...published, ratingCount: { gte: MIN_REVIEWS_FOR_TOP_RATED } },
    orderBy: SORTS.rating,
    take: limit,
    select: publicFields,
  });
  return rows.map((row) => present(row, now));
}

// One published place with its week of opening hours, or null.
async function findPublishedById(id, now = new Date()) {
  const row = await prisma.place.findFirst({ where: { id, ...published }, select: publicFields });
  return row && present(row, now, { withHours: true });
}

// Distance between two points on the earth, in kilometres (haversine formula).
function distanceKm(a, b) {
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

// For a place page: other places in the same category, and places within
// walking or a short ride's distance. The district has few enough places
// that the distances are simply worked out here.
async function related(place, limit = 3, now = new Date()) {
  const [sameRows, pinnedRows] = await Promise.all([
    prisma.place.findMany({
      where: { ...published, categoryId: place.category.id, id: { not: place.id } },
      orderBy: SORTS.rating,
      take: limit,
      select: publicFields,
    }),
    place.latitude === null
      ? []
      : prisma.place.findMany({ where: { ...published, id: { not: place.id }, latitude: { not: null } }, select: publicFields }),
  ]);

  const nearby = pinnedRows
    .map((row) => present(row, now))
    .map((other) => ({ ...other, distanceKm: distanceKm(place, other) }))
    .filter((other) => other.distanceKm <= NEARBY_KM)
    // Equal distances (two shops in one building) are ordered by name, then
    // id, so the list is the same on every visit.
    .sort((a, b) => a.distanceKm - b.distanceKm || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.id - b.id)
    .slice(0, limit);

  return { sameCategory: sameRows.map((row) => present(row, now)), nearby };
}

// Every published place that has a pin, for the map.
async function forMap(now = new Date()) {
  const rows = await prisma.place.findMany({
    where: { ...published, latitude: { not: null } },
    orderBy: SORTS.name,
    select: publicFields,
  });
  return rows.map((row) => {
    const { id, name, latitude, longitude, category, openStatus: status } = present(row, now);
    return { id, name, latitude, longitude, category, openStatus: status };
  });
}

// A member's saved places that are still published, most recently saved first.
// A place that was unpublished after saving simply drops out of the list.
async function savedBy(userId, { page = 1, pageSize = 24 } = {}, now = new Date()) {
  const where = { ...published, favorites: { some: { userId } } };
  const total = await prisma.place.count({ where });
  const rows = await prisma.favorite.findMany({
    where: { userId, place: published },
    orderBy: [{ createdAt: 'desc' }, { placeId: 'desc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: { place: { select: publicFields } },
  });
  return { data: rows.map((row) => present(row.place, now)), pagination: paginate(total, page, pageSize) };
}

// The id of one published place chosen at random, or null when none match.
async function randomId({ categoryId = null, openNow = false } = {}, now = new Date()) {
  const where = await buildWhere({ categoryId, openNow }, now);
  const total = await prisma.place.count({ where });
  if (!total) return null;
  const [place] = await prisma.place.findMany({ where, orderBy: { id: 'asc' }, skip: Math.floor(Math.random() * total), take: 1, select: { id: true } });
  return place?.id ?? null;
}

module.exports = { countPublished, list, featured, highlyRated, findPublishedById, related, forMap, savedBy, randomId, MIN_REVIEWS_FOR_TOP_RATED };
