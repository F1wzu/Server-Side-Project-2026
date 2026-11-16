// The home page's "ทีมงานชวนไป" picks (/admin/featured): one page to add,
// move and remove them instead of typing an order number on each place.
// Every page action and the API call the same model function, setOrder.
const featuredModel = require('../models/featured');
const { parseId } = require('../utils/ids');
const { setFlash } = require('../middleware/flash');
const AppError = require('../utils/AppError');

const FIXABLE = new Set(['VALIDATION_ERROR', 'NOT_FOUND']);

// Runs a change to the list and goes back to the page with a message.
async function change(req, res, makeList, success) {
  try {
    const ids = await featuredModel.currentIds();
    const next = makeList(ids);
    if (next) await featuredModel.setOrder(next);
    if (next && success) setFlash(req, 'success', success);
  } catch (err) {
    if (!FIXABLE.has(err.code)) throw err;
    setFlash(req, 'error', err.details?.[0]?.message ?? err.message);
  }
  return res.redirect(303, '/admin/featured');
}

const idFrom = (value) => parseId(String(value ?? ''));

// ---------- pages ----------

// GET /admin/featured
async function index(req, res) {
  const { picks, candidates, limit } = await featuredModel.overview();
  res.render('admin/featured', { title: 'ทีมงานชวนไป', picks, candidates, limit });
}

// POST /admin/featured  (placeId: added at the end)
function add(req, res) {
  const id = idFrom(req.body?.placeId);
  return change(req, res, (ids) => {
    if (id === null) throw new AppError(400, 'VALIDATION_ERROR', 'กรุณาเลือกสถานที่');
    return ids.includes(id) ? null : [...ids, id];
  }, 'เพิ่มในรายการแนะนำแล้ว');
}

// POST /admin/featured/:id/move  (direction: up | down | first)
function move(req, res) {
  const id = idFrom(req.params.id);
  const direction = req.body?.direction;
  return change(req, res, (ids) => {
    const from = ids.indexOf(id);
    if (from === -1) throw AppError.notFound('สถานที่นี้ไม่อยู่ในรายการแนะนำ');
    const to = direction === 'first' ? 0 : direction === 'up' ? from - 1 : direction === 'down' ? from + 1 : from;
    if (to < 0 || to >= ids.length || to === from) return null;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
  }, direction === 'first' ? 'ตั้งเป็นการ์ดใหญ่แล้ว' : 'เลื่อนลำดับแล้ว');
}

// POST /admin/featured/:id/remove
function remove(req, res) {
  const id = idFrom(req.params.id);
  return change(req, res, (ids) => {
    if (!ids.includes(id)) return null;
    return ids.filter((other) => other !== id);
  }, 'นำออกจากรายการแนะนำแล้ว');
}

// ---------- API ----------

// GET /api/v1/admin/featured
async function apiIndex(req, res) {
  const { picks, limit } = await featuredModel.overview();
  res.json({ data: picks, meta: { limit } });
}

// PUT /api/v1/admin/featured  { placeIds: [3, 8, 1] }  (the whole list, in order)
async function apiSet(req, res) {
  res.json({ data: await featuredModel.setOrder(req.body?.placeIds) });
}

module.exports = { index, add, move, remove, apiIndex, apiSet };
