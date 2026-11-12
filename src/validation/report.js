// Input rules for "report wrong information" (docs/DESIGN.md, place_reports).
const { z } = require('zod');

// The reasons a member can pick, with the label shown in the form.
const REPORT_REASONS = {
  closed: 'ปิดกิจการ',
  moved: 'ย้ายที่',
  wrong_info: 'ข้อมูลผิด',
  other: 'อื่น ๆ',
};

// An empty textarea arrives as "", which means "no details".
const details = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string({ error: 'รายละเอียดไม่ถูกต้อง' }).trim().max(1000, 'รายละเอียดต้องไม่เกิน 1000 ตัวอักษร').optional()
);

const createReportSchema = z
  .object({
    reason: z.enum(Object.keys(REPORT_REASONS), { error: 'กรุณาเลือกเหตุผลที่แจ้ง' }),
    details,
  })
  // "Other" tells an admin nothing on its own. The database checks this too.
  .refine((value) => value.reason !== 'other' || value.details, {
    path: ['details'],
    message: 'กรุณาอธิบายว่าข้อมูลใดไม่ถูกต้อง',
  });

module.exports = { createReportSchema, REPORT_REASONS };
