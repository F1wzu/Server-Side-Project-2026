# ขึ้นระบบจริงบน Render

แอปทำงานบน [Render](https://render.com/) (Docker จาก `Dockerfile`) ใช้ฐานข้อมูล Neon ของทีม
(ตัวเดียวกับที่ใช้พัฒนา) และเก็บรูปบน Cloudinary ได้ที่อยู่ HTTPS สาธารณะ เช่น
`https://painaidee.onrender.com`

> **ความลับทุกตัว (ที่อยู่ฐานข้อมูล, `SESSION_SECRET`, `CLOUDINARY_URL`) ใส่ในหน้า Render เท่านั้น**
> ห้าม commit ห้ามส่งในแชต

## ก่อนเริ่ม

1. commit และ push โค้ดทั้งหมดขึ้น GitHub (Render ดึงโค้ดจาก GitHub ไม่ใช่จากเครื่อง)
2. migration ทุกตัวต้องอยู่บน Neon แล้ว: รัน `npm run db:deploy:shared` บนเครื่องที่ `.env` ชี้ไป Neon
   (ถ้าขึ้นว่า `No pending migrations to apply` แปลว่าครบแล้ว)
3. ถ้ามีรูปที่เคยอัปโหลดตอนยังเก็บรูปในเครื่อง (`/uploads/...`) รูปพวกนี้จะเสียบนเว็บจริง
   ให้คนที่มีรูปในเครื่องรัน `node scripts/move-uploads-to-cloud.js` (ดูรายการ) แล้ว
   `node scripts/move-uploads-to-cloud.js --apply` (ย้ายขึ้น Cloudinary)

## สร้าง service บน Render

1. เข้า <https://dashboard.render.com> → **New +** → **Web Service**
2. เชื่อม GitHub แล้วเลือก repository ของโปรเจกต์
3. ตั้งค่าตามตาราง

| ช่อง | ค่า |
|---|---|
| Name | `painaidee` (ชื่อนี้จะเป็นที่อยู่ `https://painaidee.onrender.com` ถ้าชื่อถูกใช้แล้ว Render จะเติมตัวอักษรต่อท้าย) |
| Language / Runtime | **Docker** |
| Branch | branch ที่จะใช้สาธิต (เช่น `main` หรือ `FullPrototypeV1`) |
| Region | **Singapore** (ใกล้ไทย และอยู่ที่เดียวกับฐานข้อมูล Neon จึงเร็วที่สุด) |
| Root Directory | เว้นว่าง |
| Dockerfile Path | `./Dockerfile` (ค่าเริ่มต้น) |
| Instance Type | **Free** |

4. **Environment Variables** (กด *Add Environment Variable* ทีละตัว)

| ชื่อ | ค่า | หมายเหตุ |
|---|---|---|
| `NODE_ENV` | `production` | |
| `TRUST_PROXY` | `1` | ต้องมี ไม่งั้นเข้าสู่ระบบไม่ได้ (แอปจะไม่ยอมเริ่มถ้าไม่ได้ตั้ง) |
| `DATABASE_URL` | ที่อยู่ Neon แบบ **pooled** (มี `-pooler` ในชื่อ host) | คัดลอกจาก `.env` ของคุณ |
| `DATABASE_URL_UNPOOLED` | ที่อยู่ Neon แบบตรง (ไม่มี `-pooler`) | ใช้เฉพาะตอนรัน migration |
| `SESSION_SECRET` | สตริงสุ่มยาว ๆ **ตัวใหม่** ไม่ใช้ตัวเดียวกับในเครื่อง | สร้างด้วยคำสั่งด้านล่าง |
| `STORAGE_DRIVER` | `cloud` | |
| `CLOUDINARY_URL` | `cloudinary://...` | คัดลอกจาก `.env` หรือหน้า Cloudinary |

ไม่ต้องตั้ง `PORT` (Render กำหนดให้เอง) และไม่ต้องตั้ง `PUBLIC_ORIGIN`
(แอปอ่านที่อยู่ของตัวเองจาก `RENDER_EXTERNAL_URL` ที่ Render ให้มา
ตั้งเองเฉพาะเมื่อใช้โดเมนของตัวเอง)

สร้าง `SESSION_SECRET` บนเครื่อง:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

5. เปิด **Advanced** → **Health Check Path** ใส่ `/healthz`
   (Render จะส่งผู้ใช้ไปหาเวอร์ชันใหม่ก็ต่อเมื่อเวอร์ชันนั้นต่อฐานข้อมูลได้แล้ว)
6. กด **Deploy Web Service** รอ build ครั้งแรกประมาณ 5–10 นาที จน log ขึ้น `Listening on`
   และสถานะเป็น **Live**

ถ้า log ขึ้น `Invalid configuration` ข้อความจะบอกว่าตัวแปรไหนขาดหรือผิด
แก้ในแท็บ **Environment** แล้ว Render จะ deploy ใหม่เอง

## สร้างบัญชีผู้ดูแลบนเว็บจริง

เว็บจริงใช้ฐานข้อมูล Neon ตัวเดียวกับที่ `.env` ของคุณชี้อยู่ จึงสร้างจากเครื่องได้เลย
(ตรวจก่อนว่า `DATABASE_URL` ใน `.env` เป็นของ Neon ไม่ใช่ `127.0.0.1`)

```bash
npm run admin:create
```

ใส่อีเมล ชื่อผู้ใช้ และรหัสผ่าน (ถ้าอีเมลนี้มีบัญชีอยู่แล้ว จะเปลี่ยนบัญชีนั้นเป็นผู้ดูแล
โดยรหัสผ่านเดิมไม่เปลี่ยน) จากนั้นเข้าสู่ระบบบนเว็บจริงได้ทันที

## migration ครั้งต่อไป

Render แบบ Free ไม่มี "Pre-Deploy Command" แอปจึงไม่รัน migration เอง
เมื่อมีโฟลเดอร์ใหม่ใน `prisma/migrations` ให้ **คนเดียว** รันบนเครื่อง **ก่อน** push:

```bash
npm run db:deploy:shared
```

ถ้าวันหนึ่งเปลี่ยนเป็นแบบเสียเงิน ให้ใส่ Pre-Deploy Command เป็น
`node scripts/migrate-shared.js` (ใช้ `DATABASE_URL_UNPOOLED` ที่ตั้งไว้แล้ว)

## เรื่องที่ต้องรู้ก่อนสาธิต

- **แบบ Free จะหลับเมื่อไม่มีคนเข้า 15 นาที** การเปิดครั้งแรกหลังหลับใช้เวลาประมาณ 1 นาที
  ให้เปิดเว็บทิ้งไว้ **5–10 นาทีก่อนนำเสนอ** แล้วกดเข้าไปสักสองสามหน้า
- push โค้ดใหม่ขึ้น branch ที่เลือก → Render build และ deploy ใหม่เอง (ปิดได้ที่ Settings → Auto-Deploy)
  อย่า push ระหว่างนำเสนอ
- เว็บจริงกับเครื่องของทุกคนใช้ฐานข้อมูลเดียวกัน ข้อมูลทดลองที่ใครเพิ่มจะโผล่บนเว็บจริงด้วย
- รูปเก็บบน Cloudinary จึงไม่หายเมื่อ redeploy (ดิสก์ของ Render ถูกล้างทุกครั้งที่ deploy)
- ดู log ได้ที่แท็บ **Logs** ของ service

## รายการตรวจขั้นที่ 8 (ทำบนเว็บจริง)

| # | ตรวจ | วิธี |
|---|---|---|
| 1 | เปิดได้ผ่าน HTTPS | เปิด `https://<ชื่อ>.onrender.com` เห็นรูปแม่กุญแจ |
| 2 | ฐานข้อมูลต่อได้ | เปิด `/healthz` ได้ `{"status":"ok"}` |
| 3 | เข้าสู่ระบบผ่าน HTTPS ได้ | เข้าสู่ระบบด้วยบัญชีผู้ดูแล แล้วเห็นชื่อตัวเองที่หัวเว็บ |
| 4 | ปุ่มที่ไม่รีโหลดหน้าทำงาน | หน้าผู้ดูแล: เปลี่ยนข้อมูลสถานที่ / อนุมัติคำขอ; หน้าสถานที่: แก้รีวิวในที่ กดหัวใจบันทึก |
| 5 | ไม่มีข้อผิดพลาด CSP | เปิด DevTools (F12) → Console ขณะเปิดหน้าแรก หน้าสถานที่ แผนที่ และหน้าผู้ดูแล ต้องไม่มีข้อความ `Content Security Policy` |
| 6 | รูปอยู่รอดหลัง redeploy | อัปโหลดรูปให้สถานที่หนึ่ง → Render: **Manual Deploy → Deploy latest commit** → รอ Live → รูปยังแสดงอยู่ |
| 7 | ใช้บนมือถือผ่านเน็ตมือถือได้ | ปิด Wi-Fi ในมือถือ เปิดเว็บ เข้าสู่ระบบ เขียนรีวิว |
| 8 | สคริปต์สาธิตรันจนจบ | ซ้อมทั้งสคริปต์บนเว็บจริง โดยไม่แก้ฐานข้อมูลด้วยมือ |
