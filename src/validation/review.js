// Input rules for reviews (docs/DESIGN.md section 6).
const { z } = require('zod');
const { optionalText } = require('./text');

const RATING_MESSAGE = 'คะแนนต้องเป็นจำนวนเต็ม 1 ถึง 5';

// A form sends "4"; the API may send 4. Only those two shapes are accepted.
// z.coerce would also turn true, [5], "0x5", "5e0" and "05" into numbers,
// so the value is checked by hand instead.
function readRating(value, ctx) {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    ctx.addIssue({ code: 'custom', message: 'กรุณาเลือกคะแนน' });
    return z.NEVER;
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5) return value;
  if (typeof value === 'string' && /^[1-5]$/.test(value.trim())) return Number(value.trim());
  ctx.addIssue({ code: 'custom', message: RATING_MESSAGE });
  return z.NEVER;
}

const rating = z.unknown().transform(readRating);
// When editing, a rating that is not sent means "keep the current one"
// (.optional() skips the check when the key is missing).
const ratingIfSent = z.unknown().transform(readRating).optional();

// Optional. An empty box (or one with only invisible characters) is stored
// as "no comment".
const comment = optionalText({ label: 'ความเห็น', max: 2000 });

// Writing a review: a rating is required, the comment is not.
const reviewSchema = z.object({ rating, comment });

// Editing a review is partial: a field that is not sent keeps its value, so
// changing only the stars does not wipe the comment. `comment: null` or ""
// clears it on purpose. For the comment, z.undefined() comes first so
// "not sent" stays undefined instead of becoming null.
const reviewPatchSchema = z
  .object({
    rating: ratingIfSent,
    comment: z.union([z.undefined(), comment]),
  })
  .refine((value) => value.rating !== undefined || value.comment !== undefined, {
    path: ['body'],
    message: 'กรุณาส่งคะแนนหรือความเห็นที่ต้องการแก้ไข',
  });

module.exports = { reviewSchema, reviewPatchSchema };
