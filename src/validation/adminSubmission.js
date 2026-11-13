// Input rules for an admin's decision on a submission.
const { z } = require('zod');
const { visibleText } = require('./text');
const { LAT_KRABANG } = require('./submission');

// The version of the submission the admin was looking at (a hidden field).
const version = z
  .union([z.number(), z.string().regex(/^\d+$/, 'ไม่พบหมายเลขฉบับของคำขอ').transform(Number)], { error: 'ไม่พบหมายเลขฉบับของคำขอ' })
  .pipe(z.number().int().min(1, 'ไม่พบหมายเลขฉบับของคำขอ'));

const blank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');

const coordinate = (label, min, max) =>
  z.preprocess(
    (value) => (blank(value) ? undefined : value),
    z.coerce
      .number({ error: `${label}ไม่ถูกต้อง` })
      .refine(Number.isFinite, `${label}ไม่ถูกต้อง`)
      .refine((value) => value >= min && value <= max, `${label}อยู่นอกเขตลาดกระบัง กรุณาปักหมุดใหม่`)
      .transform((value) => Math.round(value * 1e6) / 1e6)
      .optional()
  );

// Approving may carry a corrected pin: both coordinates, or neither.
const approveSchema = z
  .object({
    version,
    latitude: coordinate('ละติจูด', LAT_KRABANG.minLat, LAT_KRABANG.maxLat),
    longitude: coordinate('ลองจิจูด', LAT_KRABANG.minLng, LAT_KRABANG.maxLng),
  })
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    path: ['latitude'],
    message: 'ต้องระบุทั้งละติจูดและลองจิจูดของหมุด',
  });

// Returning or rejecting always needs a reason the member can read.
const reasonSchema = z.object({
  version,
  reason: visibleText({ label: 'เหตุผล', max: 1000 }),
});

module.exports = { approveSchema, reasonSchema };
