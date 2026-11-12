// Input rules for "report wrong information" (docs/DESIGN.md, place_reports).
const { z } = require('zod');
const { optionalText } = require('./text');

// The reasons a member can pick, with the label shown in the form.
const REPORT_REASONS = {
  closed: 'ปิดกิจการ',
  moved: 'ย้ายที่',
  wrong_info: 'ข้อมูลผิด',
  other: 'อื่น ๆ',
};

// An empty textarea arrives as "", which means "no details". Text made only
// of invisible characters (zero-width spaces ...) also counts as empty, so it
// cannot satisfy the "please explain" rule for "other".
const details = optionalText({ label: 'รายละเอียด', max: 1000 }).transform((value) => value ?? undefined);

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
