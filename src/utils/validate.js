const AppError = require('./AppError');

// Checks input against a Zod schema. Returns the cleaned data, or throws a
// 400 error whose `details` list one message per field.
function validate(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;

  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message,
  }));
  throw new AppError(400, 'VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง', details);
}

// For forms: { email: 'message', password: 'message' } (first message per field).
function errorsByField(err) {
  const fields = {};
  for (const detail of err.details ?? []) {
    fields[detail.field] ??= detail.message;
  }
  return fields;
}

module.exports = { validate, errorsByField };
