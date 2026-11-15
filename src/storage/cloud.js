// Keeps uploaded photos on Cloudinary, so they survive a redeploy and every
// teammate sees the same pictures. Used when STORAGE_DRIVER=cloud; the
// account comes from CLOUDINARY_URL (cloudinary://KEY:SECRET@CLOUD_NAME).
//
// Cloudinary is used as plain storage: the photo is already resized and
// converted to WebP (utils/photo.js) before it gets here. The two calls are
// made with fetch against Cloudinary's upload API, signed with the account
// secret, so no extra package is needed.
const crypto = require('node:crypto');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { CLOUD_URL } = require('./paths');

const FOLDER = 'painaidee';
// A photo is at most a few hundred KB after processing; a call that takes
// longer than this is stuck, and the member should not wait on it forever.
const TIMEOUT_MS = 20000;

// What the member sees when Cloudinary cannot be reached or refuses. The
// real reason rides along as `cause` for the server log only.
function failed(cause) {
  const error = new AppError(502, 'STORAGE_FAILED', 'บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  error.cause = cause;
  return error;
}

function account() {
  const match = /^cloudinary:\/\/([^:]+):([^@]+)@([a-z0-9_-]+)$/i.exec(env.CLOUDINARY_URL ?? '');
  if (!match) throw new AppError(500, 'STORAGE_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าที่เก็บรูปบนคลาวด์');
  return { apiKey: match[1], apiSecret: match[2], cloudName: match[3] };
}

// Cloudinary's request signature: the parameters in alphabetical order as
// "a=1&b=2", followed by the account secret, hashed with SHA-1.
function sign(params, apiSecret) {
  const text = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
  return crypto.createHash('sha1').update(text + apiSecret).digest('hex');
}

async function call(action, params, file) {
  const { apiKey, apiSecret, cloudName } = account();
  const signed = { ...params, timestamp: Math.floor(Date.now() / 1000) };
  const form = new FormData();
  for (const [key, value] of Object.entries(signed)) form.append(key, String(value));
  form.append('api_key', apiKey);
  form.append('signature', sign(signed, apiSecret));
  if (file) form.append('file', new Blob([file], { type: 'image/webp' }), 'photo.webp');

  let response;
  try {
    response = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/${action}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw failed(cause);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Cloudinary's own message (wrong key, account limit) is for the log,
    // not for the member.
    throw failed(new Error(`Cloudinary ${action} answered ${response.status}: ${body?.error?.message ?? 'no message'}`));
  }
  return body;
}

// Saves an already processed WebP photo and returns its public address.
async function save(buffer) {
  // A random name: it cannot be guessed and two uploads never collide.
  const body = await call('upload', { public_id: `${FOLDER}/${crypto.randomUUID()}` }, buffer);
  if (typeof body.secure_url !== 'string' || !CLOUD_URL.test(body.secure_url)) {
    throw failed(new Error('Cloudinary returned an address this app does not recognise'));
  }
  return body.secure_url;
}

// Deletes a photo saved by save(). A photo that is already gone is not an
// error. A path from the local driver (/uploads/..., from before the move to
// the cloud) is not this driver's to delete and is skipped; anything else is
// refused, so only photos this app uploaded can ever be deleted.
async function remove(publicPath) {
  if (publicPath == null) return;
  if (typeof publicPath === 'string' && publicPath.startsWith('/uploads/')) return;
  const match = typeof publicPath === 'string' ? CLOUD_URL.exec(publicPath) : null;
  if (!match || match[1] !== account().cloudName) {
    throw new Error(`Refusing to delete an unexpected upload path: ${JSON.stringify(publicPath)}`);
  }
  // invalidate: also drop the copy Cloudinary's CDN has cached.
  await call('destroy', { public_id: match[2], invalidate: true });
}

module.exports = { save, remove };
