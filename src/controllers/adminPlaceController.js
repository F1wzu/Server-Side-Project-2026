// Admin: the list of all places, adding a place directly, editing one, and
// publishing / unpublishing. Page handlers and API handlers call the same
// model functions (src/models/adminPlace.js).
const adminPlaceModel = require('../models/adminPlace');
const categoryModel = require('../models/category');
const { readPlaceContent, LAT_KRABANG } = require('../validation/submission');
const { readPublication, hasContent } = require('../validation/adminPlace');
const { parseId } = require('../utils/ids');
const { errorsByField } = require('../utils/validate');
const { storePhoto } = require('../utils/photo');
const storage = require('../storage');
const { setFlash } = require('../middleware/flash');
const AppError = require('../utils/AppError');

const STATUSES = ['all', 'published', 'unpublished'];
const PAGE_SIZE = 20;

// The id from the URL, or a 404 (/admin/places/01/edit is not place 1).
function placeId(req) {
  const id = parseId(req.params.id);
  if (id === null) throw AppError.notFound('ไม่พบสถานที่นี้');
  return id;
}

const pageFrom = (value) => {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1;
};

const queryText = (value) => (typeof value === 'string' ? value.trim().slice(0, 200) : '');

function validationError(issues) {
  const details = issues.map((issue) => ({ field: issue.path.join('.') || 'body', message: issue.message }));
  return new AppError(400, 'VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', details);
}

// Content and publication fields together: every problem is reported at once.
// With `contentOptional`, a body without any content field changes only the
// publication fields (API quick publish / unpublish).
function validInput(body, { contentOptional = false, requirePublication = false, hasFile = false } = {}) {
  const publication = readPublication(body, { required: requirePublication });
  if (contentOptional && !hasContent(body)) {
    if (publication.issues.length) throw validationError(publication.issues);
    if (Object.keys(publication.data).length === 0 && !hasFile) {
      throw validationError([{ path: ['body'], message: 'ไม่มีข้อมูลที่จะแก้ไข' }]);
    }
    return { content: null, publication: publication.data };
  }
  const content = readPlaceContent(body, { pinRequired: false });
  const issues = [...content.issues, ...publication.issues];
  if (issues.length) throw validationError(issues);
  return { content: content.data, publication: publication.data };
}

// Stores the photo only after the rest of the form passed, and deletes it
// again if the database step fails, so no orphan files are left behind.
async function withStoredPhoto(file, work) {
  const imagePath = await storePhoto(file);
  try {
    return await work(imagePath);
  } catch (err) {
    if (imagePath) await storage.remove(imagePath).catch(() => {});
    throw err;
  }
}

// The old file goes only after the new one is saved in the database.
async function removeOrphan(imagePath) {
  if (imagePath) await storage.remove(imagePath).catch(() => {});
}

// Form values to show again after an error (strings, as typed), or the
// stored place for a fresh edit form.
function formValues(body, place) {
  if (!body) {
    if (!place) return { status: 'published', featuredOrder: '', hours: Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'unknown' })) };
    return { ...place, latitude: place.latitude ?? '', longitude: place.longitude ?? '', featuredOrder: place.featuredOrder ?? '' };
  }
  const hours = Array.from({ length: 7 }, (unused, weekday) => ({
    weekday,
    state: body[`state${weekday}`] || 'unknown',
    opensAt: body[`opens${weekday}`] || '',
    closesAt: body[`closes${weekday}`] || '',
    closesNextDay: body[`next${weekday}`] === 'on',
  }));
  return { ...body, hours, imagePath: place?.imagePath };
}

async function renderForm(res, { status = 200, place = null, body = null, errors = {}, formError = null }) {
  const categories = await categoryModel.listWithCounts();
  res.status(status).render('admin/place-form', {
    title: place ? `แก้ไข ${place.name}` : 'เพิ่มสถานที่',
    place,
    values: formValues(body, place),
    errors,
    formError,
    categories,
    bounds: LAT_KRABANG,
    withMap: true,
  });
}

// Errors the admin can fix on the form; anything else goes to the error page.
const FORM_ERRORS = new Set(['VALIDATION_ERROR', 'UNSUPPORTED_FILE', 'FILE_TOO_LARGE']);
const photoField = (err) => (['UNSUPPORTED_FILE', 'FILE_TOO_LARGE'].includes(err.code) ? { photo: err.message } : {});

// ---------- pages ----------

// GET /admin/places?q=&status=&page=
async function index(req, res) {
  const q = queryText(req.query.q);
  const status = STATUSES.includes(req.query.status) ? req.query.status : 'all';
  const result = await adminPlaceModel.list({ q, status, page: pageFrom(req.query.page), pageSize: PAGE_SIZE });
  const pageLink = (page) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status !== 'all') params.set('status', status);
    if (page > 1) params.set('page', String(page));
    const query = params.toString();
    return query ? `/admin/places?${query}` : '/admin/places';
  };
  res.render('admin/places', { title: 'จัดการสถานที่', result, filters: { q, status }, pageLink });
}

// GET /admin/places/new
async function newForm(req, res) {
  await renderForm(res, {});
}

// POST /admin/places (multipart, with an optional photo)
async function create(req, res) {
  try {
    const { content, publication } = validInput(req.body);
    const place = await withStoredPhoto(req.file, (imagePath) => adminPlaceModel.create(req.user.id, content, imagePath, publication));
    setFlash(req, 'success', `เพิ่มสถานที่ "${place.name}" แล้ว`);
    return res.redirect(303, '/admin/places');
  } catch (err) {
    if (!FORM_ERRORS.has(err.code)) throw err;
    return renderForm(res, { status: err.status, body: req.body, errors: { ...errorsByField(err), ...photoField(err) }, formError: err.message });
  }
}

// GET /admin/places/:id/edit
async function editForm(req, res) {
  const place = await adminPlaceModel.findById(placeId(req));
  await renderForm(res, { place });
}

// POST /admin/places/:id (multipart, with an optional new photo)
async function update(req, res) {
  const id = placeId(req);
  const place = await adminPlaceModel.findById(id); // 404 before anything else
  try {
    const { content, publication } = validInput(req.body, { requirePublication: true });
    const { orphanedImagePath } = await withStoredPhoto(req.file, (imagePath) => adminPlaceModel.update(id, content, publication, imagePath));
    await removeOrphan(orphanedImagePath);
    setFlash(req, 'success', `บันทึกข้อมูล "${content.name}" แล้ว`);
    return res.redirect(303, '/admin/places');
  } catch (err) {
    if (!FORM_ERRORS.has(err.code)) throw err;
    return renderForm(res, { status: err.status, place, body: req.body, errors: { ...errorsByField(err), ...photoField(err) }, formError: err.message });
  }
}

// POST /admin/places/:id/status  (quick publish / unpublish from the list)
async function setStatus(req, res) {
  const id = placeId(req);
  const { data, issues } = readPublication({ status: req.body?.status }, { required: true });
  if (issues.length) {
    setFlash(req, 'error', issues[0].message);
    return res.redirect(303, '/admin/places');
  }
  const { place } = await adminPlaceModel.update(id, null, { status: data.status }, null);
  setFlash(req, 'success', data.status === 'published' ? `เผยแพร่ "${place.name}" แล้ว` : `ซ่อน "${place.name}" จากหน้าสาธารณะแล้ว`);
  return res.redirect(303, '/admin/places');
}

// ---------- API ----------

// GET /api/v1/admin/places
async function apiList(req, res) {
  const q = queryText(req.query.q);
  const status = STATUSES.includes(req.query.status) ? req.query.status : 'all';
  const { data, pagination } = await adminPlaceModel.list({ q, status, page: pageFrom(req.query.page), pageSize: PAGE_SIZE });
  res.json({ data, meta: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total } });
}

// GET /api/v1/admin/places/:id
async function apiShow(req, res) {
  res.json({ data: await adminPlaceModel.findById(placeId(req)) });
}

// POST /api/v1/admin/places (multipart or JSON)
async function apiCreate(req, res) {
  const { content, publication } = validInput(req.body);
  const place = await withStoredPhoto(req.file, (imagePath) => adminPlaceModel.create(req.user.id, content, imagePath, publication));
  res.status(201).json({ data: place });
}

// PATCH /api/v1/admin/places/:id (multipart or JSON). With no content field,
// only status / featuredOrder change.
async function apiUpdate(req, res) {
  const id = placeId(req);
  await adminPlaceModel.findById(id); // 404 before validation
  const { content, publication } = validInput(req.body, { contentOptional: true, hasFile: Boolean(req.file) });
  const { place, orphanedImagePath } = await withStoredPhoto(req.file, (imagePath) => adminPlaceModel.update(id, content, publication, imagePath));
  await removeOrphan(orphanedImagePath);
  res.json({ data: place });
}

module.exports = { index, newForm, create, editForm, update, setStatus, apiList, apiShow, apiCreate, apiUpdate };
