// Places as an admin sees them: unpublished ones included. Creating or
// editing a place writes the place and its seven opening-hours rows in one
// transaction, so a place never exists with a partial week of hours.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { paginate } = require('../utils/pagination');
const { toPlaceHoursRows } = require('../utils/hours');
const { toClock } = require('../utils/openingHours');
const { isUploadUnused, unusedUploads, photoPathsOf } = require('./photoUsage');

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
  // The other gallery photos; `imagePath` above is the cover.
  photos: { orderBy: { position: 'asc' }, select: { id: true, imagePath: true, position: true } },
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

// Filters for places that still lack something an admin should fill in.
// "No hours" means every day is still 'unknown' (each place has 7 rows).
const MISSING_FILTERS = {
  pin: { latitude: null },
  hours: { hours: { none: { state: { not: 'unknown' } } } },
  photo: { imagePath: null },
};

// All places, by name, filtered by publication status, name and missing data.
async function list({ q = '', status = 'all', missing = null, page = 1, pageSize = 20 } = {}) {
  const where = {};
  if (status === 'published' || status === 'unpublished') where.status = status;
  if (q) where.name = { contains: escapeLike(q), mode: 'insensitive' };
  if (Object.hasOwn(MISSING_FILTERS, missing)) Object.assign(where, MISSING_FILTERS[missing]);

  const total = await prisma.place.count({ where });
  const pagination = paginate(total, page, pageSize);
  // Hiding the last row of the last page must not leave an empty page behind.
  if (pagination.page > pagination.totalPages) pagination.page = Math.max(1, pagination.totalPages);
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
    hasPhoto: place.imagePath !== null,
  }));
  return { data, pagination };
}

// One place with every field, for the edit form. Throws 404 when unknown.
// `client` lets create/update read the place inside their own transaction.
async function findById(id, client = prisma) {
  const place = await client.place.findUnique({ where: { id }, select: detailSelect });
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
  // Read back inside the transaction: a failed read after the commit would make
  // the caller delete a photo file the database already references.
  return prisma.$transaction(async (tx) => {
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
    return findById(place.id, tx);
  });
}

// Edits a place. `data` is the full content (or null to change only the
// publication fields); `publication` holds status / featuredOrder when given.
// Hours are replaced together with the place. Returns the place and, when a
// photo was replaced and nothing else uses the old file, `orphanedImagePath`
// for the caller to delete after the transaction succeeded.
async function update(id, data, publication, imagePath) {
  return prisma.$transaction(async (tx) => {
    // Lock first so concurrent edits / gallery changes cannot orphan or drop a cover.
    const locked = await tx.$queryRaw`SELECT id FROM places WHERE id = ${id} FOR UPDATE`;
    if (locked.length === 0) throw AppError.notFound('ไม่พบสถานที่นี้');
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
    // Asked after the update, so this place no longer counts as a user.
    const orphaned = replaced ? await isUploadUnused(tx, current.imagePath) : false;
    return { place: await findById(id, tx), orphanedImagePath: orphaned ? current.imagePath : null };
  });
}

// Permanently deletes a place. Hiding (unpublishing) is the normal way to
// take a place down; this is for mistakes and test entries, so it is refused
// once anyone has reviewed the place (in any status: a review row keeps a
// member's words and the admin's removal reasons, and its rating history).
// The place row is locked first, the same lock review.create takes, so a
// review cannot land on the place while it is being deleted.
//
// Hours, gallery rows, saved hearts and reports go with the place (ON DELETE
// CASCADE). A place that came from a member's submission takes that approved
// submission and its history with it: the submission only exists to explain
// how the place was made. Returns the photo files nothing uses any more, for
// the caller to delete after this has committed.
async function destroy(id) {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw`SELECT id FROM places WHERE id = ${id} FOR UPDATE`;
    if (!locked.length) throw AppError.notFound('ไม่พบสถานที่นี้');
    if ((await tx.review.count({ where: { placeId: id } })) > 0) {
      throw new AppError(409, 'INVALID_STATE', 'สถานที่นี้มีรีวิวแล้ว จึงลบถาวรไม่ได้ ใช้ "ซ่อนจากหน้าสาธารณะ" แทน');
    }
    const place = await tx.place.findUnique({ where: { id }, select: { name: true, imagePath: true, photos: { select: { imagePath: true } } } });
    const submission = await tx.submission.findUnique({ where: { placeId: id }, select: { id: true, imagePath: true, extraImagePaths: true } });
    const history = submission ? await tx.submissionEvent.findMany({ where: { submissionId: submission.id }, select: { snapshot: true } }) : [];
    const paths = [
      place.imagePath,
      ...place.photos.map((photo) => photo.imagePath),
      ...photoPathsOf(submission),
      ...history.flatMap((event) => photoPathsOf(event.snapshot)),
    ].filter(Boolean);

    if (submission) await tx.submission.delete({ where: { id: submission.id } });
    await tx.place.delete({ where: { id } });
    return { name: place.name, fromSubmission: Boolean(submission), unusedFiles: await unusedUploads(tx, paths) };
  });
}

module.exports = { list, findById, create, update, destroy, MISSING: Object.keys(MISSING_FILTERS) };
