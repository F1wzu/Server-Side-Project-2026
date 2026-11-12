// Input rules for accounts (docs/DESIGN.md section 6).
// Only the fields listed here are ever read; anything else in the request,
// such as `role`, is dropped.
const { z } = require('zod');

const email = z
  .string({ error: 'กรุณากรอกอีเมล' })
  .trim()
  .toLowerCase()
  .min(1, 'กรุณากรอกอีเมล')
  .max(254, 'อีเมลยาวเกินไป')
  .pipe(z.email({ error: 'รูปแบบอีเมลไม่ถูกต้อง' }));

const username = z
  .string({ error: 'กรุณากรอกชื่อผู้ใช้' })
  .trim()
  .min(3, 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร')
  .max(50, 'ชื่อผู้ใช้ต้องไม่เกิน 50 ตัวอักษร');

// The rule for choosing a password (register and change password).
const newPassword = z
  .string({ error: 'กรุณากรอกรหัสผ่าน' })
  .min(8, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
  // bcrypt only reads the first 72 bytes; a Thai character takes 3 bytes.
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'รหัสผ่านยาวเกินไป (ไม่เกิน 72 ไบต์)');

const registerSchema = z.object({ username, email, password: newPassword });

const updateProfileSchema = z.object({ username });

const changePasswordSchema = z
  .object({
    currentPassword: z.string({ error: 'กรุณากรอกรหัสผ่านเดิม' }).min(1, 'กรุณากรอกรหัสผ่านเดิม').max(1000, 'รหัสผ่านเดิมไม่ถูกต้อง'),
    newPassword,
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม',
  });

// Login does not repeat the password rules: any wrong value gets the same answer.
const loginSchema = z.object({
  email,
  password: z.string({ error: 'กรุณากรอกรหัสผ่าน' }).min(1, 'กรุณากรอกรหัสผ่าน').max(1000, 'รหัสผ่านไม่ถูกต้อง'),
});

module.exports = { registerSchema, loginSchema, updateProfileSchema, changePasswordSchema };
