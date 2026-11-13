// Input rules for the fields only an admin sets on a place: whether it is
// published and where it sits in the home page's featured list. The content
// itself (name, hours ...) is checked by readPlaceContent in submission.js.
const { z } = require('zod');

const STATUS_MESSAGE = 'สถานะต้องเป็น published หรือ unpublished';
const FEATURED_MESSAGE = 'ลำดับแนะนำต้องเป็นจำนวนเต็ม 1 ถึง 999 หรือเว้นว่างถ้าไม่แนะนำ';

// Keys that carry the place's content. A PATCH with none of them only changes
// the publication fields (quick publish / unpublish).
const CONTENT_KEYS = ['name', 'categoryId', 'description', 'address', 'latitude', 'longitude', 'phone', 'websiteUrl', 'hours', 'state0'];

const hasContent = (body) => CONTENT_KEYS.some((key) => body?.[key] !== undefined);

const blank = (value) => value === null || (typeof value === 'string' && value.trim() === '');

const statusSchema = z.enum(['published', 'unpublished'], { error: STATUS_MESSAGE });

// Plain whole numbers only: "1.5", "0", "-1", "1e2" and "1000" are refused.
const featuredSchema = z
  .union([z.string(), z.number()], { error: FEATURED_MESSAGE })
  .transform((value) => String(value).trim())
  .pipe(z.string().regex(/^[1-9]\d{0,2}$/, FEATURED_MESSAGE))
  .transform(Number);

// Reads status and featuredOrder. A key that is absent stays undefined
// (leave unchanged); an empty featuredOrder becomes null (not featured).
// `required` is for the page form, which always sends both.
function readPublication(body, { required = false } = {}) {
  const issues = [];
  const data = {};

  if (body?.status === undefined) {
    if (required) issues.push({ path: ['status'], message: STATUS_MESSAGE });
  } else {
    const parsed = statusSchema.safeParse(body.status);
    if (parsed.success) data.status = parsed.data;
    else issues.push({ path: ['status'], message: STATUS_MESSAGE });
  }

  if (body?.featuredOrder !== undefined) {
    if (blank(body.featuredOrder)) data.featuredOrder = null;
    else {
      const parsed = featuredSchema.safeParse(body.featuredOrder);
      if (parsed.success) data.featuredOrder = parsed.data;
      else issues.push({ path: ['featuredOrder'], message: FEATURED_MESSAGE });
    }
  }
  return { data, issues };
}

module.exports = { readPublication, hasContent, CONTENT_KEYS };
