// Input rules for the admin tools: removing a review, closing a report,
// naming a category (docs/DESIGN.md).
const { z } = require('zod');
const { visibleText, optionalText } = require('./text');

// The reviews.removed_reason column holds 500 characters.
const removeReviewSchema = z.object({
  reason: visibleText({ label: 'เหตุผล', max: 500, minMessage: 'กรุณาระบุเหตุผลที่นำรีวิวออก' }),
});

// Same column size for replies (review_replies.removed_reason).
const removeReplySchema = z.object({
  reason: visibleText({ label: 'เหตุผล', max: 500, minMessage: 'กรุณาระบุเหตุผลที่นำความเห็นตอบกลับออก' }),
});

// Closing a report: what was fixed (optional) or, for "no action", why
// (required, so a dismissed report always says why). place_reports.resolution_note
// holds 500 characters.
const closeReportSchema = z
  .object({
    status: z.enum(['resolved', 'dismissed'], { error: 'กรุณาเลือกผลการตรวจ (resolved หรือ dismissed)' }),
    note: optionalText({ label: 'เหตุผล', max: 500 }),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'dismissed' && !value.note) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'กรุณาระบุเหตุผลที่ไม่ดำเนินการ' });
    }
  });

const categorySchema = z.object({
  name: visibleText({ label: 'ชื่อหมวดหมู่', max: 80 }),
});

module.exports = { removeReviewSchema, removeReplySchema, closeReportSchema, categorySchema };
