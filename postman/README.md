# Postman collection สำหรับ JSON API

ครอบคลุมทุก endpoint ของ `/api/v1` (บัญชี สถานที่ รีวิว ความเห็นตอบกลับ รายการโปรด แจ้งข้อมูลผิด คำขอเสนอสถานที่ และส่วนผู้ดูแล)

## นำเข้า

1. Postman > Import > เลือกไฟล์ `painaidee.postman_collection.json` และ `local.postman_environment.json`
2. เลือก environment "painaidee local" มุมขวาบน
3. ในหน้า environment กรอกค่า `memberEmail`, `memberPassword`, `adminEmail`, `adminPassword` (ในไฟล์เว้นว่างไว้ ห้ามเอารหัสผ่านจริงใส่ในไฟล์แล้ว commit)
   - บัญชีผู้ดูแลสร้างด้วย `npm run admin:create`
   - บัญชีสมาชิกใช้บัญชีที่มีอยู่แล้ว หรือสมัครผ่านหน้าเว็บ

## รัน

1. เปิดเซิร์ฟเวอร์ `npm run dev` (พอร์ต 3000)
2. เปิดคอลเลกชัน กด Run แล้วรันตามลำดับโฟลเดอร์: `0 Setup`, `1 Accounts`, `2 Places (public)`, `3 Reviews & favorites`, `4 Reports`, `5 Submissions`, `6 Admin`, `7 Member: fix returned submission`
   (หรือรันทีละคำขอเพื่อสาธิตก็ได้ แต่ต้องรันตามลำดับเพราะตัวแปรอย่าง `placeId`, `reviewId`, `submissionId` ถูกเก็บจากผลลัพธ์ของคำขอก่อนหน้า)

## ข้อควรรู้

- CSRF: คำขอ POST / PUT / PATCH / DELETE ทุกตัวส่ง header `X-CSRF-Token: {{csrfToken}}` ให้เอง รันคำขอ `GET CSRF token` ก่อนเสมอ ส่วนหลังเข้าสู่ระบบ / ออกจากระบบ / เปลี่ยนรหัสผ่าน (session เปลี่ยน) สคริปต์จะขอ token ใหม่ให้อัตโนมัติ
- Session เป็น cookie ที่ Postman เก็บให้เอง คำขอแรกใน `1 Accounts` สมัครบัญชีทดสอบ (อีเมลสุ่ม) แล้วออกจากระบบ จากนั้นเข้าสู่ระบบด้วยสมาชิกจริง
- `เปลี่ยนรหัสผ่าน` มี 2 คำขอ (ไปรหัสชั่วคราว แล้วเปลี่ยนกลับ) ให้รันคู่กัน ไม่งั้นรหัสผ่านของสมาชิกจะเปลี่ยนจริง
- ช่อง `photo` ในคำขอ multipart เว้นว่างไว้ได้ หรือเลือกไฟล์ jpg/png/webp ไม่เกิน 5 MB
- โฟลเดอร์ `5 Submissions` สร้างคำขอ 3 รายการ และลองแก้คำขอ A ขณะรอตรวจ ซึ่งต้องได้ 409 (แก้ได้เฉพาะคำขอที่ผู้ดูแลส่งกลับ) ผู้ดูแลใน `6 Admin` อนุมัติ A ส่ง B กลับ และปฏิเสธ C จากนั้น `7` เข้าสู่ระบบเป็นสมาชิก แก้คำขอ B แล้วส่งใหม่
- สมาชิกหนึ่งบัญชีเขียนรีวิว แจ้งข้อมูลผิด และส่ง/แก้คำขอได้รวม 30 ครั้งใน 15 นาที คอลเลกชันใช้ราว 14 ครั้งต่อรอบ ถ้ารันซ้ำเกิน 2 รอบติดกันจะได้ 429 ให้รอ 15 นาทีหรือรีสตาร์ตเซิร์ฟเวอร์
- `6 Admin` จะนำความเห็นตอบกลับและรีวิวของสมาชิกทดสอบออก ปิดรายการแจ้งข้อมูลผิดอันแรกที่ยังเปิดอยู่ และสร้าง/ลบหมวดหมู่ทดสอบ ควรรันกับฐานข้อมูลสำหรับ dev เท่านั้น
- ตัวแปรที่ใช้ซ้ำ (`baseUrl` อยู่ใน environment ส่วน id ต่าง ๆ อยู่ใน collection variables) ถ้าเซิร์ฟเวอร์ใช้พอร์ตอื่นให้แก้ `baseUrl`

## รันจาก command line (ไม่บังคับ)

ทดสอบแล้วด้วย Newman 6 (14 พ.ย. 2026 ผ่าน 63/63 การตรวจ บนฐานข้อมูลที่ seed ใหม่):

```bash
npx newman run postman/painaidee.postman_collection.json -e postman/local.postman_environment.json --env-var memberEmail=... --env-var memberPassword=... --env-var adminEmail=... --env-var adminPassword=...
```
