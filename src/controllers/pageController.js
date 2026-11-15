// Plain pages (about, privacy) and the files search engines read
// (robots.txt, sitemap.xml).
const placeModel = require('../models/place');
const { originOf } = require('../utils/origin');
const { POLICY_VERSION, POLICY_DATE } = require('../config/policy');

// GET /about
function about(req, res) {
  res.render('about', { title: 'เกี่ยวกับเรา' });
}

// GET /privacy
function privacy(req, res) {
  res.render('privacy', { title: 'นโยบายความเป็นส่วนตัว', policyVersion: POLICY_VERSION, policyDate: POLICY_DATE });
}

// GET /robots.txt  Search engines may read the public pages; account,
// admin and API pages are of no use to them (and need a login anyway).
function robots(req, res) {
  const lines = ['User-agent: *', 'Disallow: /admin', 'Disallow: /api/', 'Disallow: /me', 'Disallow: /login', 'Disallow: /register', 'Disallow: /submissions', '', `Sitemap: ${originOf(req)}/sitemap.xml`];
  res.type('text/plain').send(`${lines.join('\n')}\n`);
}

const escapeXml = (text) => text.replace(/[<>&'"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[char]);

// GET /sitemap.xml  The fixed public pages plus every published place.
async function sitemap(req, res) {
  const origin = originOf(req);
  const places = await placeModel.sitemapEntries();
  const urls = [
    ...['/', '/places', '/map', '/about', '/privacy'].map((path) => ({ loc: origin + path })),
    ...places.map((place) => ({ loc: `${origin}/places/${place.id}`, lastmod: place.updatedAt.toISOString().slice(0, 10) })),
  ];
  const body = urls.map(({ loc, lastmod }) => `  <url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
}

module.exports = { about, privacy, robots, sitemap };
