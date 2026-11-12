// Keeps uploaded photos with a cloud storage service. The service is chosen
// when the site is deployed, so for now both functions refuse clearly
// instead of pretending the photo was saved.
const AppError = require('../utils/AppError');

function notConfigured() {
  return new AppError(500, 'STORAGE_NOT_CONFIGURED', 'ยังไม่ได้ตั้งค่าที่เก็บรูปบนคลาวด์');
}

// Saves an already processed WebP photo and returns its public URL.
async function save(buffer) { // eslint-disable-line no-unused-vars
  throw notConfigured();
}

// Deletes a photo saved by save().
async function remove(publicPath) { // eslint-disable-line no-unused-vars
  throw notConfigured();
}

module.exports = { save, remove };
