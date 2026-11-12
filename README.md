# Server-Side-Project-2026

**วันนี้ไปไหนดี @ ลาดกระบัง** — คู่มือสถานที่ในเขตลาดกระบัง สมาชิกรีวิวสถานที่
และเสนอสถานที่ใหม่ แล้วผู้ดูแลเป็นผู้อนุมัติ

tech: Node.js, Express, EJS, PostgreSQL, Prisma

## เอกสาร

| เอกสาร | ตอบคำถาม |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) 
| [docs/DESIGN.md](docs/DESIGN.md) | ฟีเจอร์ ลำดับการใช้งาน ตารางฐานข้อมูล API endpoint หน้าเว็บ |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | โค้ดจัดวางอย่างไร ความปลอดภัย การขึ้นระบบ การทดสอบ |

## รันบนเครื่อง

ต้องมี [Node.js 24](https://nodejs.org/) และ PostgreSQL 17 สำหรับ PostgreSQL
ให้เลือก **หนึ่ง** ในสองวิธีในข้อ 3

1. ติดตั้งแพ็กเกจ

   ```bash
   npm install
   ```

2. สร้างไฟล์ค่าตั้ง แล้วเปิด `.env` และกรอกค่า

   ```bash
   cp .env.example .env
   ```

   - `SESSION_SECRET`: สร้างค่าด้วยคำสั่งที่เขียนไว้ใน `.env.example`
   - `DATABASE_URL` และ `TEST_DATABASE_URL`: แทน `YOUR_DB_PASSWORD` ด้วยรหัสผ่านของคุณ

3. เปิด PostgreSQL

   **วิธี A ใช้ Docker** ตั้ง `POSTGRES_PASSWORD` ใน `.env` ให้เป็นรหัสผ่านเดียวกับ
   ที่ใช้ใน connection string ทั้งสองบรรทัด แล้วรัน:

   ```bash
   docker compose up -d
   ```

   **วิธี B ติดตั้ง PostgreSQL ลงเครื่องโดยตรง** สร้างผู้ใช้และฐานข้อมูลสองตัว
   ครั้งเดียว ใน `psql` ในฐานะผู้ใช้ `postgres`:

   ```sql
   CREATE ROLE painaidee LOGIN CREATEDB PASSWORD 'YOUR_DB_PASSWORD';
   CREATE DATABASE painaidee_dev OWNER painaidee;
   CREATE DATABASE painaidee_test OWNER painaidee;
   ```

4. สร้างตารางและโหลดข้อมูลตั้งต้น (9 หมวดหมู่ 30 สถานที่)

   ```bash
   npm run db:migrate
   ```

   ```bash
   npm run db:seed
   ```

5. เริ่มแอปแล้วเปิด <http://localhost:3000>

   ```bash
   npm run dev
   ```

## คำสั่ง

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | เริ่มแอป รีสตาร์ตเองเมื่อไฟล์เปลี่ยน |
| `npm start` | เริ่มแอปแบบเดียวกับบนระบบจริง |
| `npm test` | รันการทดสอบกับฐานข้อมูลทดสอบ |
| `npm run db:migrate` | ใช้ migration และสร้าง migration ใหม่หลังแก้ schema |
| `npm run db:seed` | โหลดหมวดหมู่และสถานที่ตั้งต้น (รันซ้ำได้ปลอดภัย) |
| `npm run db:deploy` | ใช้ migration บนระบบจริง (ไม่สร้างใหม่) |
| `npm run db:studio` | เปิดดูฐานข้อมูลในเบราว์เซอร์ |
| `npm run admin:create` | สร้างบัญชีผู้ดูแล หรือเปลี่ยนบัญชีที่มีอยู่ให้เป็นผู้ดูแล (ถามอีเมล ชื่อผู้ใช้ และรหัสผ่าน) |
| `npm run db:reset` | ล้างฐานข้อมูลสำหรับพัฒนาแล้วสร้างใหม่ |

`GET /healthz` ตอบ `200 {"status":"ok"}` เมื่อแอปเชื่อมต่อฐานข้อมูลได้
และตอบ `503` เมื่อเชื่อมต่อไม่ได้
