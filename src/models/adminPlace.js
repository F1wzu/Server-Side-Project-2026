// Places as an admin sees them: unpublished ones included. Creating or
// editing a place writes the place and its seven opening-hours rows in one
// transaction, so a place never exists with a partial week of hours.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { paginate } = require('../utils/pagination');
const { toPlaceHoursRows } = require('../utils/hours');
const { toClock } = require('../utils/openingHours');

const number = (decimal) => (decimal === null || decimal === undefined ? null : Number(decimal));

const listSelect = {
  id: true,
  name: true,
  status: true,
  featuredOrder: true,
  ratingAvg: true,
  ratingCount: true,
  latitude: true,
  imagePath: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  hours: { select: { state: true } },
};

const detailSelect = {
  id: true,
  name: true,
  categoryId: true,
  description: true,
  address: true,
  latitude: true,
  longitude: true,
  phone: true,
  websiteUrl: true,
  imagePath: true,
  status: true,
  featuredOrder: true,
  ratingAvg: true,
  ratingCount: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  hours: { orderBy: { weekday: 'asc' } },
};

function presentHours(hours) {
  return hours.map((day) => ({
    weekday: day.weekday,
    state: day.state,
    opensAt: day.opensAt ? toClock(day.opensAt) : null,
    closesAt: day.closesAt ? toClock(day.closesAt) : null,
    closesNextDay: day.closesNextDay,
  }));
}

function presentDetail(place) {
  const { latitude, longitude, ratingAvg, hours, ...rest } = place;
  return { ...rest, latitude: number(latitude), longitude: number(longitude), ratingAvg: number(ratingAvg), hours: presentHours(hours) };
}

// In a LIKE pattern % and _ are wildcards: escape them so "%" is not "everything".
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// All places, by name, filtered by publication status and name.
async function list({ q = '', status = 'all', page = 1, pageSize = 20 } = {}) {
  const where = {};
  if (status === 'published' || status === 'unpublished') where.status = status;
  if (q) where.name = { contains: escapeLike(q), mode: 'insensitive' };

  const total = await prisma.place.count({ where });
  const pagination = paginate(total, page, pageSize);
  const rows = await prisma.place.findMany({
    where,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    skip: (pagination.page - 1) * pageSize,
    take: pageSize,
    select: listSelect,
  });
  const data = rows.map(({ hours, latitude, ratingAvg, ...place }) => ({
    ...place,
    ratingAvg: number(ratingAvg),
    hasPin: latitude !== null,
    hasHours: hours.some((day) => day.state !== 'unknown'),
  }));
  return { data, pagination };
}

// One place with every field, for the edit form. Throws 404 when unknown.
async function findById(id) {
  const place = await prisma.place.findUnique({ where: { id }, select: detailSelect });
  if (!place) throw AppError.notFound('ไม่พบสถานที่นี้');
  return presentDetail(place);
}

// A category must exist; otherwise the form was built from a stale list.
async function ensureCategory(tx, categoryId) {
  const category = await tx.category.findUnique({ where: { id: categoryId }, select: { id: true } });
  if (!category) {
    throw new AppError(400, 'VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', [{ field: 'categoryId', message: 'ไม่พบหมวดหมู่นี้ กรุณาเลือกใหม่' }]);
  }
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
});

// Adds a place (published unless said otherwise) with its seven hours rows.
async function create(adminId, data, imagePath, { status = 'published', featuredOrder = null } = {}) {
  const id = await prisma.$transaction(async (tx) => {
    await ensureCategory(tx, data.categoryId);
    const place = await tx.place.create({
      data: {
        ...contentData(data),
        imagePath,
        status,
        featuredOrder,
        createdById: adminId,
        hours: { create: toPlaceHoursRows(data.hours) },
      },
      select: { id: true },
    });
    return place.id;
  });
  return findById(id);
}

// Is the old file one that nothing else uses? Seed illustrations (/images/...)
// belong to the project and are never deleted; an approved submission shares
// its photo with the place it created.
async function isOrphanedUpload(tx, imagePath, placeId) {
  if (!imagePath || !imagePath.startsWith('/uploads/')) return false;
  const [submissions, places] = await Promise.all([
    tx.submission.count({ where: { imagePath } }),
    tx.place.count({ where: { imagePath, id: { not: placeId } } }),
  ]);
  return submissions === 0 && places === 0;
}

// Edits a place. `data` is the full content (or null to change only the
// publication fields); `publication` holds status / featuredOrder when given.
// Hours are replaced together with the place. Returns the place and, when a
// photo was replaced and nothing else uses the old file, `orphanedImagePath`
// for the caller to delete after the transaction succeeded.
async function update(id, data, publication, imagePath) {
  const { orphanedImagePath } = await prisma.$transaction(async (tx) => {
    const current = await tx.place.findUnique({ where: { id }, select: { id: true, imagePath: true } });
    if (!current) throw AppError.notFound('ไม่พบสถานที่นี้');

    const changes = { ...publication };
    if (data) {
      await ensureCategory(tx, data.categoryId);
      Object.assign(changes, contentData(data));
    }
    if (imagePath) changes.imagePath = imagePath;
    await tx.place.update({ where: { id }, data: changes });

    if (data) {
      await tx.placeHours.deleteMany({ where: { placeId: id } });
      await tx.placeHours.createMany({ data: toPlaceHoursRows(data.hours).map((row) => ({ ...row, placeId: id })) });
    }
    const replaced = imagePath && current.imagePath && current.imagePath !== imagePath;
    const orphaned = replaced ? await isOrphanedUpload(tx, current.imagePath, id) : false;
    return { orphanedImagePath: orphaned ? current.imagePath : null };
  });
  return { place: await findById(id), orphanedImagePath };
}

module.exports = { list, findById, create, update };
