// The last two middleware in the app: "no route matched" and "something failed".
const AppError = require('../utils/AppError');

const GENERIC_MESSAGE = 'เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง';

function wantsJson(req) {
  return req.originalUrl.startsWith('/api/') || req.accepts(['html', 'json']) === 'json';
}

function notFound(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', wantsJson(req) ? 'ไม่พบข้อมูลที่ต้องการ' : 'ไม่พบหน้าที่คุณต้องการ'));
}

// Turns anything that was thrown into an AppError.
function normalize(err) {
  if (err instanceof AppError) return err;

  // Errors from the body parsers.
  if (err.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป');
  if (err.type === 'entity.parse.failed') return new AppError(400, 'VALIDATION_ERROR', 'รูปแบบข้อมูลไม่ถูกต้อง');

  // Known database errors (Prisma error codes).
  if (err.code === 'P2002') return new AppError(409, 'CONFLICT', 'ข้อมูลนี้มีอยู่แล้ว');
  if (err.code === 'P2025') return AppError.notFound();

  return null;
}

// Express recognises an error handler by its four arguments.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const known = normalize(err);
  const status = known ? known.status : 500;
  const code = known ? known.code : 'INTERNAL_ERROR';
  const message = known ? known.message : GENERIC_MESSAGE;

  // Unexpected errors are logged in full; the user only sees a generic message.
  if (!known) (req.log ?? console).error({ err }, 'unhandled error');

  if (res.headersSent) return res.destroy();

  res.status(status);
  if (wantsJson(req)) {
    return res.json({ error: { code, message, details: known?.details ?? null } });
  }
  return res.render('error', { title: status === 404 ? 'ไม่พบหน้านี้' : 'เกิดข้อผิดพลาด', status, message });
}

module.exports = { notFound, errorHandler };
