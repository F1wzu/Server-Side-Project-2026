// Admin: add, rename and delete categories.
const categoryModel = require('../models/category');
const { categorySchema } = require('../validation/moderation');
const { parseId } = require('../utils/ids');
const { validate } = require('../utils/validate');
const { setFlash } = require('../middleware/flash');
const AppError = require('../utils/AppError');

function idFrom(value) {
  const id = parseId(value);
  if (id === null) throw AppError.notFound('ไม่พบหมวดหมู่นี้');
  return id;
}

const FIXABLE = new Set(['VALIDATION_ERROR', 'CONFLICT', 'CATEGORY_IN_USE', 'NOT_FOUND']);
function flashError(req, err) {
  if (!FIXABLE.has(err.code)) throw err;
  const detail = err.details?.[0]?.message;
  setFlash(req, 'error', detail && err.code === 'VALIDATION_ERROR' ? detail : err.message);
}

// GET /admin/categories
async function list(req, res) {
  res.render('admin/categories', { title: 'จัดการหมวดหมู่', categories: await categoryModel.listForAdmin() });
}

// POST /admin/categories
async function createFromForm(req, res) {
  try {
    const category = await categoryModel.create(validate(categorySchema, req.body).name);
    setFlash(req, 'success', `เพิ่มหมวดหมู่ “${category.name}” แล้ว`);
  } catch (err) {
    flashError(req, err);
  }
  res.redirect(303, '/admin/categories');
}

// POST /admin/categories/:id
async function renameFromForm(req, res) {
  try {
    await categoryModel.rename(idFrom(req.params.id), validate(categorySchema, req.body).name);
    setFlash(req, 'success', 'เปลี่ยนชื่อหมวดหมู่แล้ว');
  } catch (err) {
    flashError(req, err);
  }
  res.redirect(303, '/admin/categories');
}

// POST /admin/categories/:id/delete
async function removeFromForm(req, res) {
  try {
    await categoryModel.remove(idFrom(req.params.id));
    setFlash(req, 'success', 'ลบหมวดหมู่แล้ว');
  } catch (err) {
    flashError(req, err);
  }
  res.redirect(303, '/admin/categories');
}

// POST /api/v1/admin/categories
async function apiCreate(req, res) {
  res.status(201).json({ data: await categoryModel.create(validate(categorySchema, req.body).name) });
}

// PATCH /api/v1/admin/categories/:id
async function apiRename(req, res) {
  const id = idFrom(req.params.id);
  res.json({ data: await categoryModel.rename(id, validate(categorySchema, req.body).name) });
}

// DELETE /api/v1/admin/categories/:id
async function apiRemove(req, res) {
  await categoryModel.remove(idFrom(req.params.id));
  res.status(204).end();
}

module.exports = { list, createFromForm, renameFromForm, removeFromForm, apiCreate, apiRename, apiRemove };
