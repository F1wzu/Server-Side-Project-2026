// "รายงานรีวิวนี้": a member tells the admins a review is a problem.
// The page handler and the API handler call the same model.
const reviewReportModel = require('../models/reviewReport');
const AppError = require('../utils/AppError');
const { validate } = require('../utils/validate');
const { setFlash } = require('../middleware/flash');
const { parseId } = require('../utils/ids');
const { createReviewReportSchema } = require('../validation/reviewReport');

async function createReport(req) {
  const id = parseId(req.params.id);
  if (id === null) throw AppError.notFound('ไม่พบรีวิวนี้');
  return reviewReportModel.create(req.user.id, id, validate(createReviewReportSchema, req.body));
}

// The form sends `next` so the member lands back on the review they were
// reading. Only /places/<id> with an optional ?reviewsPage=N and #review-<id>
// is accepted; anything else means the place list.
const PLACE_NEXT = /^\/places\/[1-9]\d{0,9}(\?reviewsPage=[1-9]\d{0,5})?(#review-[1-9]\d{0,9})?$/;
const backTo = (body) => (typeof body?.next === 'string' && PLACE_NEXT.test(body.next) ? body.next : '/places');

// Errors the member can fix or must be told about; anything else goes to the error handler.
const FIXABLE = new Set(['VALIDATION_ERROR', 'REPORT_EXISTS', 'INVALID_STATE', 'NOT_FOUND']);

// POST /reviews/:id/reports
async function create(req, res) {
  let target = backTo(req.body);
  try {
    await createReport(req);
    setFlash(req, 'success', 'ขอบคุณที่รายงาน ผู้ดูแลจะตรวจสอบรีวิวนี้');
  } catch (err) {
    if (!FIXABLE.has(err.code)) throw err;
    setFlash(req, 'error', err.details?.[0]?.message ?? err.message);
    // The place page itself may be gone, and it would answer 404.
    if (err.code === 'NOT_FOUND') target = '/places';
  }
  res.redirect(303, target);
}

// POST /api/v1/reviews/:id/reports
async function apiCreate(req, res) {
  res.status(201).json({ data: await createReport(req) });
}

module.exports = { create, apiCreate };
