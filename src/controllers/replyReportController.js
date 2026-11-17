// "รายงานความเห็นนี้": a member tells the admins a reply under a review is a problem.
// The page handler and the API handler call the same model.
const replyReportModel = require('../models/replyReport');
const AppError = require('../utils/AppError');
const { validate } = require('../utils/validate');
const { setFlash } = require('../middleware/flash');
const { parseId } = require('../utils/ids');
const { createReplyReportSchema } = require('../validation/reviewReport');

async function createReport(req) {
  const id = parseId(req.params.id);
  if (id === null) throw AppError.notFound('ไม่พบความเห็นตอบกลับนี้');
  return replyReportModel.create(req.user.id, id, validate(createReplyReportSchema, req.body));
}

// The form sends `next` so the member lands back on the reply they were
// reading. Only /places/<id> with an optional ?reviewsPage=N and a
// #review-<id> or #reply-<id> anchor is accepted; anything else means the place list.
const PLACE_NEXT = /^\/places\/[1-9]\d{0,9}(\?reviewsPage=[1-9]\d{0,5})?(#(review|reply)-[1-9]\d{0,9})?$/;
const backTo = (body) => (typeof body?.next === 'string' && PLACE_NEXT.test(body.next) ? body.next : '/places');

// Errors the member can fix or must be told about; anything else goes to the error handler.
const FIXABLE = new Set(['VALIDATION_ERROR', 'REPORT_EXISTS', 'INVALID_STATE', 'NOT_FOUND']);

// POST /replies/:id/reports
async function create(req, res) {
  let target = backTo(req.body);
  try {
    await createReport(req);
    setFlash(req, 'success', 'ขอบคุณที่รายงาน ผู้ดูแลจะตรวจสอบความเห็นนี้');
  } catch (err) {
    if (!FIXABLE.has(err.code)) throw err;
    setFlash(req, 'error', err.details?.[0]?.message ?? err.message);
    // The place page itself may be gone, and it would answer 404.
    if (err.code === 'NOT_FOUND') target = '/places';
  }
  res.redirect(303, target);
}

// POST /api/v1/replies/:id/reports
async function apiCreate(req, res) {
  res.status(201).json({ data: await createReport(req) });
}

module.exports = { create, apiCreate };
