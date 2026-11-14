// A place's photo gallery as an admin manages it. `places.image_path` is the
// cover; `place_photos` holds the other photos (position 0, 1, 2 ...). A place
// has at most 10 photos in all. Every change runs in one transaction that
// first locks the place row, so two admins changing the same gallery at once
// are applied one after the other, and positions stay 0..n-1 without gaps.
//
// Each function returns { gallery, unusedFiles }. The caller deletes
// `unusedFiles` from storage only after this returned (the transaction has
// committed).
const prisma = require('../config/db');
const AppError = require('../utils/AppError');
const { unusedUploads } = require('./photoUsage');

const MAX_PHOTOS = 10;
// Higher than any real position (the table allows 0..32767, we use <= 9).
const TEMP_POSITION = 32000;

const photoNotFound = () => AppError.notFound('ไม่พบรูปนี้');

// Locks the place row until the transaction ends. Unknown place: 404.
async function lockPlace(tx, placeId) {
  const rows = await tx.$queryRaw`SELECT id FROM places WHERE id = ${placeId} FOR UPDATE`;
  if (rows.length === 0) throw AppError.notFound('ไม่พบสถานที่นี้');
}

const galleryRows = (tx, placeId) =>
  tx.placePhoto.findMany({ where: { placeId }, orderBy: { position: 'asc' }, select: { id: true, imagePath: true, position: true } });

async function readGallery(tx, placeId) {
  const [place, photos] = await Promise.all([tx.place.findUnique({ where: { id: placeId }, select: { imagePath: true } }), galleryRows(tx, placeId)]);
  return { cover: place.imagePath, photos };
}

// After a row was deleted: close the gap. Going upwards is safe because each
// photo moves into a position that was just freed.
async function compact(tx, placeId) {
  const photos = await galleryRows(tx, placeId);
  for (const [index, photo] of photos.entries()) {
    if (photo.position !== index) await tx.placePhoto.update({ where: { id: photo.id }, data: { position: index } });
  }
}

// Runs `work(tx)` on the locked place; `work` returns the file paths that may
// have become unused. The result is the new gallery and those still unused.
async function change(placeId, work) {
  return prisma.$transaction(async (tx) => {
    await lockPlace(tx, placeId);
    const candidates = (await work(tx)) ?? [];
    const gallery = await readGallery(tx, placeId);
    // Asked after the change, so this place no longer counts as a user.
    const unusedFiles = await unusedUploads(tx, candidates);
    return { gallery, unusedFiles };
  });
}

// The photo must be one of this place's, otherwise the id is someone else's.
async function ownPhoto(tx, placeId, photoId) {
  const photo = await tx.placePhoto.findFirst({ where: { id: photoId, placeId } });
  if (!photo) throw photoNotFound();
  return photo;
}

// Adds stored photos. With no cover yet the first one becomes the cover.
async function add(placeId, paths) {
  return change(placeId, async (tx) => {
    const { cover, photos } = await readGallery(tx, placeId);
    const total = (cover ? 1 : 0) + photos.length + paths.length;
    if (total > MAX_PHOTOS) {
      const message = `สถานที่หนึ่งแห่งมีรูปได้ไม่เกิน ${MAX_PHOTOS} รูป`;
      throw new AppError(400, 'VALIDATION_ERROR', message, [{ field: 'photos', message }]);
    }
    const rest = [...paths];
    if (!cover && rest.length) await tx.place.update({ where: { id: placeId }, data: { imagePath: rest.shift() } });
    if (rest.length) {
      await tx.placePhoto.createMany({ data: rest.map((imagePath, index) => ({ placeId, imagePath, position: photos.length + index })) });
    }
    return [];
  });
}

// Swaps the cover with a gallery photo (it keeps the photo's position).
async function makeCover(placeId, photoId) {
  return change(placeId, async (tx) => {
    const photo = await ownPhoto(tx, placeId, photoId);
    const { cover } = await readGallery(tx, placeId);
    await tx.place.update({ where: { id: placeId }, data: { imagePath: photo.imagePath } });
    if (cover) {
      await tx.placePhoto.update({ where: { id: photo.id }, data: { imagePath: cover } });
    } else {
      await tx.placePhoto.delete({ where: { id: photo.id } });
      await compact(tx, placeId);
    }
    return [];
  });
}

// Moves a photo one step up (towards position 0) or down. At an end: no change.
async function move(placeId, photoId, direction) {
  return change(placeId, async (tx) => {
    const photo = await ownPhoto(tx, placeId, photoId);
    const neighbour = await tx.placePhoto.findFirst({
      where: { placeId, position: direction === 'up' ? photo.position - 1 : photo.position + 1 },
    });
    if (!neighbour) return [];
    // The pair (placeId, position) is unique and not deferrable: park one row first.
    await tx.placePhoto.update({ where: { id: photo.id }, data: { position: TEMP_POSITION } });
    await tx.placePhoto.update({ where: { id: neighbour.id }, data: { position: photo.position } });
    await tx.placePhoto.update({ where: { id: photo.id }, data: { position: neighbour.position } });
    return [];
  });
}

async function remove(placeId, photoId) {
  return change(placeId, async (tx) => {
    const photo = await ownPhoto(tx, placeId, photoId);
    await tx.placePhoto.delete({ where: { id: photo.id } });
    await compact(tx, placeId);
    return [photo.imagePath];
  });
}

// Removes the cover; the first gallery photo takes its place.
async function removeCover(placeId) {
  return change(placeId, async (tx) => {
    const { cover, photos } = await readGallery(tx, placeId);
    const [first] = photos;
    await tx.place.update({ where: { id: placeId }, data: { imagePath: first ? first.imagePath : null } });
    if (first) {
      await tx.placePhoto.delete({ where: { id: first.id } });
      await compact(tx, placeId);
    }
    return cover ? [cover] : [];
  });
}

module.exports = { add, makeCover, move, remove, removeCover, MAX_PHOTOS };
