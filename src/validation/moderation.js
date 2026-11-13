// Input rules for the admin tools: removing a review, closing a report,
// naming a category (docs/DESIGN.md).
const { z } = require('zod');
const { visibleText } = require('./text');

// The reviews.removed_reason column holds 500 characters.
const removeReviewSchema = z.object({
  reason: visibleText({ label: 'เหตุผล', max: 500, minMessage: 'กรุณาระบุเหตุผลที่นำรีวิวออก' }),
});

const closeReportSchema = z.object({
  status: z.enum(['resolved', 'dismissed'], { error: 'กรุณาเลือกผลการตรวจ (resolved หรือ dismissed)' }),
});

const categorySchema = z.object({
  name: visibleText({ label: 'ชื่อหมวดหมู่', max: 80 }),
});

module.exports = { removeReviewSchema, closeReportSchema, categorySchema };
