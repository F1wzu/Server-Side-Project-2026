// Input rules for browsing places (docs/DESIGN.md section 6).
const { z } = require('zod');

// An empty value from a form ("?categoryId=") means "not given".
const blankAsMissing = (schema) => z.preprocess((value) => (value === '' ? undefined : value), schema);

const id = z.coerce
  .number({ error: 'ต้องเป็นตัวเลข' })
  .int('ต้องเป็นจำนวนเต็ม')
  .positive('ต้องมากกว่า 0')
  .max(2147483647, 'ค่ามากเกินไป');

const listQueryFields = {
  q: blankAsMissing(z.string({ error: 'คำค้นไม่ถูกต้อง' }).trim().max(100, 'คำค้นต้องไม่เกิน 100 ตัวอักษร').default('')),
  categoryId: blankAsMissing(id.optional()),
  openNow: blankAsMissing(
    z
      .enum(['true', 'false'], { error: 'ต้องเป็น true หรือ false' })
      .default('false')
      .transform((value) => value === 'true')
  ),
  sort: blankAsMissing(z.enum(['name', 'rating', 'newest'], { error: 'ต้องเป็น name, rating หรือ newest' }).default('name')),
  page: blankAsMissing(z.coerce.number({ error: 'ต้องเป็นตัวเลข' }).int('ต้องเป็นจำนวนเต็ม').min(1, 'ต้องเป็น 1 ขึ้นไป').max(100000, 'ค่ามากเกินไป').default(1)),
  pageSize: blankAsMissing(z.coerce.number({ error: 'ต้องเป็นตัวเลข' }).int('ต้องเป็นจำนวนเต็ม').min(1, 'ต้องเป็น 1 ถึง 50').max(50, 'ต้องเป็น 1 ถึง 50').default(12)),
};

// The API is strict: a wrong value is an error the client should fix.
const listQuerySchema = z.object(listQueryFields);

// A page is forgiving: a wrong value in the address bar falls back to the
// default instead of showing an error page.
function lenientListQuery(query) {
  const result = {};
  for (const [name, schema] of Object.entries(listQueryFields)) {
    const parsed = schema.safeParse(query?.[name]);
    result[name] = parsed.success ? parsed.data : schema.parse(undefined);
  }
  return result;
}

const randomQuerySchema = z.object({ categoryId: listQueryFields.categoryId, openNow: listQueryFields.openNow });
const idParamSchema = z.object({ id });

module.exports = { listQuerySchema, lenientListQuery, randomQuerySchema, idParamSchema };
