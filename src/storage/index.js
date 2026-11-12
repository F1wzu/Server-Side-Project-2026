// Picks where photos are kept (STORAGE_DRIVER in .env). Both drivers offer
// the same save(buffer) and remove(path), so the rest of the code never needs
// to know where a photo lives.
const env = require('../config/env');

const driver = env.STORAGE_DRIVER;
const storage = driver === 'cloud' ? require('./cloud') : require('./local');

module.exports = {
  save: storage.save,
  remove: storage.remove,
  // Only the local driver has a folder for app.js to serve at /uploads.
  UPLOAD_DIR: storage.UPLOAD_DIR ?? null,
  driver,
};
