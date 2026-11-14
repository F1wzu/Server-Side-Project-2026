// Admin: removing reviews and closing "wrong information" reports.
// The page handlers and the API handlers call the same model functions.
const reviewModel = require('../models/review');
const reportModel = require('../models/report');
const replyModel = require('../models/reply');
const adminPlaceModel = require('../models/adminPlace');
const { removeReviewSchema, removeReplySchema, closeReportSchema } = require('../validation/moderation');
const { REPORT_REASONS } = require('../validation/report');
const { parseId } = require('../utils/ids');
const { validate } = require('../utils/validate');
const { setFlash } = require('../middleware/flash');
const AppError = require('../utils/AppError');

const REVIEW_FILTERS = ['all', 'active', 'deleted', 'removed'];
const REPORT_FILTERS = ['open', 'resolved', 'dismissed', 'all'];

function idFrom(value, what) {
  const id = parseId(value);
  if (id === null) throw AppError.notFound(`ไม่พบ${what}นี้`);
  return id;
}

function pageFrom(value) {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1;
}

// Only a known filter is used (it ends up in a redirect URL).
const filterFrom = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

const FIXABLE = new Set(['VALIDATION_ERROR', 'INVALID_STATE', 'NOT_FOUND']);
function flashError(req, err) {
  if (!FIXABLE.has(err.code)) throw err;
  const detail = err.details?.[0]?.message;
  setFlash(req, 'error', detail && err.code === 'VALIDATION_ERROR' ? detail : err.message);
}

const meta = ({ page, pageSize, total }) => ({ page, pageSize, total });

function listUrl(base, defaultStatus, status, page) {
  const query = new URLSearchParams();
  if (status !== defaultStatus) query.set('status', status);
  if (page > 1) query.set('page', page);
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

// ---------- reviews ----------

// The place a review list is scoped to, from a URL or form value. Unknown or
// malformed ids answer 404 (via findById), so a typo never shows every review.
async function scopedPlace(value) {
  const id = idFrom(value, 'สถานที่');
  const place = await adminPlaceModel.findById(id);
  return { id: place.id, name: place.name, status: place.status };
}

const placeReviewsBase = (placeId) => `/admin/places/${placeId}/reviews`;
const placeReportsBase = (placeId) => `/admin/places/${placeId}/reports`;

// ?placeId= on an API list: absent or empty means every place.
async function placeIdFromQuery(value) {
  if (value === undefined || value === '') return null;
  return (await scopedPlace(value)).id;
}

// GET /admin/reviews  (every place)
async function reviewsPage(req, res) {
  const status = filterFrom(req.query.status, REVIEW_FILTERS, 'all');
  const result = await reviewModel.listAll({ status, page: pageFrom(req.query.page) });
  res.render('admin/reviews', {
    title: 'ดูแลรีวิว',
    result,
    status,
    place: null,
    listBase: '/admin/reviews',
    pageLink: (page) => listUrl('/admin/reviews', 'all', status, page),
  });
}

// GET /admin/places/:id/reviews  (the "reviews" tab of one place)
async function placeReviewsPage(req, res) {
  const place = await scopedPlace(req.params.id);
  const status = filterFrom(req.query.status, REVIEW_FILTERS, 'all');
  const result = await reviewModel.listAll({ status, placeId: place.id, page: pageFrom(req.query.page) });
  const base = placeReviewsBase(place.id);
  res.render('admin/reviews', {
    title: `รีวิวของ ${place.name}`,
    result,
    status,
    place,
    listBase: base,
    pageLink: (page) => listUrl(base, 'all', status, page),
  });
}

// POST /admin/reviews/:id/remove
// A form on a place's reviews tab sends placeId, so the admin lands back on
// that tab instead of the site-wide list.
async function removeReviewFromForm(req, res) {
  const status = filterFrom(req.body?.status, REVIEW_FILTERS, 'all');
  const backPlaceId = parseId(req.body?.placeId);
  try {
    const id = idFrom(req.params.id, 'รีวิว');
    await reviewModel.adminRemove(req.user.id, id, validate(removeReviewSchema, req.body).reason);
    setFlash(req, 'success', 'นำรีวิวออกแล้ว และคำนวณคะแนนของสถานที่ใหม่แล้ว');
  } catch (err) {
    flashError(req, err);
  }
  const base = backPlaceId === null ? '/admin/reviews' : placeReviewsBase(backPlaceId);
  res.redirect(303, listUrl(base, 'all', status, 1));
}

// POST /admin/replies/:id/remove  (from a review card on either reviews page;
// the form sends status and placeId like the review removal form)
async function removeReplyFromForm(req, res) {
  const status = filterFrom(req.body?.status, REVIEW_FILTERS, 'all');
  const backPlaceId = parseId(req.body?.placeId);
  try {
    const id = idFrom(req.params.id, 'ความเห็นตอบกลับ');
    await replyModel.adminRemove(req.user.id, id, validate(removeReplySchema, req.body).reason);
    setFlash(req, 'success', 'นำความเห็นตอบกลับออกแล้ว');
  } catch (err) {
    flashError(req, err);
  }
  const base = backPlaceId === null ? '/admin/reviews' : placeReviewsBase(backPlaceId);
  res.redirect(303, listUrl(base, 'all', status, 1));
}

// POST /api/v1/admin/replies/:id/remove
async function apiRemoveReply(req, res) {
  const id = idFrom(req.params.id, 'ความเห็นตอบกลับ');
  res.json({ data: await replyModel.adminRemove(req.user.id, id, validate(removeReplySchema, req.body).reason) });
}

// GET /api/v1/admin/reviews  (?status=…&placeId=…&page=…)
async function apiReviews(req, res) {
  const status = filterFrom(req.query.status, REVIEW_FILTERS, 'all');
  const placeId = await placeIdFromQuery(req.query.placeId);
  const { data, pagination } = await reviewModel.listAll({ status, placeId, page: pageFrom(req.query.page) });
  res.json({ data, meta: meta(pagination) });
}

// POST /api/v1/admin/reviews/:id/remove
async function apiRemoveReview(req, res) {
  const id = idFrom(req.params.id, 'รีวิว');
  res.json({ data: await reviewModel.adminRemove(req.user.id, id, validate(removeReviewSchema, req.body).reason) });
}

// ---------- reports ----------

// GET /admin/reports
async function reportsPage(req, res) {
  const status = filterFrom(req.query.status, REPORT_FILTERS, 'open');
  const result = await reportModel.listAll({ status, page: pageFrom(req.query.page) });
  res.render('admin/reports', {
    title: 'แจ้งข้อมูลผิด',
    result,
    status,
    place: null,
    listBase: '/admin/reports',
    reasonLabels: REPORT_REASONS,
    pageLink: (page) => listUrl('/admin/reports', 'open', status, page),
  });
}

// GET /admin/places/:id/reports  (the "reports" tab of one place)
async function placeReportsPage(req, res) {
  const place = await scopedPlace(req.params.id);
  const status = filterFrom(req.query.status, REPORT_FILTERS, 'open');
  const result = await reportModel.listAll({ status, placeId: place.id, page: pageFrom(req.query.page) });
  const base = placeReportsBase(place.id);
  res.render('admin/reports', {
    title: `แจ้งข้อมูลผิดของ ${place.name}`,
    result,
    status,
    place,
    listBase: base,
    reasonLabels: REPORT_REASONS,
    pageLink: (page) => listUrl(base, 'open', status, page),
  });
}

// POST /admin/reports/:id/resolve
// A form on a place's reports tab sends placeId, so the admin lands back there.
async function closeReportFromForm(req, res) {
  const filter = filterFrom(req.body?.filter, REPORT_FILTERS, 'open');
  const backPlaceId = parseId(req.body?.placeId);
  try {
    const id = idFrom(req.params.id, 'รายการแจ้ง');
    const { status } = validate(closeReportSchema, req.body);
    await reportModel.close(req.user.id, id, status);
    setFlash(req, 'success', status === 'resolved' ? 'ปิดรายการแล้ว (แก้ไขแล้ว)' : 'ปิดรายการแล้ว (ไม่ดำเนินการ)');
  } catch (err) {
    flashError(req, err);
  }
  const base = backPlaceId === null ? '/admin/reports' : placeReportsBase(backPlaceId);
  res.redirect(303, listUrl(base, 'open', filter, 1));
}

// GET /api/v1/admin/reports
async function apiReports(req, res) {
  const status = filterFrom(req.query.status, REPORT_FILTERS, 'open');
  const placeId = await placeIdFromQuery(req.query.placeId);
  const { data, pagination } = await reportModel.listAll({ status, placeId, page: pageFrom(req.query.page) });
  res.json({ data, meta: meta(pagination) });
}

// POST /api/v1/admin/reports/:id/resolve
async function apiCloseReport(req, res) {
  const id = idFrom(req.params.id, 'รายการแจ้ง');
  const { status } = validate(closeReportSchema, req.body);
  res.json({ data: await reportModel.close(req.user.id, id, status) });
}

module.exports = {
  reviewsPage,
  placeReviewsPage,
  removeReviewFromForm,
  apiReviews,
  apiRemoveReview,
  removeReplyFromForm,
  apiRemoveReply,
  reportsPage,
  placeReportsPage,
  closeReportFromForm,
  apiReports,
  apiCloseReport,
};
