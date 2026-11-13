// Admin: the submission queue and the decisions on a submission.
// Page handlers and API handlers call the same model.
const adminSubmissionModel = require('../models/adminSubmission');
const { approveSchema, reasonSchema } = require('../validation/adminSubmission');
const { LAT_KRABANG } = require('../validation/submission');
const { validate } = require('../utils/validate');
const { parseId } = require('../utils/ids');
const { setFlash } = require('../middleware/flash');
const AppError = require('../utils/AppError');
const { STATUS_LABELS, ACTION_LABELS } = require('./submissionController');

const FILTERS = [...adminSubmissionModel.STATUSES, 'all'];

function submissionId(req) {
  const id = parseId(req.params.id);
  if (id === null) throw AppError.notFound('ไม่พบคำขอนี้');
  return id;
}

function listQuery(query) {
  const page = /^[1-9]\d{0,5}$/.test(String(query.page ?? '')) ? Number(query.page) : 1;
  return { status: FILTERS.includes(query.status) ? query.status : 'pending', page };
}

const pinFrom = (input) => (input.latitude === undefined ? null : { latitude: input.latitude, longitude: input.longitude });

// A decision that could not be made (stale page, already decided, missing
// reason) is shown as a message on the submission's page.
const FIXABLE = new Set(['VALIDATION_ERROR', 'STALE_VERSION', 'INVALID_STATE']);
async function decideFromForm(req, res, work, success) {
  const id = submissionId(req);
  try {
    const redirect = await work(id);
    setFlash(req, 'success', success);
    return res.redirect(303, redirect ?? '/admin/submissions');
  } catch (err) {
    if (!FIXABLE.has(err.code)) throw err;
    setFlash(req, 'error', err.details?.[0]?.message ?? err.message);
    return res.redirect(303, `/admin/submissions/${id}`);
  }
}

// ---------- pages ----------

// GET /admin/submissions
async function list(req, res) {
  const { status, page } = listQuery(req.query);
  const result = await adminSubmissionModel.list({ status, page });
  res.render('admin/submissions', {
    title: 'ตรวจสอบคำขอ',
    result,
    status,
    statusLabels: STATUS_LABELS,
    pageLink: (n) => `/admin/submissions?status=${status}${n > 1 ? `&page=${n}` : ''}`,
  });
}

// GET /admin/submissions/:id
async function show(req, res) {
  const submission = await adminSubmissionModel.find(submissionId(req));
  res.render('admin/submission', {
    title: `คำขอ #${submission.id}`,
    submission,
    statusLabels: STATUS_LABELS,
    actionLabels: ACTION_LABELS,
    bounds: LAT_KRABANG,
    withMap: true,
  });
}

// POST /admin/submissions/:id/approve
function approve(req, res) {
  return decideFromForm(
    req,
    res,
    async (id) => {
      const input = validate(approveSchema, req.body);
      const { placeId } = await adminSubmissionModel.approve(req.user.id, id, input.version, pinFrom(input));
      return `/places/${placeId}`;
    },
    'อนุมัติแล้ว สถานที่นี้เผยแพร่บนเว็บไซต์แล้ว'
  );
}

// POST /admin/submissions/:id/return
function returnForChanges(req, res) {
  return decideFromForm(
    req,
    res,
    async (id) => {
      const { version, reason } = validate(reasonSchema, req.body);
      await adminSubmissionModel.returnForChanges(req.user.id, id, version, reason);
    },
    'ส่งคำขอกลับให้สมาชิกแก้ไขแล้ว'
  );
}

// POST /admin/submissions/:id/reject
function reject(req, res) {
  return decideFromForm(
    req,
    res,
    async (id) => {
      const { version, reason } = validate(reasonSchema, req.body);
      await adminSubmissionModel.reject(req.user.id, id, version, reason);
    },
    'ปฏิเสธคำขอแล้ว'
  );
}

// ---------- API ----------

// GET /api/v1/admin/submissions
async function apiList(req, res) {
  const { data, pagination } = await adminSubmissionModel.list(listQuery(req.query));
  res.json({ data, meta: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total } });
}

// GET /api/v1/admin/submissions/:id
async function apiShow(req, res) {
  res.json({ data: await adminSubmissionModel.find(submissionId(req)) });
}

// POST /api/v1/admin/submissions/:id/approve
async function apiApprove(req, res) {
  const input = validate(approveSchema, req.body);
  res.status(201).json({ data: await adminSubmissionModel.approve(req.user.id, submissionId(req), input.version, pinFrom(input)) });
}

// POST /api/v1/admin/submissions/:id/return
async function apiReturn(req, res) {
  const { version, reason } = validate(reasonSchema, req.body);
  res.json({ data: await adminSubmissionModel.returnForChanges(req.user.id, submissionId(req), version, reason) });
}

// POST /api/v1/admin/submissions/:id/reject
async function apiReject(req, res) {
  const { version, reason } = validate(reasonSchema, req.body);
  res.json({ data: await adminSubmissionModel.reject(req.user.id, submissionId(req), version, reason) });
}

module.exports = { list, show, approve, returnForChanges, reject, apiList, apiShow, apiApprove, apiReturn, apiReject };
