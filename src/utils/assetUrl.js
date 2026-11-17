// Adds a short fingerprint of a file's content to its URL ("/css/site.css?v=3f2a91c0").
//
// Why: in production browsers keep files from public/ for 7 days (app.js),
// and the file names never change. Without a fingerprint, a visitor keeps the
// old stylesheet for up to a week after a deploy, and new page parts show up
// unstyled. The fingerprint changes only when the file changes, so unchanged
// files stay cached. Worked out once per file and remembered (files in
// public/ do not change while the app runs).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
const known = new Map();

function assetUrl(urlPath) {
  if (!known.has(urlPath)) {
    let url = urlPath;
    try {
      const content = fs.readFileSync(path.join(PUBLIC_DIR, urlPath));
      url = `${urlPath}?v=${crypto.createHash('sha256').update(content).digest('hex').slice(0, 10)}`;
    } catch {
      // A missing file keeps its plain URL; the browser gets the normal 404.
    }
    known.set(urlPath, url);
  }
  return known.get(urlPath);
}

module.exports = { assetUrl };
