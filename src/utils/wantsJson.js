// True when the client expects JSON: every /api/ request, or an Accept header asking for it.
function wantsJson(req) {
  // Routing ignores letter case (/API/v1/me works), so this check does too.
  return req.originalUrl.toLowerCase().startsWith('/api/') || req.accepts(['html', 'json']) === 'json';
}

module.exports = wantsJson;
