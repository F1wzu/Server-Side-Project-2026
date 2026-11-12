// Register, login, logout and "my account".
// Page handlers render or redirect; API handlers answer JSON. Both call the
// same functions in models/user.js, so every rule is written once.
const userModel = require('../models/user');
const { registerSchema, loginSchema, updateProfileSchema, changePasswordSchema } = require('../validation/auth');
const { validate, errorsByField } = require('../utils/validate');
const safeRedirect = require('../utils/safeRedirect');
const { startSession, endSession } = require('../middleware/auth');
const { setFlash } = require('../middleware/flash');
const { generateToken } = require('../middleware/csrf');

// Errors the user can fix (bad input, taken email, wrong password) show the
// form again; anything else goes to the error handler.
const isFormError = (err) => ['VALIDATION_ERROR', 'EMAIL_TAKEN', 'INVALID_CREDENTIALS'].includes(err.code);

// ---------- pages ----------

function showRegister(req, res) {
  res.render('register', { title: 'สมัครสมาชิก', values: {}, errors: {}, formError: null, next: safeRedirect(req.query.next, '') });
}

async function register(req, res) {
  const next = safeRedirect(req.body?.next, '');
  try {
    const user = await userModel.register(validate(registerSchema, req.body));
    await startSession(req, user.id, { type: 'success', text: `ยินดีต้อนรับ ${user.username} สมัครสมาชิกเรียบร้อยแล้ว` });
    return res.redirect(303, next || '/me');
  } catch (err) {
    if (!isFormError(err)) throw err;
    // Show the form again with what was typed. The password is never sent back.
    return res.status(err.status).render('register', {
      title: 'สมัครสมาชิก',
      values: { username: req.body?.username, email: req.body?.email },
      errors: errorsByField(err),
      formError: err.message,
      next,
    });
  }
}

function showLogin(req, res) {
  res.render('login', { title: 'เข้าสู่ระบบ', values: {}, errors: {}, formError: null, next: safeRedirect(req.query.next, '') });
}

async function login(req, res) {
  const next = safeRedirect(req.body?.next, '');
  try {
    const { email, password } = validate(loginSchema, req.body);
    const user = await userModel.authenticate(email, password);
    await startSession(req, user.id, { type: 'success', text: `สวัสดี ${user.username} เข้าสู่ระบบแล้ว` });
    return res.redirect(303, next || '/');
  } catch (err) {
    if (!isFormError(err)) throw err;
    return res.status(err.status).render('login', {
      title: 'เข้าสู่ระบบ',
      values: { email: req.body?.email },
      errors: errorsByField(err),
      formError: err.message,
      next,
    });
  }
}

async function logout(req, res) {
  await endSession(req, res);
  res.redirect(303, '/');
}

// The profile page holds two small forms; each gets its own errors.
function renderProfile(res, { status = 200, username, usernameErrors = {}, passwordErrors = {} } = {}) {
  res.status(status).render('me', { title: 'บัญชีของฉัน', username, usernameErrors, passwordErrors });
}

function profile(req, res) {
  renderProfile(res, { username: req.user.username });
}

async function updateProfile(req, res) {
  try {
    const { username } = validate(updateProfileSchema, req.body);
    await userModel.updateUsername(req.user.id, username);
    setFlash(req, 'success', 'บันทึกชื่อผู้ใช้แล้ว');
    return res.redirect(303, '/me');
  } catch (err) {
    if (!isFormError(err)) throw err;
    return renderProfile(res, { status: err.status, username: req.body?.username, usernameErrors: errorsByField(err) });
  }
}

// Changes the password, gives this browser a new session ID and logs the
// account out everywhere else. A wrong current password is marked on the
// response, so the throttle counts only those guesses, not typos in the new
// password (see middleware/rateLimit.js).
async function changeOwnPassword(req, res, flash) {
  const userId = req.user.id;
  const input = validate(changePasswordSchema, req.body);
  try {
    await userModel.changePassword(userId, input);
  } catch (err) {
    if (err.details?.[0]?.field === 'currentPassword') res.locals.wrongCurrentPassword = true;
    throw err;
  }
  await startSession(req, userId, flash);
  await userModel.endOtherSessions(userId, req.sessionID);
}

async function changePassword(req, res) {
  try {
    await changeOwnPassword(req, res, { type: 'success', text: 'เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นที่เข้าสู่ระบบไว้ถูกออกจากระบบ' });
    return res.redirect(303, '/me');
  } catch (err) {
    if (!isFormError(err)) throw err;
    return renderProfile(res, { status: err.status, username: req.user.username, passwordErrors: errorsByField(err) });
  }
}

// ---------- API ----------

// GET /api/v1/auth/csrf
function apiCsrf(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: { csrfToken: generateToken(req) } });
}

// POST /api/v1/auth/register
async function apiRegister(req, res) {
  const user = await userModel.register(validate(registerSchema, req.body));
  await startSession(req, user.id);
  res.status(201).json({ data: user });
}

// POST /api/v1/auth/login
async function apiLogin(req, res) {
  const { email, password } = validate(loginSchema, req.body);
  const user = await userModel.authenticate(email, password);
  await startSession(req, user.id);
  res.json({ data: user });
}

// POST /api/v1/auth/logout
async function apiLogout(req, res) {
  await endSession(req, res);
  res.status(204).end();
}

// GET /api/v1/me
function apiMe(req, res) {
  res.json({ data: req.user });
}

// PATCH /api/v1/me
async function apiUpdateProfile(req, res) {
  const { username } = validate(updateProfileSchema, req.body);
  res.json({ data: await userModel.updateUsername(req.user.id, username) });
}

// PUT /api/v1/me/password
async function apiChangePassword(req, res) {
  await changeOwnPassword(req, res);
  res.status(204).end();
}

module.exports = {
  showRegister,
  register,
  showLogin,
  login,
  logout,
  profile,
  updateProfile,
  changePassword,
  apiCsrf,
  apiRegister,
  apiLogin,
  apiLogout,
  apiMe,
  apiUpdateProfile,
  apiChangePassword,
};
