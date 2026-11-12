// Who is making this request, and are they allowed to?
const userModel = require('../models/user');
const AppError = require('../utils/AppError');
const wantsJson = require('../utils/wantsJson');
const safeRedirect = require('../utils/safeRedirect');
const { cookieOptions, COOKIE_NAME, revokeSession } = require('./session');
const env = require('../config/env');

// Drops the login from this session and continues as a visitor.
function forgetLogin(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

// Loads the logged-in user from the database on every request. The role is
// never read from the cookie or the session, so a role change (or a deleted
// account) takes effect on the very next request.
//
// The session also remembers the account's "session version". Changing the
// password raises it, so every session from before the change is treated as
// logged out here, even one that a request in flight wrote back to the
// database after it had been deleted.
async function loadCurrentUser(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) return next();

  const found = await userModel.findForSession(userId);
  if (!found || found.sessionVersion !== (req.session.sessionVersion ?? 1)) {
    await forgetLogin(req);
    return next();
  }
  const { sessionVersion, ...user } = found;
  req.user = user;
  res.locals.currentUser = user;
  // Pages for a logged-in user must not be kept by the browser's cache.
  res.set('Cache-Control', 'no-store');
  return next();
}

// Where to send someone after they log in. For a page they asked for (GET),
// that page. For a form they sent while logged out (POST), the page the form
// was on, taken from the Referer header but only if it is a path on this site.
function returnPath(req) {
  if (req.method === 'GET') return req.originalUrl;
  if (!req.get('referer')) return null;
  try {
    const referer = new URL(req.get('referer'), `${req.protocol}://${req.get('host')}`);
    if (referer.host !== req.get('host')) return null;
    const path = referer.pathname + referer.search;
    return safeRedirect(path, null);
  } catch {
    return null;
  }
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (wantsJson(req)) return next(new AppError(401, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบก่อน'));
  // Remember where the visitor was, so login can send them back.
  const target = returnPath(req);
  return res.redirect(target ? `/login?next=${encodeURIComponent(target)}` : '/login');
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
// The session stores the user ID and the account's session version.
async function startSession(req, userId, flash) {
  const { sessionVersion } = await userModel.findForSession(userId);
  return new Promise((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      req.session.userId = userId;
      req.session.sessionVersion = sessionVersion;
      if (flash) req.session.flash = flash;
      return req.session.save((saveError) => (saveError ? reject(saveError) : resolve()));
    });
  });
}

// Logs a user out: deletes the session row and clears the cookie. The
// session ID is also marked as ended, so a request that is still running
// for it cannot write the session back afterwards. The cookie is cleared even
// if the database fails, so this browser is logged out either way.
function endSession(req, res) {
  revokeSession(req.sessionID);
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      const { maxAge, ...options } = cookieOptions(env.isProduction);
      res.clearCookie(COOKIE_NAME, options);
      return err ? reject(err) : resolve();
    });
  });
}

module.exports = { loadCurrentUser, requireLogin, requireAdmin, redirectIfLoggedIn, startSession, endSession };
