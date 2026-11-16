// Admin: the member list, one member, suspend and unsuspend.
// The page handlers and the API handlers call the same model functions.
const userModerationModel = require('../models/userModeration');
const { suspendSchema, unsuspendSchema } = require('../validation/userModeration');
const { parseId } = require('../utils/ids');
const { validate } = require('../utils/validate');
const { setFlash } = require('../middleware/flash');
const AppError = require('../utils/AppError');

function idFrom(value) {
  const id = parseId(value);
  if (id === null) throw AppError.notFound('ไม่พบสมาชิกนี้');
  return id;
}

function pageFrom(value) {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 && page <= 100000 ? page : 1;
}

// Free text is only a search pattern (escaped in the model): control
// characters are dropped and the length is capped. An unknown status is ignored.
const CONTROL_ALL = /[\u0000-\u001F\u007F]/g;
function searchFrom(query) {
  return {
    q: typeof query.q === 'string' ? query.q.replace(CONTROL_ALL, '').trim().slice(0, 200) : '',
    status: userModerationModel.STATUSES.includes(query.status) ? query.status : 'all',
  };
}

const FIXABLE = new Set(['VALIDATION_ERROR', 'INVALID_STATE', 'NOT_FOUND']);
function flashError(req, err) {
  if (!FIXABLE.has(err.code)) throw err;
  const detail = err.details?.[0]?.message;
  setFlash(req, 'error', detail && err.code === 'VALIDATION_ERROR' ? detail : err.message);
}

function listUrl({ q, status }, page) {
  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (status !== 'all') query.set('status', status);
  if (page > 1) query.set('page', page);
  const text = query.toString();
  return text ? `/admin/users?${text}` : '/admin/users';
}

// GET /admin/users
async function listPage(req, res) {
  const search = searchFrom(req.query);
  const result = await userModerationModel.list({ ...search, page: pageFrom(req.query.page) });
  res.render('admin/users', {
    title: 'สมาชิก',
    result,
    search,
    statusLink: (status) => listUrl({ ...search, status }, 1),
    pageLink: (page) => listUrl(search, page),
  });
}

// GET /admin/users/:id
async function showPage(req, res) {
  const member = await userModerationModel.findById(idFrom(req.params.id));
  res.render('admin/user', { title: `สมาชิก ${member.username}`, member });
}

// Runs a form action on a member, flashes the outcome and goes back to the
// member's page (or the list when there is no such member).
async function runFromForm(req, res, action, success) {
  try {
    await action(idFrom(req.params.id));
    setFlash(req, 'success', success);
  } catch (err) {
    flashError(req, err);
    if (err.code === 'NOT_FOUND') return res.redirect(303, '/admin/users');
  }
  return res.redirect(303, `/admin/users/${parseId(req.params.id)}`);
}

// POST /admin/users/:id/suspend
function suspendFromForm(req, res) {
  return runFromForm(req, res, (id) => userModerationModel.suspend(req.user.id, id, validate(suspendSchema, req.body)), 'ระงับสมาชิกแล้ว');
}

// POST /admin/users/:id/unsuspend
function unsuspendFromForm(req, res) {
  return runFromForm(req, res, (id) => userModerationModel.unsuspend(req.user.id, id, validate(unsuspendSchema, req.body)), 'ยกเลิกการระงับแล้ว');
}

// GET /api/v1/admin/users  (?q=…&status=all|suspended|active&page=…)
async function apiList(req, res) {
  const { data, pagination } = await userModerationModel.list({ ...searchFrom(req.query), page: pageFrom(req.query.page) });
  res.json({ data, meta: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total } });
}

// GET /api/v1/admin/users/:id
async function apiShow(req, res) {
  res.json({ data: await userModerationModel.findById(idFrom(req.params.id)) });
}

// POST /api/v1/admin/users/:id/suspend
async function apiSuspend(req, res) {
  const id = idFrom(req.params.id);
  res.json({ data: await userModerationModel.suspend(req.user.id, id, validate(suspendSchema, req.body)) });
}

// POST /api/v1/admin/users/:id/unsuspend
async function apiUnsuspend(req, res) {
  const id = idFrom(req.params.id);
  res.json({ data: await userModerationModel.unsuspend(req.user.id, id, validate(unsuspendSchema, req.body)) });
}

module.exports = { listPage, showPage, suspendFromForm, unsuspendFromForm, apiList, apiShow, apiSuspend, apiUnsuspend };
