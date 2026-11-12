// Input rules for reviews (docs/DESIGN.md section 6).
const { z } = require('zod');

const reviewSchema = z.object({
  // A form sends "4"; the API may send 4. "3.5", "0" and "6" are refused.
  rating: z.coerce
    .number({ error: 'กรุณาเลือกคะแนน' })
    .int('คะแนนต้องเป็นจำนวนเต็ม 1 ถึง 5')
    .min(1, 'กรุณาเลือกคะแนน 1 ถึง 5')
    .max(5, 'กรุณาเลือกคะแนน 1 ถึง 5'),
  // Optional. An empty box is stored as "no comment".
  comment: z
    .string({ error: 'ความเห็นไม่ถูกต้อง' })
    .trim()
    .max(2000, 'ความเห็นต้องไม่เกิน 2000 ตัวอักษร')
    .optional()
    .nullable()
    .transform((value) => value || null),
});

module.exports = { reviewSchema };
