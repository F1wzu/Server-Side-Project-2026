# Server-Side-Project-2026

**วันนี้ไปไหนดี @ ลาดกระบัง** — คู่มือสถานที่ในเขตลาดกระบัง สมาชิกรีวิวสถานที่
และเสนอสถานที่ใหม่ แล้วผู้ดูแลเป็นผู้อนุมัติ

tech: Node.js, Express, EJS, PostgreSQL, Prisma

## เอกสาร

| เอกสาร | ตอบคำถาม |
|---|---|
| [docs/PLAN.md](docs/PLAN.md) | แต่ละขั้นทำอะไร |
| [docs/DESIGN.md](docs/DESIGN.md) | ฟีเจอร์ ลำดับการใช้งาน ตารางฐานข้อมูล API endpoint หน้าเว็บ |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | โค้ดจัดวางอย่างไร ความปลอดภัย การขึ้นระบบ การทดสอบ |

## รันบนเครื่อง

ต้องมี [Node.js 24](https://nodejs.org/), [Git](https://git-scm.com/) และฐานข้อมูล
PostgreSQL 17 ซึ่งเลือกได้ **หนึ่ง** ในสองวิธีในข้อ 4: ติดตั้ง
[Docker Desktop](https://www.docker.com/products/docker-desktop/) หรือติดตั้ง
[PostgreSQL 17](https://www.postgresql.org/download/) ลงเครื่องโดยตรง

คำสั่งทั้งหมดรันในเทอร์มินัล (PowerShell หรือ Git Bash บน Windows) ที่โฟลเดอร์ของโปรเจกต์

1. ดาวน์โหลดโค้ด แล้วเข้าไปในโฟลเดอร์

   ```bash
   git clone https://github.com/F1wzu/Server-Side-Project-2026.git
   ```

   ```bash
   cd Server-Side-Project-2026
   ```

   ระหว่างที่งานยังไม่ถูก merge เข้า `main` ให้สลับไปที่ branch ล่าสุดของทีมก่อน
   (ตอนนี้คือ `UIWeb/Account`):

   ```bash
   git checkout UIWeb/Account
   ```

2. ติดตั้งแพ็กเกจ

   ```bash
   npm install
   ```

3. สร้างไฟล์ค่าตั้ง แล้วเปิด `.env` และกรอกค่า (ใน Command Prompt ใช้ `copy` แทน `cp`)

   ```bash
   cp .env.example .env
   ```

   - `DATABASE_URL` และ `TEST_DATABASE_URL`: แทน `YOUR_DB_PASSWORD` ทั้งสองบรรทัด
     ด้วยรหัสผ่านที่คุณตั้งเองสำหรับฐานข้อมูล **ใช้แค่ตัวอักษรภาษาอังกฤษและตัวเลข**
     เพราะอักขระอย่าง `@ : / #` ทำให้ที่อยู่ฐานข้อมูลอ่านผิด
   - `SESSION_SECRET`: รันคำสั่งนี้แล้วคัดลอกผลลัพธ์มาใส่

     ```bash
     node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
     ```

   - ค่าอื่นปล่อยไว้ตามเดิมได้ อย่าส่งไฟล์ `.env` ให้คนอื่น และไม่ต้อง commit
     (git ไม่เก็บไฟล์นี้อยู่แล้ว)

4. เปิด PostgreSQL

   **วิธี A ใช้ Docker** ตั้ง `POSTGRES_PASSWORD` ใน `.env` ให้เป็นรหัสผ่านเดียวกับ
   ที่ใช้ใน connection string ทั้งสองบรรทัด แล้วรัน:

   ```bash
   docker compose up -d
   ```

   **วิธี B ติดตั้ง PostgreSQL ลงเครื่องโดยตรง** ตัวติดตั้งจะให้ตั้งรหัสผ่านของผู้ใช้
   `postgres` ไว้ จากนั้นเปิด `psql` (บน Windows ใช้คำสั่งด้านล่างใน PowerShell หรือเปิด
   "SQL Shell (psql)" จากเมนู Start) แล้วใส่รหัสผ่านของ `postgres`:

   ```powershell
   & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h 127.0.0.1
   ```

   แล้ววางคำสั่งนี้ครั้งเดียว โดยแทน `YOUR_DB_PASSWORD` ด้วยรหัสผ่านเดียวกับใน `.env`
   และพิมพ์ `\q` เพื่อออก:

   ```sql
   CREATE ROLE painaidee LOGIN CREATEDB PASSWORD 'YOUR_DB_PASSWORD';
   CREATE DATABASE painaidee_dev OWNER painaidee;
   CREATE DATABASE painaidee_test OWNER painaidee;
   ```

5. สร้างตารางและโหลดข้อมูลตั้งต้น (9 หมวดหมู่ 30 สถานที่)

   ```bash
   npm run db:migrate
   ```

   ```bash
   npm run db:seed
   ```

6. เริ่มแอปแล้วเปิด <http://localhost:3000>

   ```bash
   npm run dev
   ```

   หน้าแรกควรแสดง **30 สถานที่ · 9 หมวดหมู่** เหมือนกันทุกเครื่อง ส่วนบัญชีผู้ใช้
   อยู่ในฐานข้อมูลของแต่ละเครื่อง จึงต้องสมัครสมาชิกใหม่บนเครื่องของตัวเอง
   และสร้างบัญชีผู้ดูแลด้วย `npm run admin:create`

7. (ไม่บังคับ) ตรวจว่าทุกอย่างทำงาน: ควรขึ้นว่าผ่านทั้งหมด

   ```bash
   npm test
   ```

เมื่อเพื่อนในทีม push งานใหม่ ให้ดึงมาแล้วรันสามคำสั่งนี้ (แพ็กเกจและตารางอาจเปลี่ยน):

```bash
git pull
```

```bash
npm install
```

```bash
npm run db:migrate
```

### ถ้าเจอปัญหา

| อาการ | วิธีแก้ |
|---|---|
| `Invalid configuration. Fix these settings in .env` | ข้อความบอกว่าค่าไหนผิด แก้ใน `.env` แล้วรันใหม่ |
| `Can't reach database server` หรือ `ECONNREFUSED` | PostgreSQL ยังไม่ได้เปิด: วิธี A รัน `docker compose up -d` วิธี B เปิด service ชื่อ `postgresql-x64-17` ใน Services ของ Windows |
| `password authentication failed` | รหัสผ่านใน `.env` ไม่ตรงกับที่ตั้งไว้ในข้อ 4 |
| `Port 3000 is already in use` | เปลี่ยน `PORT` ใน `.env` เป็นเลขอื่น เช่น `3001` แล้วเปิดที่ <http://localhost:3001> |
| หน้าเว็บไม่มีสถานที่เลย | ยังไม่ได้รัน `npm run db:seed` |

## คำสั่ง

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | เริ่มแอป รีสตาร์ตเองเมื่อไฟล์เปลี่ยน |
| `npm start` | เริ่มแอปแบบเดียวกับบนระบบจริง |
| `npm test` | รันการทดสอบกับฐานข้อมูลทดสอบ |
| `npm run db:migrate` | ใช้ migration และสร้าง migration ใหม่หลังแก้ schema |
| `npm run db:seed` | โหลดหมวดหมู่และสถานที่ตั้งต้นลงฐานข้อมูลที่ยังว่าง (รันซ้ำได้ ถ้ามีสถานที่อยู่แล้วจะไม่เพิ่มซ้ำ) |
| `npm run db:deploy` | ใช้ migration บนระบบจริง (ไม่สร้างใหม่) |
| `npm run db:studio` | เปิดดูฐานข้อมูลในเบราว์เซอร์ |
| `npm run admin:create` | สร้างบัญชีผู้ดูแล หรือเปลี่ยนบัญชีที่มีอยู่ให้เป็นผู้ดูแล (ถามอีเมล ชื่อผู้ใช้ และรหัสผ่าน) |
| `npm run db:reset` | ล้างฐานข้อมูลสำหรับพัฒนาแล้วสร้างใหม่ |

`GET /healthz` ตอบ `200 {"status":"ok"}` เมื่อแอปเชื่อมต่อฐานข้อมูลได้
และตอบ `503` เมื่อเชื่อมต่อไม่ได้
