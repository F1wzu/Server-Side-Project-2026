// True when the client expects JSON: every /api/ request, or an Accept header asking for it.
function wantsJson(req) {
  return req.originalUrl.startsWith('/api/') || req.accepts(['html', 'json']) === 'json';
}

module.exports = wantsJson;
