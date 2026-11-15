// The site's address for absolute links (sitemap, link previews):
// PUBLIC_ORIGIN when set (required in production), otherwise the address
// this request came in on (development, where it is e.g. http://localhost:3000).
const env = require('../config/env');

const originOf = (req) => env.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;

module.exports = { originOf };
