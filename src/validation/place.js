// Input rules for browsing places (docs/DESIGN.md section 6).
const { z } = require('zod');
const { parseId } = require('../utils/ids');

// An empty value from a form ("?categoryId=") means "not given".
const blankAsMissing = (schema) => z.preprocess((value) => (value === '' ? undefined : value), schema);

// Still used for :id by other controllers; place pages and categoryId use parseId.
const id = z.coerce
  .number({ error: 'ต้องเป็นตัวเลข' })
  .int('ต้องเป็นจำนวนเต็ม')
  .positive('ต้องมากกว่า 0')
  .max(2147483647, 'ค่ามากเกินไป');

// A category id is written exactly like an id in a URL ("7", not "07",
// "0x7" or "7.0"), so each category has one way to be asked for.
const categoryId = z.string({ error: 'หมวดหมู่ไม่ถูกต้อง' }).transform((value, ctx) => {
  const parsed = parseId(value);
  if (parsed === null) {
    ctx.addIssue({ code: 'custom', message: 'หมวดหมู่ไม่ถูกต้อง' });
    return z.NEVER;
  }
  return parsed;
});

// Page numbers are plain digits only. z.coerce.number would also accept
// "0x1", " 1", "1.0" and "1e1", which a client almost certainly did not mean.
const wholeNumber = (min, max, message) =>
  z
    .string({ error: 'ต้องเป็นตัวเลข' })
    .regex(/^\d+$/, 'ต้องเป็นจำนวนเต็ม')
    .transform(Number)
    .pipe(z.number().min(min, message).max(max, message));

const SEARCH_MAX = 100;

const listQueryFields = {
  q: blankAsMissing(z.string({ error: 'คำค้นไม่ถูกต้อง' }).trim().max(SEARCH_MAX, `คำค้นต้องไม่เกิน ${SEARCH_MAX} ตัวอักษร`).default('')),
  categoryId: blankAsMissing(categoryId.optional()),
  openNow: blankAsMissing(
    z
      .enum(['true', 'false'], { error: 'ต้องเป็น true หรือ false' })
      .default('false')
      .transform((value) => value === 'true')
  ),
  sort: blankAsMissing(z.enum(['name', 'rating', 'newest'], { error: 'ต้องเป็น name, rating หรือ newest' }).default('name')),
  page: blankAsMissing(wholeNumber(1, 100000, 'ต้องเป็น 1 ถึง 100000').default(1)),
  pageSize: blankAsMissing(wholeNumber(1, 50, 'ต้องเป็น 1 ถึง 50').default(12)),
};

// A search typed or pasted into the page box that is too long is cut to the
// limit rather than thrown away, so the visitor still sees results for it.
// A cut that would split an emoji (a surrogate pair) drops the broken half.
function truncateSearch(value) {
  if (typeof value !== 'string') return value;
  let text = value.trim().slice(0, SEARCH_MAX);
  if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
  return text;
}

// The API is strict: a wrong value is an error the client should fix.
const listQuerySchema = z.object(listQueryFields);

// A page is forgiving: a wrong value in the address bar falls back to the
// default instead of showing an error page.
function lenientListQuery(query) {
  const result = {};
  for (const [name, schema] of Object.entries(listQueryFields)) {
    const value = name === 'q' ? truncateSearch(query?.q) : query?.[name];
    const parsed = schema.safeParse(value);
    result[name] = parsed.success ? parsed.data : schema.parse(undefined);
  }
  return result;
}

const randomQuerySchema = z.object({ categoryId: listQueryFields.categoryId, openNow: listQueryFields.openNow });
const idParamSchema = z.object({ id });

module.exports = { listQuerySchema, lenientListQuery, randomQuerySchema, idParamSchema };
