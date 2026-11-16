// Input rules for suspending and un-suspending a member (docs/DESIGN.md).
const { z } = require('zod');
const { visibleText, optionalText } = require('./text');

// An empty or missing "days" means "until an admin lifts it". A form sends
// the number as text, so digits are turned into a number before the check.
const days = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'string') {
      const text = value.trim();
      if (text === '') return null;
      return /^\d{1,6}$/.test(text) ? Number(text) : value;
    }
    return value;
  },
  z
    .number({ error: 'จำนวนวันต้องเป็นตัวเลข 1 ถึง 365' })
    .int('จำนวนวันต้องเป็นจำนวนเต็ม')
    .min(1, 'จำนวนวันต้องอยู่ระหว่าง 1 ถึง 365')
    .max(365, 'จำนวนวันต้องอยู่ระหว่าง 1 ถึง 365')
    .nullable()
);

// users.suspended_reason holds 500 characters.
const suspendSchema = z.object({
  reason: visibleText({ label: 'เหตุผล', min: 3, max: 500, minMessage: 'เหตุผลต้องมีอย่างน้อย 3 ตัวอักษร' }),
  days,
});

const unsuspendSchema = z.object({
  note: optionalText({ label: 'หมายเหตุ', max: 500 }),
});

module.exports = { suspendSchema, unsuspendSchema };
