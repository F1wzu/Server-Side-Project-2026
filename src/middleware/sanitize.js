// Removes the NUL character (\u0000) from everything a request sends.
//
// PostgreSQL cannot store NUL in text, so a NUL that reached a query used to
// end in a 500 error, even from a plain search such as /places?q=%00. No
// legitimate input contains it, so it is simply dropped, once, here.
const NUL = /\u0000/g;

function clean(value, depth = 0) {
  if (typeof value === 'string') return value.includes('\u0000') ? value.replace(NUL, '') : value;
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
  for (const key of Object.keys(value)) value[key] = clean(value[key], depth + 1);
  return value;
}

// Cleans the query string and the body. Runs after the body parsers, and
// again after a photo upload has been parsed (see `withPhoto` in the routes).
function stripNul(req, res, next) {
  // In Express 5 req.query is a getter that parses on every read; replace it
  // with one cleaned copy.
  const query = clean({ ...req.query });
  Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true, enumerable: true });
  if (req.body && typeof req.body === 'object') clean(req.body);
  next();
}

module.exports = { stripNul };
