// "แจ้งข้อมูลผิด": a member tells the admins that a place's information is wrong.
// The page handler and the API handler call the same model.
const placeModel = require('../models/place');
const reportModel = require('../models/report');
const AppError = require('../utils/AppError');
const { validate } = require('../utils/validate');
const { setFlash } = require('../middleware/flash');
const { parseId } = require('../utils/ids');
const { createReportSchema } = require('../validation/report');

const notFound = () => AppError.notFound('ไม่พบสถานที่นี้');

// Only a published place can be reported. An unknown or hidden place is a
// 404, so the answer does not reveal that a hidden place exists.
async function publishedPlaceId(req) {
  const id = parseId(req.params.id);
  if (id === null) throw notFound();
  const place = await placeModel.findPublishedById(id);
  if (!place) throw notFound();
  return place.id;
}

async function createReport(req) {
  const placeId = await publishedPlaceId(req);
  return reportModel.create(req.user.id, placeId, validate(createReportSchema, req.body));
}

// Errors the member can fix; anything else goes to the error handler.
const isFormError = (err) => ['VALIDATION_ERROR', 'REPORT_EXISTS'].includes(err.code);

// ---------- pages ----------

// POST /places/:id/reports
// The form is a small block on the place page, so both outcomes go back there
// with a flash message instead of rendering a separate page.
async function create(req, res) {
  const back = `/places/${encodeURIComponent(req.params.id)}#report`;
  try {
    await createReport(req);
    setFlash(req, 'success', 'ขอบคุณที่แจ้ง ผู้ดูแลจะตรวจสอบข้อมูลนี้');
  } catch (err) {
    if (!isFormError(err)) throw err;
    // The field message ("กรุณาอธิบาย...") says more than the general one.
    setFlash(req, 'error', err.details?.[0]?.message ?? err.message);
  }
  res.redirect(303, back);
}

// ---------- API ----------

// POST /api/v1/places/:id/reports
async function apiCreate(req, res) {
  res.status(201).json({ data: await createReport(req) });
}

module.exports = { create, apiCreate };
