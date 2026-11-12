// Who is making this request, and are they allowed to?
const userModel = require('../models/user');
const AppError = require('../utils/AppError');
const wantsJson = require('../utils/wantsJson');
const { cookieOptions, COOKIE_NAME } = require('./session');
const env = require('../config/env');

// Loads the logged-in user from the database on every request. The role is
// never read from the cookie or the session, so a role change (or a deleted
// account) takes effect on the very next request.
async function loadCurrentUser(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return next();

  const user = await userModel.findById(userId);
  if (!user) {
    // The account no longer exists: drop the session and continue as a visitor.
    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    return next();
  }
  req.user = user;
  res.locals.currentUser = user;
  // Pages for a logged-in user must not be kept by the browser's cache.
  res.set('Cache-Control', 'no-store');
  return next();
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return next(new AppError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน'));
  // Remember where a visitor was going, so login can send them back.
  const target = req.method === 'GET' ? `?next=${encodeURIComponent(req.originalUrl)}` : '';
  return res.redirect(`/login${target}`);
}

// Use after requireLogin.
function requireAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return next(new AppError(403, 'FORBIDDEN', 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้'));
}

// For /login and /register: someone already logged in goes to their profile.
function redirectIfLoggedIn(req, res, next) {
  if (req.user) return res.redirect('/me');
  return next();
}

// Logs a user in. A brand-new session ID is issued, so an ID that someone
// may have planted in the browser before login is worthless afterwards.
// Only the user ID is stored in the session.
function startSession(req, userId, flash) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      req.session.userId = userId;
      if (flash) req.session.flash = flash;
      return req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

// Logs a user out: deletes the session row and clears the cookie.
function endSession(req, res) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) return reject(err);
      const { maxAge, ...options } = cookieOptions(env.isProduction);
      res.clearCookie(COOKIE_NAME, options);
      return resolve();
    });
  });
}

module.exports = { loadCurrentUser, requireLogin, requireAdmin, redirectIfLoggedIn, startSession, endSession };
