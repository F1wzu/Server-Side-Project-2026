// Reads a multipart form (a form with a photo) into req.body and req.file.
// The photo stays in memory (at most 5 MB) because it is always processed by
// sharp before anything is written; see utils/photo.js. This middleware does
// no CSRF check: the routes run the CSRF check right after it, because the
// token is inside the multipart body and only readable once it is parsed.
const multer = require('multer');
const AppError = require('../utils/AppError');

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const parser = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1,
    // Our forms have far fewer fields; the limits only stop a request that
    // tries to use up memory with thousands of fields or huge values.
    fields: 40,
    fieldSize: 20 * 1024,
    parts: 45,
  },
}).single('photo');

const ONE_PHOTO_ONLY = 'แนบรูปได้ครั้งละหนึ่งรูปในช่องรูปภาพเท่านั้น';

// Multer's own errors become AppErrors so the error handler shows a Thai
// message with the right status instead of a 500.
function toAppError(err) {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return new AppError(413, 'FILE_TOO_LARGE', 'รูปต้องมีขนาดไม่เกิน 5 MB');
    case 'LIMIT_UNEXPECTED_FILE':
    case 'LIMIT_FILE_COUNT':
      return new AppError(400, 'VALIDATION_ERROR', ONE_PHOTO_ONLY);
    case 'LIMIT_FIELD_VALUE':
      return new AppError(400, 'VALIDATION_ERROR', 'ข้อความในแบบฟอร์มยาวเกินไป');
    case 'LIMIT_FIELD_COUNT':
    case 'LIMIT_PART_COUNT':
      return new AppError(400, 'VALIDATION_ERROR', 'แบบฟอร์มมีข้อมูลมากเกินไป');
    default:
      // Any other multer error, or a broken multipart body reported by its
      // parser (busboy): the request itself is malformed, not our fault.
      return new AppError(400, 'VALIDATION_ERROR', 'รูปแบบข้อมูลที่ส่งมาไม่ถูกต้อง');
  }
}

// One middleware function (not an array) so it can be placed before the CSRF
// check in a route like any other middleware.
function photoUpload(req, res, next) {
  parser(req, res, (err) => {
    if (err) return next(err instanceof AppError ? err : toAppError(err));
    // A form whose file input was left empty still sends an empty part.
    // That means "no photo", not "a broken photo".
    if (req.file && req.file.size === 0 && !req.file.originalname) req.file = undefined;
    return next();
  });
}

module.exports = { photoUpload, MAX_FILE_SIZE };
