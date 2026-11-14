// Members proposing places: the form, "my submissions", one submission with
// its history, editing a returned submission, and sending it back for review.
// Page handlers and API handlers call the same model.
const submissionModel = require('../models/submission');
const categoryModel = require('../models/category');
const { readSubmission, versionSchema, LAT_KRABANG } = require('../validation/submission');
const { parseId } = require('../utils/ids');
const { validate, errorsByField } = require('../utils/validate');
const { storePhotos } = require('../utils/photo');
const storage = require('../storage');
const { setFlash } = require('../middleware/flash');
const AppError = require('../utils/AppError');

const STATUS_LABELS = { pending: 'รอตรวจสอบ', changes_requested: 'รอแก้ไข', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' };
const ACTION_LABELS = {
  submitted: 'ส่งคำขอ',
  edited: 'บันทึกการแก้ไข',
  resubmitted: 'ส่งตรวจสอบอีกครั้ง',
  returned: 'ผู้ดูแลส่งกลับให้แก้ไข',
  approved: 'อนุมัติและเผยแพร่',
  rejected: 'ผู้ดูแลไม่อนุมัติ',
};

// The id from the URL, or a 404. /me/submissions/01 is not /me/submissions/1.
function submissionId(req) {
  const id = parseId(req.params.id);
  if (id === null) throw AppError.notFound('ไม่พบคำขอนี้');
  return id;
}

const pageFrom = (value) => {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1;
};

// The submission's content, or a 400 listing every problem.
function validContent(body) {
  const { data, issues } = readSubmission(body);
  if (!data) {
    const details = issues.map((issue) => ({ field: issue.path.join('.') || 'body', message: issue.message }));
    throw new AppError(400, 'VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', details);
  }
  return data;
}

// Stores the photos only after the rest of the form passed (all or nothing),
// and deletes them again if the database step fails, so no orphan files are
// left behind.
async function withStoredPhotos(files, work) {
  const imagePaths = await storePhotos(files);
  try {
    return await work(imagePaths);
  } catch (err) {
    await Promise.all(imagePaths.map((path) => storage.remove(path).catch(() => {})));
    throw err;
  }
}

// Replaced files nothing uses any more; deleted only after the update committed.
const removeFiles = (paths) => Promise.all(paths.map((path) => storage.remove(path).catch(() => {})));

// Form values to show again after an error (strings, as typed).
function formValues(body, submission) {
  if (!body) {
    if (!submission) return { hours: Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'unknown' })) };
    return { ...submission, latitude: submission.latitude ?? '', longitude: submission.longitude ?? '' };
  }
  const hours = Array.from({ length: 7 }, (unused, weekday) => ({
    weekday,
    state: body[`state${weekday}`] || 'unknown',
    opensAt: body[`opens${weekday}`] || '',
    closesAt: body[`closes${weekday}`] || '',
    closesNextDay: body[`next${weekday}`] === 'on',
  }));
  return { ...body, hours, imagePath: submission?.imagePath, extraImagePaths: submission?.extraImagePaths ?? [] };
}

async function renderForm(res, { status = 200, submission = null, body = null, errors = {}, formError = null }) {
  const categories = await categoryModel.listWithCounts();
  res.status(status).render('submission-form', {
    title: submission ? 'แก้ไขคำขอ' : 'แนะนำสถานที่',
    submission,
    values: formValues(body, submission),
    errors,
    formError,
    categories,
    bounds: LAT_KRABANG,
    withMap: true,
  });
}

// Errors the member can fix on the form; anything else goes to the error page.
const FORM_ERRORS = new Set(['VALIDATION_ERROR', 'UNSUPPORTED_FILE', 'FILE_TOO_LARGE']);
const photoField = (err) => (['UNSUPPORTED_FILE', 'FILE_TOO_LARGE'].includes(err.code) ? { photo: err.message } : {});

// ---------- pages ----------

// GET /submissions/new
async function newForm(req, res) {
  await renderForm(res, {});
}

// POST /submissions (multipart, with an optional photo)
async function create(req, res) {
  try {
    const data = validContent(req.body);
    const submission = await withStoredPhotos(req.photoFiles, (imagePaths) => submissionModel.create(req.user.id, data, imagePaths));
    setFlash(req, 'success', 'ส่งคำขอแล้ว ผู้ดูแลจะตรวจสอบก่อนเผยแพร่');
    return res.redirect(303, `/me/submissions/${submission.id}`);
  } catch (err) {
    if (!FORM_ERRORS.has(err.code)) throw err;
    return renderForm(res, { status: err.status, body: req.body, errors: { ...errorsByField(err), ...photoField(err) }, formError: err.message });
  }
}

// GET /me/submissions
async function mine(req, res) {
  const result = await submissionModel.listOwn(req.user.id, { page: pageFrom(req.query.page) });
  res.render('my-submissions', {
    title: 'คำขอของฉัน',
    result,
    statusLabels: STATUS_LABELS,
    pageLink: (page) => (page > 1 ? `/me/submissions?page=${page}` : '/me/submissions'),
  });
}

// GET /me/submissions/:id
async function show(req, res) {
  const submission = await submissionModel.findOwn(req.user.id, submissionId(req));
  res.render('my-submission', { title: `คำขอ #${submission.id}`, submission, statusLabels: STATUS_LABELS, actionLabels: ACTION_LABELS });
}

// GET /me/submissions/:id/edit
async function editForm(req, res) {
  const submission = await submissionModel.findOwn(req.user.id, submissionId(req));
  if (submission.status !== 'changes_requested') {
    setFlash(req, 'error', 'แก้ไขได้เฉพาะคำขอที่ผู้ดูแลส่งกลับให้แก้ไขเท่านั้น');
    return res.redirect(303, `/me/submissions/${submission.id}`);
  }
  return renderForm(res, { submission });
}

// Only a returned submission can be edited. Checked before the form, so a
// member editing a pending one hears that, not about form errors. (The
// update itself checks again, in case the status changes in between.)
async function ensureEditable(userId, id) {
  const submission = await submissionModel.findOwn(userId, id);
  if (submission.status !== 'changes_requested') {
    throw new AppError(409, 'INVALID_STATE', 'แก้ไขหรือส่งใหม่ได้เฉพาะคำขอที่ผู้ดูแลส่งกลับให้แก้ไขเท่านั้น');
  }
}

// POST /me/submissions/:id (multipart, with an optional new photo)
async function update(req, res) {
  const id = submissionId(req);
  try {
    await ensureEditable(req.user.id, id);
    const data = validContent(req.body);
    const { version } = validate(versionSchema, req.body);
    const { replacedImagePaths } = await withStoredPhotos(req.photoFiles, (imagePaths) => submissionModel.updateOwn(req.user.id, id, version, data, imagePaths));
    await removeFiles(replacedImagePaths);
    setFlash(req, 'success', 'บันทึกการแก้ไขแล้ว กด "ส่งตรวจสอบอีกครั้ง" เมื่อพร้อม');
    return res.redirect(303, `/me/submissions/${id}`);
  } catch (err) {
    if (err.code === 'STALE_VERSION' || err.code === 'INVALID_STATE') {
      setFlash(req, 'error', err.message);
      return res.redirect(303, `/me/submissions/${id}`);
    }
    if (!FORM_ERRORS.has(err.code)) throw err;
    const submission = await submissionModel.findOwn(req.user.id, id);
    return renderForm(res, { status: err.status, submission, body: req.body, errors: { ...errorsByField(err), ...photoField(err) }, formError: err.message });
  }
}

// POST /me/submissions/:id/resubmit
async function resubmit(req, res) {
  const id = submissionId(req);
  try {
    const { version } = validate(versionSchema, req.body);
    await submissionModel.resubmit(req.user.id, id, version);
    setFlash(req, 'success', 'ส่งให้ผู้ดูแลตรวจสอบอีกครั้งแล้ว');
  } catch (err) {
    if (!['STALE_VERSION', 'INVALID_STATE', 'VALIDATION_ERROR'].includes(err.code)) throw err;
    setFlash(req, 'error', err.message);
  }
  res.redirect(303, `/me/submissions/${id}`);
}

// ---------- API ----------

// POST /api/v1/submissions (multipart or JSON)
async function apiCreate(req, res) {
  const data = validContent(req.body);
  const submission = await withStoredPhotos(req.photoFiles, (imagePaths) => submissionModel.create(req.user.id, data, imagePaths));
  res.status(201).json({ data: submission });
}

// GET /api/v1/me/submissions
async function apiMine(req, res) {
  const { data, pagination } = await submissionModel.listOwn(req.user.id, { page: pageFrom(req.query.page) });
  res.json({ data, meta: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total } });
}

// GET /api/v1/me/submissions/:id
async function apiShow(req, res) {
  res.json({ data: await submissionModel.findOwn(req.user.id, submissionId(req)) });
}

// PATCH /api/v1/me/submissions/:id (multipart or JSON; needs `version`)
async function apiUpdate(req, res) {
  const id = submissionId(req);
  await ensureEditable(req.user.id, id);
  const data = validContent(req.body);
  const { version } = validate(versionSchema, req.body);
  const { submission, replacedImagePaths } = await withStoredPhotos(req.photoFiles, (imagePaths) => submissionModel.updateOwn(req.user.id, id, version, data, imagePaths));
  await removeFiles(replacedImagePaths);
  res.json({ data: submission });
}

// POST /api/v1/me/submissions/:id/resubmit (needs `version`)
async function apiResubmit(req, res) {
  const { version } = validate(versionSchema, req.body);
  res.json({ data: await submissionModel.resubmit(req.user.id, submissionId(req), version) });
}

module.exports = { newForm, create, mine, show, editForm, update, resubmit, apiCreate, apiMine, apiShow, apiUpdate, apiResubmit, STATUS_LABELS, ACTION_LABELS };
