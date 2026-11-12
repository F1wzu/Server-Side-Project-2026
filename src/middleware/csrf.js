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

module.exports = { csrfProtection: csrfSynchronisedProtection, exposeCsrfToken, generateToken };
