// Input rules for place submissions (docs/DESIGN.md section 6).
//
// The form arrives as multipart/form-data, so every value is a string and the
// seven days of opening hours come as flat fields (state0, opens0, closes0,
// next0 ... state6). The API may instead send `hours` as a JSON array. Both
// are turned into the same shape before checking.
const { z } = require('zod');

// A rectangle around Lat Krabang district. A pin outside it is almost always
// a mis-tap, so it is refused before an admin ever sees it.
const LAT_KRABANG = { minLat: 13.66, maxLat: 13.84, minLng: 100.68, maxLng: 100.92 };

const blank = (value) => value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
const blankAsMissing = (schema) => z.preprocess((value) => (blank(value) ? undefined : value), schema);

const text = (label, max) =>
  z
    .string({ error: `กรุณากรอก${label}` })
    .trim()
    .min(1, `กรุณากรอก${label}`)
    .max(max, `${label}ต้องไม่เกิน ${max} ตัวอักษร`);

const coordinate = (label, min, max) =>
  blankAsMissing(
    z.coerce
      .number({ error: 'กรุณาปักหมุดตำแหน่งบนแผนที่' })
      .refine(Number.isFinite, 'กรุณาปักหมุดตำแหน่งบนแผนที่')
      .refine((value) => value >= min && value <= max, `${label}อยู่นอกเขตลาดกระบัง กรุณาปักหมุดใหม่`)
      .transform((value) => Math.round(value * 1e6) / 1e6)
  );

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const day = z
  .object({
    weekday: z.number().int().min(0).max(6),
    state: z.enum(['open', 'closed', 'unknown'], { error: 'สถานะวันไม่ถูกต้อง' }),
    opensAt: z.string().nullable().optional(),
    closesAt: z.string().nullable().optional(),
    closesNextDay: z.boolean().optional().default(false),
  })
  .transform((value, ctx) => {
    if (value.state !== 'open') return { weekday: value.weekday, state: value.state, opensAt: null, closesAt: null, closesNextDay: false };
    if (!TIME.test(value.opensAt ?? '') || !TIME.test(value.closesAt ?? '')) {
      ctx.addIssue({ code: 'custom', message: 'วันที่เปิดต้องระบุเวลาเปิดและเวลาปิดแบบ ชั่วโมง:นาที' });
      return z.NEVER;
    }
    if (!value.closesNextDay && value.closesAt <= value.opensAt) {
      ctx.addIssue({ code: 'custom', message: 'เวลาปิดต้องหลังเวลาเปิด หรือเลือก "ปิดวันถัดไป"' });
      return z.NEVER;
    }
    // "Next day" only makes sense when the closing time is past midnight;
    // 10:00–20:00 ticked as next day would mean open for 34 hours. Equal
    // times (00:00–00:00) mean open around the clock. The database checks
    // the same rule (place_hours_order_check).
    if (value.closesNextDay && value.closesAt > value.opensAt) {
      ctx.addIssue({ code: 'custom', message: 'เลือก "ปิดวันถัดไป" ได้เฉพาะเมื่อเวลาปิดเลยเที่ยงคืน' });
      return z.NEVER;
    }
    return { weekday: value.weekday, state: 'open', opensAt: value.opensAt, closesAt: value.closesAt, closesNextDay: value.closesNextDay };
  });

const hours = z
  .array(day, { error: 'ต้องระบุเวลาเปิดปิดครบ 7 วัน' })
  .length(7, 'ต้องระบุเวลาเปิดปิดครบ 7 วัน')
  .refine((days) => days.every((item, index) => item.weekday === index), 'ต้องเรียงวันจากอาทิตย์ (0) ถึงเสาร์ (6)');

// The flat form fields → [{ weekday, state, opensAt, closesAt, closesNextDay }] × 7.
function hoursFromForm(body) {
  if (Array.isArray(body?.hours)) return body.hours;
  return Array.from({ length: 7 }, (unused, weekday) => ({
    weekday,
    state: body?.[`state${weekday}`] || 'unknown',
    opensAt: body?.[`opens${weekday}`] || null,
    closesAt: body?.[`closes${weekday}`] || null,
    closesNextDay: ['on', 'true', true].includes(body?.[`next${weekday}`]),
  }));
}

const submissionSchema = z.object({
  name: text('ชื่อสถานที่', 200),
  categoryId: z.coerce.number({ error: 'กรุณาเลือกหมวดหมู่' }).int('กรุณาเลือกหมวดหมู่').positive('กรุณาเลือกหมวดหมู่').max(2147483647, 'กรุณาเลือกหมวดหมู่'),
  description: text('รายละเอียด', 5000),
  address: text('ที่อยู่', 500),
  latitude: coordinate('ละติจูด', LAT_KRABANG.minLat, LAT_KRABANG.maxLat),
  longitude: coordinate('ลองจิจูด', LAT_KRABANG.minLng, LAT_KRABANG.maxLng),
  phone: blankAsMissing(
    z
      .string()
      .trim()
      .max(30, 'เบอร์โทรต้องไม่เกิน 30 ตัวอักษร')
      .regex(/^[0-9+\-() ]+$/, 'เบอร์โทรใช้ได้เฉพาะตัวเลข ช่องว่าง และ + - ( )')
      .refine((value) => /\d/.test(value), 'เบอร์โทรต้องมีตัวเลข')
      .optional()
  ).transform((value) => value ?? null),
  websiteUrl: blankAsMissing(
    z
      .string()
      .trim()
      .max(500, 'ลิงก์ต้องไม่เกิน 500 ตัวอักษร')
      .regex(/^https?:\/\/[^\s]+$/i, 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://')
      .refine((value) => URL.canParse(value), 'ลิงก์ไม่ถูกต้อง')
      .optional()
  ).transform((value) => value ?? null),
  hours,
});

// Parses a body from the form or the API into the submission's content.
// A pin is required: a missing coordinate fails the number check above.
function readSubmission(body) {
  const input = { ...body, hours: hoursFromForm(body) };
  const result = submissionSchema.safeParse(input);
  const issues = result.success ? [] : [...result.error.issues];
  // A missing pin is one problem, not two: say it once, under latitude.
  const latitudeIssue = issues.find((issue) => issue.path[0] === 'latitude');
  const deduped = issues.filter((issue) => !(issue.path[0] === 'longitude' && latitudeIssue && issue.message === latitudeIssue.message));
  return { data: deduped.length ? null : result.data, issues: deduped };
}

// The version the member's edit was based on (a hidden form field).
const versionSchema = z.object({
  version: z.coerce.number({ error: 'ไม่พบหมายเลขฉบับของคำขอ' }).int('ไม่พบหมายเลขฉบับของคำขอ').min(1, 'ไม่พบหมายเลขฉบับของคำขอ'),
});

module.exports = { readSubmission, hoursFromForm, versionSchema, LAT_KRABANG };
