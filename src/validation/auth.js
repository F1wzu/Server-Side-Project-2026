// Input rules for accounts (docs/DESIGN.md section 6).
// Only the fields listed here are ever read; anything else in the request,
// such as `role`, is dropped.
const { z } = require('zod');
const { visibleText } = require('./text');

const email = z
  .string({ error: 'กรุณากรอกอีเมล' })
  .trim()
  .toLowerCase()
  .min(1, 'กรุณากรอกอีเมล')
  .max(254, 'อีเมลยาวเกินไป')
  .pipe(z.email({ error: 'รูปแบบอีเมลไม่ถูกต้อง' }));

// A display name: 3–50 characters a person can see, on one line.
const username = visibleText({ label: 'ชื่อผู้ใช้', min: 3, max: 50, minMessage: 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร' }).refine(
  (value) => !/[\r\n\t]/.test(value),
  'ชื่อผู้ใช้ต้องอยู่ในบรรทัดเดียว'
);

// The rule for choosing a password (register and change password).
const newPassword = z
  .string({ error: 'กรุณากรอกรหัสผ่าน' })
  .min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
  // bcrypt only reads the first 72 bytes; a Thai character takes 3 bytes.
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'รหัสผ่านยาวเกินไป (ไม่เกิน 72 ไบต์)');

// The privacy policy must be accepted to register (PDPA consent). A checkbox
// sends 'on'; the API sends true. Anything else, or nothing, is a refusal.
const acceptPolicy = z.preprocess(
  (value) => value === true || value === 'on' || value === 'true',
  z.literal(true, { error: 'กรุณายอมรับนโยบายความเป็นส่วนตัวก่อนสมัครสมาชิก' })
);

// Typing the password twice catches a typo; there is no password reset, so a
// typo at sign-up would lock the member out. The field is optional here so
// existing API clients keep working: the page forms always send it (the
// controller fills in '' when it is missing), and whenever it is sent it
// must match. `field` is the confirm field, `source` the one it repeats.
const confirmation = z.string({ error: 'กรุณายืนยันรหัสผ่านอีกครั้ง' }).optional();
const checkConfirmation = (field, source) => (value, ctx) => {
  if (value[field] === undefined) return;
  if (value[field] === '') ctx.addIssue({ code: 'custom', path: [field], message: 'กรุณายืนยันรหัสผ่านอีกครั้ง' });
  else if (value[field] !== value[source]) ctx.addIssue({ code: 'custom', path: [field], message: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' });
};

// The confirm field is dropped after the check, so it never reaches the model.
const registerSchema = z
  .object({ username, email, password: newPassword, acceptPolicy, confirmPassword: confirmation })
  .superRefine(checkConfirmation('confirmPassword', 'password'))
  .transform(({ confirmPassword, ...account }) => account);

const updateProfileSchema = z.object({ username });

const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: 'กรุณากรอกรหัสผ่านเดิม' }).min(1, 'กรุณากรอกรหัสผ่านเดิม').max(1000, 'รหัสผ่านเดิมไม่ถูกต้อง'),
    newPassword,
    confirmNewPassword: confirmation,
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม',
  })
  .superRefine(checkConfirmation('confirmNewPassword', 'newPassword'))
  .transform(({ confirmNewPassword, ...passwords }) => passwords);

// Login does not repeat the password rules: any wrong value gets the same answer.
const loginSchema = z.object({
  email,
  password: z.string({ error: 'กรุณากรอกรหัสผ่าน' }).min(1, 'กรุณากรอกรหัสผ่าน').max(1000, 'รหัสผ่านไม่ถูกต้อง'),
});

// Deleting the account asks for the password once more.
const deleteAccountSchema = z.object({
  password: z.string({ error: 'กรุณากรอกรหัสผ่าน' }).min(1, 'กรุณากรอกรหัสผ่าน').max(1000, 'รหัสผ่านไม่ถูกต้อง'),
});

module.exports = { registerSchema, loginSchema, updateProfileSchema, changePasswordSchema, deleteAccountSchema };
