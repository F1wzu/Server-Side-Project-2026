// An error that is safe to show to the user.
// status = HTTP status, code = stable name used by API clients (see docs/DESIGN.md),
// message = text shown to the user, details = optional list of field errors.
class AppError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static notFound(message = 'ไม่พบข้อมูลที่ต้องการ') {
    return new AppError(404, 'NOT_FOUND', message);
  }
}

module.exports = AppError;
