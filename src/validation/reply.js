// Input rules for replies under a review (docs/DESIGN.md section 6).
const { z } = require('zod');
const { visibleText } = require('./text');

// The review_replies.body column holds 1000 characters.
const replySchema = z.object({
  body: visibleText({ label: 'ข้อความตอบกลับ', max: 1000 }),
});

module.exports = { replySchema };
