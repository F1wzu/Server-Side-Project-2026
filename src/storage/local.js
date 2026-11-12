// Keeps uploaded photos on this computer, in storage/uploads/.
// app.js serves that folder at /uploads, so the public path of a photo is
// simply /uploads/<name>.webp and that is what the database stores.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const env = require('../config/env');

// Tests write to the system temp folder so a test run never leaves photos
// inside the project.
const UPLOAD_DIR = env.isTest
  ? path.join(os.tmpdir(), 'painaidee-test-uploads')
  : path.join(__dirname, '..', '..', 'storage', 'uploads');

// The only shape save() ever produces. remove() accepts nothing else, so a
// path such as "/uploads/../package.json" can never reach the file system.
const PUBLIC_PATH = /^\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp)$/;

// Saves an already processed WebP photo and returns its public path.
async function save(buffer) {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  // A random name: it cannot be guessed and two uploads never collide.
  const name = `${crypto.randomUUID()}.webp`;
  // 'wx' fails instead of overwriting, in the (practically impossible) case
  // that the name already exists.
  await fs.writeFile(path.join(UPLOAD_DIR, name), buffer, { flag: 'wx' });
  return `/uploads/${name}`;
}

// Deletes a photo saved by save(). A missing file is not an error: the goal
// ("the photo is gone") is already reached.
async function remove(publicPath) {
  if (publicPath == null) return;
  const match = typeof publicPath === 'string' ? PUBLIC_PATH.exec(publicPath) : null;
  if (!match) throw new Error(`Refusing to delete an unexpected upload path: ${JSON.stringify(publicPath)}`);
  try {
    await fs.unlink(path.join(UPLOAD_DIR, match[1]));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = { save, remove, UPLOAD_DIR };
