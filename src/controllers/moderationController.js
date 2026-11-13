// Admin: removing reviews and closing "wrong information" reports.
// The page handlers and the API handlers call the same model functions.
const reviewModel = require('../models/review');
const reportModel = require('../models/report');
const { removeReviewSchema, closeReportSchema } = require('../validation/moderation');
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

// GET /admin/reviews
async function reviewsPage(req, res) {
  const status = filterFrom(req.query.status, REVIEW_FILTERS, 'all');
  const result = await reviewModel.listAll({ status, page: pageFrom(req.query.page) });
  res.render('admin/reviews', {
    title: 'ดูแลรีวิว',
    result,
    status,
    pageLink: (page) => listUrl('/admin/reviews', 'all', status, page),
  });
}

// POST /admin/reviews/:id/remove
async function removeReviewFromForm(req, res) {
  const status = filterFrom(req.body?.status, REVIEW_FILTERS, 'all');
  try {
    const id = idFrom(req.params.id, 'รีวิว');
    await reviewModel.adminRemove(req.user.id, id, validate(removeReviewSchema, req.body).reason);
    setFlash(req, 'success', 'นำรีวิวออกแล้ว และคำนวณคะแนนของสถานที่ใหม่แล้ว');
  } catch (err) {
    flashError(req, err);
  }
  res.redirect(303, listUrl('/admin/reviews', 'all', status, 1));
}

// GET /api/v1/admin/reviews
async function apiReviews(req, res) {
  const status = filterFrom(req.query.status, REVIEW_FILTERS, 'all');
  const { data, pagination } = await reviewModel.listAll({ status, page: pageFrom(req.query.page) });
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
    reasonLabels: REPORT_REASONS,
    pageLink: (page) => listUrl('/admin/reports', 'open', status, page),
  });
}

// POST /admin/reports/:id/resolve
async function closeReportFromForm(req, res) {
  const filter = filterFrom(req.body?.filter, REPORT_FILTERS, 'open');
  try {
    const id = idFrom(req.params.id, 'รายการแจ้ง');
    const { status } = validate(closeReportSchema, req.body);
    await reportModel.close(req.user.id, id, status);
    setFlash(req, 'success', status === 'resolved' ? 'ปิดรายการแล้ว (แก้ไขแล้ว)' : 'ปิดรายการแล้ว (ไม่ดำเนินการ)');
  } catch (err) {
    flashError(req, err);
  }
  res.redirect(303, listUrl('/admin/reports', 'open', filter, 1));
}

// GET /api/v1/admin/reports
async function apiReports(req, res) {
  const status = filterFrom(req.query.status, REPORT_FILTERS, 'open');
  const { data, pagination } = await reportModel.listAll({ status, page: pageFrom(req.query.page) });
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
  removeReviewFromForm,
  apiReviews,
  apiRemoveReview,
  reportsPage,
  closeReportFromForm,
  apiReports,
  apiCloseReport,
};
