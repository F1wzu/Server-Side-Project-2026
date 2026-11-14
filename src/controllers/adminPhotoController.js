// Admin: the photo gallery of one place (cover plus up to 9 more photos).
// Page handlers and API handlers call the same model functions
// (src/models/placePhoto.js).
const { z } = require('zod');
const adminPlaceModel = require('../models/adminPlace');
const placePhotoModel = require('../models/placePhoto');
const { parseId } = require('../utils/ids');
const { validate } = require('../utils/validate');
const { storePhotos } = require('../utils/photo');
const storage = require('../storage');
const { setFlash } = require('../middleware/flash');
const AppError = require('../utils/AppError');

const PHOTO_NOT_FOUND = 'ไม่พบรูปนี้';

const directionSchema = z.object({
  direction: z.enum(['up', 'down'], { error: 'ทิศทางต้องเป็น up หรือ down' }),
});

// The id from the URL, or a 404.
function placeId(req) {
  const id = parseId(req.params.id);
  if (id === null) throw AppError.notFound('ไม่พบสถานที่นี้');
  return id;
}

function photoId(req) {
  const id = parseId(req.params.photoId);
  if (id === null) throw AppError.notFound(PHOTO_NOT_FOUND);
  return id;
}

// Files nothing uses any more go only after the transaction has committed.
async function removeFiles(paths) {
  await Promise.all(paths.map((path) => storage.remove(path).catch(() => {})));
}

// Stores the uploaded files first (all or nothing), adds them, and deletes
// them again if the database step is refused, so no orphan files are left.
async function addUploaded(id, files) {
  if (files.length === 0) {
    const message = 'กรุณาเลือกรูปอย่างน้อย 1 รูป';
    throw new AppError(400, 'VALIDATION_ERROR', message, [{ field: 'photos', message }]);
  }
  await adminPlaceModel.findById(id); // 404 before anything is stored
  const paths = await storePhotos(files);
  try {
    const result = await placePhotoModel.add(id, paths);
    await removeFiles(result.unusedFiles);
    return result.gallery;
  } catch (err) {
    await removeFiles(paths);
    throw err;
  }
}

// ---------- pages ----------

// Errors the admin can fix by trying again; they come back as a message on
// the gallery page. Anything else (unknown place, server error) is real.
const isFixable = (err) =>
  ['VALIDATION_ERROR', 'UNSUPPORTED_FILE', 'FILE_TOO_LARGE'].includes(err.code) || (err.code === 'NOT_FOUND' && err.message === PHOTO_NOT_FOUND);

// Runs a form action, then goes back to the gallery with a message.
function formAction(work, successText) {
  return async function handler(req, res) {
    const id = placeId(req);
    try {
      if (req.uploadError) throw req.uploadError; // the upload failed before this point
      await work(req, id);
      setFlash(req, 'success', successText);
    } catch (err) {
      if (!isFixable(err)) throw err;
      setFlash(req, 'error', err.message);
    }
    return res.redirect(303, `/admin/places/${id}/photos`);
  };
}

// GET /admin/places/:id/photos
async function show(req, res) {
  const place = await adminPlaceModel.findById(placeId(req)); // 404 when unknown
  const count = (place.imagePath ? 1 : 0) + place.photos.length;
  res.render('admin/place-photos', { title: `รูปภาพ ${place.name}`, place, count, max: placePhotoModel.MAX_PHOTOS });
}

const add = formAction(async (req, id) => {
  await addUploaded(id, req.photoFiles ?? []);
}, 'เพิ่มรูปแล้ว');

const makeCover = formAction(async (req, id) => {
  const result = await placePhotoModel.makeCover(id, photoId(req));
  await removeFiles(result.unusedFiles);
}, 'ตั้งเป็นรูปหลักแล้ว');

const move = formAction(async (req, id) => {
  const { direction } = validate(directionSchema, req.body);
  const result = await placePhotoModel.move(id, photoId(req), direction);
  await removeFiles(result.unusedFiles);
}, 'ย้ายตำแหน่งรูปแล้ว');

const remove = formAction(async (req, id) => {
  const result = await placePhotoModel.remove(id, photoId(req));
  await removeFiles(result.unusedFiles);
}, 'ลบรูปแล้ว');

const removeCover = formAction(async (req, id) => {
  const result = await placePhotoModel.removeCover(id);
  await removeFiles(result.unusedFiles);
}, 'ลบรูปหลักแล้ว');

// ---------- API ----------

// POST /api/v1/admin/places/:id/photos (multipart: photos, one or many)
async function apiAdd(req, res) {
  res.status(201).json({ data: await addUploaded(placeId(req), req.photoFiles ?? []) });
}

// POST /api/v1/admin/places/:id/photos/:photoId/cover
async function apiMakeCover(req, res) {
  const result = await placePhotoModel.makeCover(placeId(req), photoId(req));
  await removeFiles(result.unusedFiles);
  res.json({ data: result.gallery });
}

// POST /api/v1/admin/places/:id/photos/:photoId/move  { direction: 'up' | 'down' }
async function apiMove(req, res) {
  const id = placeId(req);
  const { direction } = validate(directionSchema, req.body);
  const result = await placePhotoModel.move(id, photoId(req), direction);
  await removeFiles(result.unusedFiles);
  res.json({ data: result.gallery });
}

// DELETE /api/v1/admin/places/:id/photos/:photoId
async function apiRemove(req, res) {
  const result = await placePhotoModel.remove(placeId(req), photoId(req));
  await removeFiles(result.unusedFiles);
  res.status(204).end();
}

// DELETE /api/v1/admin/places/:id/cover
async function apiRemoveCover(req, res) {
  const result = await placePhotoModel.removeCover(placeId(req));
  await removeFiles(result.unusedFiles);
  res.json({ data: result.gallery });
}

module.exports = { show, add, makeCover, move, remove, removeCover, apiAdd, apiMakeCover, apiMove, apiRemove, apiRemoveCover };
