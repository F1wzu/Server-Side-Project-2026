// A suspended member can log in and read everything but cannot write anything.
// This is the one place that enforces it: any request that is not GET, HEAD or
// OPTIONS is refused, so a new write endpoint is covered without remembering to
// add a check. loadCurrentUser has already set req.user.suspension (null when
// the member is not suspended now or the visitor is not logged in).
const AppError = require('../utils/AppError');
const { suspensionEnd } = require('../utils/suspension');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// What a suspended member may still do: leave, and secure or close the account.
const ALLOWED_WRITES = [
  { method: 'POST', path: '/logout' },
  { method: 'POST', path: '/api/v1/auth/logout' },
  { method: 'POST', path: '/me/password' },
  { method: 'PUT', path: '/api/v1/me/password' },
  { method: 'POST', path: '/me/delete' },
  { method: 'DELETE', path: '/api/v1/me' },
];

function blockSuspended(req, res, next) {
  const suspension = req.user?.suspension;
  if (!suspension || READ_METHODS.has(req.method)) return next();
  if (ALLOWED_WRITES.some((rule) => rule.method === req.method && rule.path === req.path)) return next();
  return next(
    new AppError(403, 'ACCOUNT_SUSPENDED', `บัญชีของคุณถูกระงับการใช้งาน (${suspensionEnd(suspension.until)}) เหตุผล: ${suspension.reason}`)
  );
}

module.exports = { blockSuspended, ALLOWED_WRITES };
