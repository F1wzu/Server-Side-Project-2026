// CSRF protection. A random token is kept in the session; every POST, PUT,
// PATCH and DELETE must send the same token back, either as the hidden form
// field `_csrf` or as the `X-CSRF-Token` header. Another website cannot read
// the token, so it cannot make a logged-in visitor's browser act for it.
const { csrfSync } = require('csrf-sync');

const { csrfSynchronisedProtection, generateToken } = csrfSync({
  getTokenFromRequest: (req) => req.body?._csrf ?? req.headers['x-csrf-token'],
});

// Views call csrfToken() where a form needs it. The token (and with it the
// session) is only created when a page really contains a form.
function exposeCsrfToken(req, res, next) {
  res.locals.csrfToken = () => generateToken(req);
  next();
}

// Forms with a photo are sent as multipart/form-data. Their `_csrf` field can
// only be read after the upload has been parsed, which happens in the route.
// So for these few routes (and only these) the check runs in the route,
// straight after the upload middleware (`withPhoto` in the route files).
// Every other multipart request is checked here as usual; its unparsed body
// has no token, so it is refused.
const PHOTO_ROUTES = [
  { method: 'POST', path: /^\/submissions$/ },
  { method: 'POST', path: /^\/me\/submissions\/\d+$/ },
  { method: 'POST', path: /^\/api\/v1\/submissions$/ },
  { method: 'PATCH', path: /^\/api\/v1\/me\/submissions\/\d+$/ },
  { method: 'POST', path: /^\/admin\/places$/ },
  { method: 'POST', path: /^\/admin\/places\/\d+$/ },
  { method: 'POST', path: /^\/api\/v1\/admin\/places$/ },
  { method: 'PATCH', path: /^\/api\/v1\/admin\/places\/\d+$/ },
];

const isPhotoRoute = (req) =>
  Boolean(req.is('multipart/form-data')) && PHOTO_ROUTES.some((route) => route.method === req.method && route.path.test(req.path));

function csrfProtection(req, res, next) {
  if (isPhotoRoute(req)) return next(); // checked in the route, after parsing
  return csrfSynchronisedProtection(req, res, next);
}

module.exports = { csrfProtection, csrfAfterUpload: csrfSynchronisedProtection, exposeCsrfToken, generateToken, isPhotoRoute };
