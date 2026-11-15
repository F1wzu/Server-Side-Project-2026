// Input rules for "report a review" (docs/DESIGN.md, review_reports).
const { z } = require('zod');
const { optionalText } = require('./text');

// The reasons a member can pick, with the label shown in the form.
const REVIEW_REPORT_REASONS = {
  spam: 'สแปมหรือโฆษณา',
  offensive: 'ไม่สุภาพหรือสร้างความเกลียดชัง',
  false_info: 'ข้อมูลเท็จหรือทำให้เข้าใจผิด',
  other: 'อื่น ๆ',
};

// Same handling as place reports: "" and invisible-only text mean "no details".
const details = optionalText({ label: 'รายละเอียด', max: 1000 }).transform((value) => value ?? undefined);

const createReviewReportSchema = z
  .object({
    reason: z.enum(Object.keys(REVIEW_REPORT_REASONS), { error: 'กรุณาเลือกเหตุผลที่รายงาน' }),
    details,
  })
  // "Other" tells an admin nothing on its own. The database checks this too.
  .refine((value) => value.reason !== 'other' || value.details, {
    path: ['details'],
    message: 'กรุณาอธิบายว่ารีวิวนี้มีปัญหาอย่างไร',
  });

module.exports = { createReviewReportSchema, REVIEW_REPORT_REASONS };
