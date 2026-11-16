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
  .pipe(z.email({ error: 'รูปแบบอีเมลไม่ถูกต้อง' }))
  // A deleted account keeps its row under deleted-<id>@deleted.invalid
  // (models/user.js). Nobody may register in that domain: it would block that
  // member from ever deleting their account, and the account would pass for a
  // deleted one in the admin's member list.
  .refine((value) => !value.endsWith('@deleted.invalid'), 'รูปแบบอีเมลไม่ถูกต้อง');

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
// Zod normally skips object-level checks while any field has an error, so a
// mismatch only showed up on a second submit (after the member had retyped
// both passwords). `when` runs the check whenever the confirm field itself is
// a string, so every problem is listed on the first try.
const withConfirmation = (schema, field, source) => {
  const when = ({ value }) => value !== null && typeof value === 'object' && typeof value[field] === 'string';
  return schema
    .refine((value) => value[field] !== '', { path: [field], message: 'กรุณายืนยันรหัสผ่านอีกครั้ง', when })
    .refine((value) => value[field] === '' || value[field] === value[source], {
      path: [field],
      message: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน',
      when,
    });
};

// The confirm field is dropped after the check, so it never reaches the model.
const registerSchema = withConfirmation(
  z.object({ username, email, password: newPassword, acceptPolicy, confirmPassword: confirmation }),
  'confirmPassword',
  'password'
).transform(({ confirmPassword, ...account }) => account);

const updateProfileSchema = z.object({ username });

const changePasswordSchema = withConfirmation(
  z
    .object({
      currentPassword: z.string({ error: 'กรุณากรอกรหัสผ่านเดิม' }).min(1, 'กรุณากรอกรหัสผ่านเดิม').max(1000, 'รหัสผ่านเดิมไม่ถูกต้อง'),
      newPassword,
      confirmNewPassword: confirmation,
    })
    .refine((value) => value.newPassword !== value.currentPassword, {
      path: ['newPassword'],
      message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม',
    }),
  'confirmNewPassword',
  'newPassword'
).transform(({ confirmNewPassword, ...passwords }) => passwords);

// Login does not repeat the password rules: any wrong value gets the same answer.
const loginSchema = z.object({
  email,
  password: z.string({ error: 'กรุณากรอกรหัสผ่าน' }).min(1, 'กรุณากรอกรหัสผ่าน').max(1000, 'รหัสผ่านไม่ถูกต้อง'),
});

// Deleting the account asks for the password once more.
const deleteAccountSchema = z.object({
  password: z.string({ error: 'กรุณากรอกรหัสผ่าน' }).min(1, 'กรุณากรอกรหัสผ่าน').max(1000, 'รหัสผ่านไม่ถูกต้อง'),
});

// Logging out the other devices also asks for the password: on a shared
// computer, someone else using a forgotten open session cannot do it.
const confirmPasswordSchema = deleteAccountSchema;

// The single-field rules of sign-up, for scripts that ask one field at a time
// (scripts/create-admin.js). registerSchema is wrapped by refine/transform,
// so it has no `.shape` to read them from.
const registerFields = { username, email, password: newPassword };

module.exports = { registerSchema, registerFields, loginSchema, updateProfileSchema, changePasswordSchema, deleteAccountSchema, confirmPasswordSchema };
