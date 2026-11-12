// Reviews and saved places: the forms on the place page, the "my reviews"
// and "saved places" pages, and the member API. Page and API handlers call
// the same model functions.
const reviewModel = require('../models/review');
const favoriteModel = require('../models/favorite');
const placeModel = require('../models/place');
const { reviewSchema } = require('../validation/review');
const { idParamSchema } = require('../validation/place');
const { validate } = require('../utils/validate');
const { setFlash } = require('../middleware/flash');
const safeRedirect = require('../utils/safeRedirect');
const AppError = require('../utils/AppError');

// The id from the URL (/places/:id, /reviews/:id ...), or a 404.
function idFrom(value, what = 'ข้อมูล') {
  const parsed = idParamSchema.safeParse({ id: value });
  if (!parsed.success || !/^\d+$/.test(String(value))) throw AppError.notFound(`ไม่พบ${what}นี้`);
  return parsed.data.id;
}

// A page number from the query string; anything odd means page 1.
function pageFrom(value) {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1;
}

// Errors a member can fix are shown as a message on the page they came
// from; anything else goes to the error handler.
const FIXABLE = new Set(['VALIDATION_ERROR', 'REVIEW_EXISTS', 'INVALID_STATE', 'NOT_FOUND']);
function flashError(req, err) {
  if (!FIXABLE.has(err.code)) throw err;
  const detail = err.details?.[0]?.message;
  setFlash(req, 'error', detail && err.code === 'VALIDATION_ERROR' ? detail : err.message);
}

// ---------- pages: reviews ----------

// POST /places/:id/reviews
async function createFromForm(req, res) {
  const placeId = idFrom(req.params.id, 'สถานที่');
  try {
    await reviewModel.create(req.user.id, placeId, validate(reviewSchema, req.body));
    setFlash(req, 'success', 'เผยแพร่รีวิวของคุณแล้ว ขอบคุณที่แบ่งปัน');
  } catch (err) {
    flashError(req, err);
  }
  res.redirect(303, `/places/${placeId}#reviews`);
}

// POST /reviews/:id/edit
async function updateFromForm(req, res) {
  try {
    await reviewModel.update(req.user.id, idFrom(req.params.id, 'รีวิว'), validate(reviewSchema, req.body));
    setFlash(req, 'success', 'บันทึกการแก้ไขรีวิวแล้ว');
  } catch (err) {
    flashError(req, err);
  }
  res.redirect(303, '/me/reviews');
}

// POST /reviews/:id/delete
async function deleteFromForm(req, res) {
  try {
    await reviewModel.remove(req.user.id, idFrom(req.params.id, 'รีวิว'));
    setFlash(req, 'success', 'ลบรีวิวแล้ว เขียนใหม่ได้ทุกเมื่อจากหน้าสถานที่');
  } catch (err) {
    flashError(req, err);
  }
  res.redirect(303, '/me/reviews');
}

// GET /me/reviews
async function myReviews(req, res) {
  const result = await reviewModel.listOwn(req.user.id, { page: pageFrom(req.query.page) });
  res.render('my-reviews', { title: 'รีวิวของฉัน', result, pageLink: (page) => (page > 1 ? `/me/reviews?page=${page}` : '/me/reviews') });
}

// ---------- pages: saved places ----------

// POST /favorites/:placeId with action=save or action=remove.
// Without JavaScript the button posts this form; with JavaScript the page
// calls the API instead and stays where it is.
async function favoriteFromForm(req, res) {
  const placeId = idFrom(req.params.placeId, 'สถานที่');
  const next = safeRedirect(req.body?.next, `/places/${placeId}`);
  try {
    if (req.body?.action === 'remove') {
      await favoriteModel.remove(req.user.id, placeId);
      setFlash(req, 'success', 'นำออกจากรายการที่บันทึกแล้ว');
    } else {
      await favoriteModel.save(req.user.id, placeId);
      setFlash(req, 'success', 'บันทึกสถานที่แล้ว');
    }
  } catch (err) {
    flashError(req, err);
  }
  res.redirect(303, next);
}

// GET /me/favorites
async function myFavorites(req, res) {
  const result = await placeModel.savedBy(req.user.id, { page: pageFrom(req.query.page) });
  res.render('my-favorites', { title: 'ที่บันทึกไว้', result, pageLink: (page) => (page > 1 ? `/me/favorites?page=${page}` : '/me/favorites') });
}

// ---------- API ----------

// GET /api/v1/places/:id/reviews (public)
async function apiPlaceReviews(req, res) {
  const placeId = idFrom(req.params.id, 'สถานที่');
  if (!(await placeModel.findPublishedById(placeId))) throw AppError.notFound('ไม่พบสถานที่นี้');
  const { data, pagination } = await reviewModel.listForPlace(placeId, { page: pageFrom(req.query.page) });
  res.json({ data, meta: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total } });
}

// POST /api/v1/places/:id/reviews
async function apiCreate(req, res) {
  const review = await reviewModel.create(req.user.id, idFrom(req.params.id, 'สถานที่'), validate(reviewSchema, req.body));
  res.status(201).json({ data: review });
}

// PATCH /api/v1/reviews/:id
async function apiUpdate(req, res) {
  res.json({ data: await reviewModel.update(req.user.id, idFrom(req.params.id, 'รีวิว'), validate(reviewSchema, req.body)) });
}

// DELETE /api/v1/reviews/:id
async function apiDelete(req, res) {
  await reviewModel.remove(req.user.id, idFrom(req.params.id, 'รีวิว'));
  res.status(204).end();
}

// GET /api/v1/me/reviews
async function apiMyReviews(req, res) {
  const { data, pagination } = await reviewModel.listOwn(req.user.id, { page: pageFrom(req.query.page) });
  res.json({ data, meta: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total } });
}

// GET /api/v1/me/favorites
async function apiMyFavorites(req, res) {
  const { data, pagination } = await placeModel.savedBy(req.user.id, { page: pageFrom(req.query.page) });
  res.json({ data, meta: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total } });
}

// PUT /api/v1/me/favorites/:placeId — 201 the first time, 200 when already saved
async function apiSaveFavorite(req, res) {
  const { created } = await favoriteModel.save(req.user.id, idFrom(req.params.placeId, 'สถานที่'));
  res.status(created ? 201 : 200).json({ data: { placeId: Number(req.params.placeId), saved: true } });
}

// DELETE /api/v1/me/favorites/:placeId
async function apiRemoveFavorite(req, res) {
  await favoriteModel.remove(req.user.id, idFrom(req.params.placeId, 'สถานที่'));
  res.status(204).end();
}

module.exports = {
  createFromForm,
  updateFromForm,
  deleteFromForm,
  myReviews,
  favoriteFromForm,
  myFavorites,
  apiPlaceReviews,
  apiCreate,
  apiUpdate,
  apiDelete,
  apiMyReviews,
  apiMyFavorites,
  apiSaveFavorite,
  apiRemoveFavorite,
};
