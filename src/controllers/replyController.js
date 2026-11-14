// Replies under a review: the forms on the place page and the member API.
// Page and API handlers call the same model functions (src/models/reply.js).
const replyModel = require('../models/reply');
const { replySchema } = require('../validation/reply');
const { parseId } = require('../utils/ids');
const { validate } = require('../utils/validate');
const { setFlash } = require('../middleware/flash');
const AppError = require('../utils/AppError');

function idFrom(value, what) {
  const id = parseId(value);
  if (id === null) throw AppError.notFound(`ไม่พบ${what}นี้`);
  return id;
}

// The forms send `next` so the member lands back on the review they were
// reading. Only /places/<id> with an optional #review-<id> is accepted;
// anything else (other sites, //host, odd ids) means the place list.
const PLACE_NEXT = /^\/places\/[1-9]\d{0,9}(#review-[1-9]\d{0,9})?$/;
const backTo = (body) => (typeof body?.next === 'string' && PLACE_NEXT.test(body.next) ? body.next : '/places');

const FIXABLE = new Set(['VALIDATION_ERROR', 'INVALID_STATE', 'NOT_FOUND']);
function flashError(req, err) {
  if (!FIXABLE.has(err.code)) throw err;
  const detail = err.details?.[0]?.message;
  setFlash(req, 'error', detail && err.code === 'VALIDATION_ERROR' ? detail : err.message);
}

// Runs a form action, flashes the outcome, and goes back to `next`.
async function formAction(req, res, action, success) {
  try {
    await action();
    setFlash(req, 'success', success);
  } catch (err) {
    flashError(req, err);
  }
  res.redirect(303, backTo(req.body));
}

// ---------- pages ----------

// POST /reviews/:id/replies
const createFromForm = (req, res) =>
  formAction(req, res, () => replyModel.create(req.user.id, idFrom(req.params.id, 'รีวิว'), validate(replySchema, req.body).body), 'ตอบกลับรีวิวแล้ว');

// POST /replies/:id/edit
const updateFromForm = (req, res) =>
  formAction(req, res, () => replyModel.update(req.user.id, idFrom(req.params.id, 'ความเห็นตอบกลับ'), validate(replySchema, req.body).body), 'บันทึกการแก้ไขแล้ว');

// POST /replies/:id/delete
const deleteFromForm = (req, res) =>
  formAction(req, res, () => replyModel.remove(req.user.id, idFrom(req.params.id, 'ความเห็นตอบกลับ')), 'ลบความเห็นตอบกลับแล้ว');

// ---------- API ----------

// POST /api/v1/reviews/:id/replies
async function apiCreate(req, res) {
  const reply = await replyModel.create(req.user.id, idFrom(req.params.id, 'รีวิว'), validate(replySchema, req.body).body);
  res.status(201).json({ data: reply });
}

// PATCH /api/v1/replies/:id
async function apiUpdate(req, res) {
  const reply = await replyModel.update(req.user.id, idFrom(req.params.id, 'ความเห็นตอบกลับ'), validate(replySchema, req.body).body);
  res.json({ data: reply });
}

// DELETE /api/v1/replies/:id
async function apiDelete(req, res) {
  await replyModel.remove(req.user.id, idFrom(req.params.id, 'ความเห็นตอบกลับ'));
  res.status(204).end();
}

module.exports = { createFromForm, updateFromForm, deleteFromForm, apiCreate, apiUpdate, apiDelete };
