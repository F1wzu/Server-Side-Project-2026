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

## เริ่มแบบย่อ (5 ขั้น ไม่ต้องติดตั้งฐานข้อมูล)

วิธีที่ง่ายที่สุดสำหรับเพื่อนในทีม: ใช้ฐานข้อมูลร่วมของทีมบน Neon จึงต้องมีแค่
[Node.js 24](https://nodejs.org/) และ [Git](https://git-scm.com/)
ก่อนเริ่ม ขอ **ที่อยู่ฐานข้อมูล 2 บรรทัด** จากเจ้าของโปรเจกต์ทางข้อความส่วนตัว

1. ดาวน์โหลดโค้ด

   ```bash
   git clone https://github.com/F1wzu/Server-Side-Project-2026.git
   ```

   ```bash
   cd Server-Side-Project-2026
   ```

   ```bash
   git checkout FullPrototypeV1
   ```

2. ติดตั้งแพ็กเกจ

   ```bash
   npm install
   ```

3. สร้างไฟล์ค่าตั้ง (ใน Command Prompt ใช้ `copy` แทน `cp`)

   ```bash
   cp .env.example .env
   ```

4. เปิดไฟล์ `.env` แล้วแก้ 3 บรรทัด ที่เหลือปล่อยไว้ตามเดิม

   | บรรทัด | ใส่อะไร |
   |---|---|
   | `DATABASE_URL=` | ที่อยู่บรรทัดแรกที่ได้รับมา (แทนค่าเดิมทั้งบรรทัด) |
   | `DATABASE_URL_UNPOOLED=` | ที่อยู่บรรทัดที่สองที่ได้รับมา (เพิ่มเป็นบรรทัดใหม่) |
   | `SESSION_SECRET=` | ผลลัพธ์จากคำสั่งด้านล่าง |

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
   ```

5. เริ่มแอปแล้วเปิด <http://localhost:3000>

   ```bash
   npm run dev
   ```

เสร็จแล้ว หน้าแรกควรมีสถานที่แสดงอยู่ และเข้าสู่ระบบด้วยบัญชีเดียวกับเพื่อนในทีมได้

**ทุกครั้งที่เพื่อน push งานใหม่** รันสองคำสั่งนี้ แล้ว `npm run dev` ตามปกติ:

```bash
git pull
```

```bash
npm install
```

**ข้อห้าม 3 ข้อเมื่อใช้ฐานข้อมูลร่วม**

- ห้ามรัน `npm run db:migrate`, `npm run db:reset` และ `npm run db:seed` (ข้อมูลของทั้งทีมอาจหาย)
- ห้ามรัน `npm test` จนกว่าจะตั้งฐานข้อมูลทดสอบในเครื่องตามหัวข้อ "รันบนเครื่อง" ด้านล่าง
- ห้ามส่งไฟล์ `.env` หรือที่อยู่ฐานข้อมูลในกลุ่มแชต และห้าม commit

ถ้าติดปัญหา ดูตาราง [ถ้าเจอปัญหา](#ถ้าเจอปัญหา) ด้านล่าง รูปที่เพื่อนอัปโหลดจะขึ้นเป็นรูปเสีย
ซึ่งเป็นเรื่องปกติ เพราะรูปยังเก็บอยู่ในเครื่องของคนที่อัปโหลด

## รันบนเครื่อง (แบบละเอียด ใช้ฐานข้อมูลในเครื่อง)

ใช้วิธีนี้เมื่อต้องการฐานข้อมูลของตัวเอง หรือต้องการรัน `npm test`

ต้องมี [Node.js 24](https://nodejs.org/), [Git](https://git-scm.com/) และฐานข้อมูล
PostgreSQL 17 ซึ่งเลือกได้ **หนึ่ง** ในสองวิธีในข้อ 5: ติดตั้ง
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
   (ตอนนี้คือ `FullPrototypeV1`):

   ```bash
   git checkout FullPrototypeV1
   ```

2. ติดตั้งแพ็กเกจ

   ```bash
   npm install
   ```

3. คิด **รหัสผ่านฐานข้อมูลหนึ่งรหัส** แล้วจดไว้ ใช้ตัวอักษรภาษาอังกฤษและตัวเลขเท่านั้น
   เพราะอักขระอย่าง `@ : / #` ทำให้ที่อยู่ฐานข้อมูลอ่านผิด รหัสนี้ไม่ใช่รหัสเข้า
   Windows และไม่ใช่รหัสสมาชิกของเว็บ ต้องใช้ **รหัสเดียวกัน** ในข้อ 4 และข้อ 5

4. สร้างไฟล์ค่าตั้ง `.env` (ใน Command Prompt ใช้ `copy` แทน `cp`)

   ```bash
   cp .env.example .env
   ```

   เปิดไฟล์ `.env` แล้วแก้เฉพาะบรรทัดเหล่านี้ ส่วนค่าอื่นปล่อยไว้ตามเดิม:

   | ตัวแปร | ใส่อะไร |
   |---|---|
   | `DATABASE_URL` | แทน `YOUR_DB_PASSWORD` ด้วยรหัสผ่านจากข้อ 3 |
   | `TEST_DATABASE_URL` | แทน `YOUR_DB_PASSWORD` ด้วยรหัสผ่านเดียวกัน |
   | `POSTGRES_PASSWORD` | รหัสผ่านเดียวกัน (ใช้เฉพาะวิธี A ที่ใช้ Docker; วิธี B ปล่อยว่างได้) |
   | `SESSION_SECRET` | รันคำสั่งด้านล่าง แล้วคัดลอกผลลัพธ์มาใส่ |

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
   ```

   อย่าส่งไฟล์ `.env` ให้คนอื่น และไม่ต้อง commit (git ไม่เก็บไฟล์นี้อยู่แล้ว)

5. เปิดฐานข้อมูล PostgreSQL เลือก **วิธีเดียว** (วิธี A ง่ายกว่า) อย่าเปิดทั้งสองวิธี
   พร้อมกัน เพราะใช้พอร์ต 5432 ร่วมกัน

   **วิธี A ใช้ Docker** เปิดโปรแกรม Docker Desktop ให้ทำงานก่อน แล้วรัน:

   ```bash
   docker compose up -d
   ```

   Docker สร้างผู้ใช้ `painaidee` และฐานข้อมูล `painaidee_dev` กับ `painaidee_test`
   ให้เอง ไม่ต้องทำอะไรเพิ่ม ตรวจว่าพร้อมแล้วด้วยคำสั่งนี้ สถานะควรขึ้น `healthy`
   (รอสักครู่ถ้ายังขึ้น `starting`):

   ```bash
   docker compose ps
   ```

   รหัสผ่านถูกตั้งตอนสร้างฐานข้อมูลครั้งแรกเท่านั้น ถ้าต้องการเปลี่ยนรหัสใน `.env`
   ทีหลัง ให้ลบข้อมูลเดิมแล้วเริ่มใหม่ (ข้อมูลในฐานข้อมูลจะหายหมด):

   ```bash
   docker compose down -v
   ```

   ```bash
   docker compose up -d
   ```

   **วิธี B ติดตั้ง PostgreSQL ลงเครื่องโดยตรง** ทำสองขั้น

   1. เปิด `psql` ด้วยคำสั่งนี้ใน PowerShell (หรือเปิด "SQL Shell (psql)" จากเมนู Start)
      แล้วใส่รหัสผ่านของผู้ใช้ `postgres` ที่ตั้งไว้ตอนติดตั้ง PostgreSQL
      (เป็นรหัสคนละตัวกับข้อ 3):

      ```powershell
      & "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h 127.0.0.1
      ```

   2. เมื่อเห็นเครื่องหมาย `postgres=#` ให้วางคำสั่งนี้ทั้งสามบรรทัด โดยแทน
      `YOUR_DB_PASSWORD` ด้วยรหัสผ่านจากข้อ 3 (เก็บเครื่องหมาย `'` ไว้) แล้วพิมพ์ `\q`
      เพื่อออก:

      ```sql
      CREATE ROLE painaidee LOGIN CREATEDB PASSWORD 'YOUR_DB_PASSWORD';
      CREATE DATABASE painaidee_dev OWNER painaidee;
      CREATE DATABASE painaidee_test OWNER painaidee;
      ```

      แต่ละบรรทัดควรตอบ `CREATE ROLE` หรือ `CREATE DATABASE` ถ้าขึ้นว่า `already exists`
      แสดงว่าเคยสร้างไว้แล้ว ข้ามบรรทัดนั้นได้ ถ้าจำรหัสของ `painaidee` ไม่ได้ ให้ตั้งใหม่ด้วย
      `ALTER ROLE painaidee PASSWORD 'YOUR_DB_PASSWORD';`

   **ใช้ pgAdmin 4 แทน `psql` (วิธี B)** ตัวติดตั้ง PostgreSQL ติดตั้ง pgAdmin 4 มาให้แล้ว
   ใช้ทำสิ่งเดียวกับคำสั่ง SQL ด้านบนได้โดยไม่ต้องพิมพ์คำสั่ง:

   1. เปิด pgAdmin 4 จากเมนู Start ครั้งแรกจะให้ตั้ง master password ของ pgAdmin เอง
      (เป็นรหัสคนละตัวกับข้อ 3 และไม่เกี่ยวกับแอป)
   2. ที่แถบซ้าย ดับเบิลคลิก **Servers → PostgreSQL 17** แล้วใส่รหัสผ่านของผู้ใช้ `postgres`
   3. คลิกขวาที่ **Login/Group Roles → Create → Login/Group Role...**
      - แท็บ **General**: Name = `painaidee`
      - แท็บ **Definition**: Password = รหัสผ่านจากข้อ 3
      - แท็บ **Privileges**: เปิด **Can login?** และ **Can create databases?** เป็น Yes
      - กด **Save**
   4. คลิกขวาที่ **Databases → Create → Database...** ตั้ง Database = `painaidee_dev`
      และ Owner = `painaidee` แล้วกด **Save** จากนั้นทำซ้ำอีกครั้งสำหรับ `painaidee_test`

   **ดูข้อมูลในฐานข้อมูลด้วย pgAdmin 4 (ไม่บังคับ ใช้ได้ทั้งวิธี A และ B)** คลิกขวาที่
   **Servers → Register → Server...**
   - แท็บ **General**: Name = ตั้งชื่ออะไรก็ได้ เช่น `painaidee`
   - แท็บ **Connection**: Host = `127.0.0.1`, Port = `5432`,
     Maintenance database = `painaidee_dev`, Username = `painaidee`,
     Password = รหัสผ่านจากข้อ 3
   - กด **Save** แล้วดูตารางที่ **painaidee_dev → Schemas → public → Tables**
     (ตารางจะมีหลังรันข้อ 6) ถ้าเชื่อมต่อไม่ได้ แปลว่ารหัสผ่านหรือพอร์ตผิด
     ปัญหาเดียวกับในหัวข้อ "ถ้าเจอปัญหา"

   ถ้าไม่ต้องการติดตั้ง pgAdmin 4 ใช้ `npm run db:studio` (ดูในหัวข้อ "คำสั่ง") ดูข้อมูลแทนได้ หลังทำข้อ 6 แล้ว

6. สร้างตารางและโหลดข้อมูลตั้งต้น (9 หมวดหมู่ 30 สถานที่)

   ```bash
   npm run db:migrate
   ```

   ```bash
   npm run db:seed
   ```

7. เริ่มแอปแล้วเปิด <http://localhost:3000>

   ```bash
   npm run dev
   ```

   หน้าแรกควรแสดง **30 สถานที่ · 9 หมวดหมู่** เหมือนกันทุกเครื่อง ส่วนบัญชีผู้ใช้
   อยู่ในฐานข้อมูลของแต่ละเครื่อง จึงต้องสมัครสมาชิกใหม่บนเครื่องของตัวเอง
   และสร้างบัญชีผู้ดูแลด้วย `npm run admin:create`

8. (ไม่บังคับ) ตรวจว่าทุกอย่างทำงาน: ควรขึ้นว่าผ่านทั้งหมด

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

ถ้าใช้ฐานข้อมูลร่วม (หัวข้อถัดไป) **ไม่ต้อง** รัน `npm run db:migrate`
ให้คนดูแลฐานข้อมูลรัน `npm run db:deploy:shared` เพียงคนเดียว

## ใช้ฐานข้อมูลร่วมของทีม (Neon)

มีฐานข้อมูล PostgreSQL ออนไลน์บน [Neon](https://neon.com/) ทุกคนที่ต่อฐานข้อมูลนี้
จะเห็นสถานที่ รีวิว และบัญชีผู้ใช้ชุดเดียวกันแบบทันที สมัครสมาชิกครั้งเดียวก็เข้าสู่ระบบได้จากเครื่องไหนก็ได้ และเมื่อใครเพิ่มรีวิวหรือสถานที่ คนอื่นจะเห็นทันทีเมื่อรีเฟรชหน้า

1. ทำตาม "เริ่มแบบย่อ" ด้านบน ถ้าต้องการรัน `npm test` ด้วย ให้ทำข้อ 3–6 ของ "รันบนเครื่อง" เพิ่ม
   เพื่อสร้างฐานข้อมูลทดสอบในเครื่อง (`painaidee_test`)
2. เปลี่ยน `DATABASE_URL` และ `DATABASE_URL_UNPOOLED` ในไฟล์ `.env` (or copy)
3. **ห้ามแก้ `TEST_DATABASE_URL`** ให้ชี้ไปที่ Neon เด็ดขาด เพราะ `npm test`
   ล้างข้อมูลในฐานข้อมูลทดสอบทุกครั้ง ต้องชี้ไปที่ `painaidee_test` ในเครื่องเหมือนเดิม
4. รัน `npm run dev` ตามปกติ ไม่ต้องรัน `npm run db:seed` เพราะบน Neon มีสถานที่ตั้งต้นแล้ว

ข้อควรระวัง:

- **ห้ามรัน `npm run db:migrate` หรือ `npm run db:reset` ขณะ `.env` ชี้ไปที่ Neon**
  สองคำสั่งนี้อาจล้างฐานข้อมูล ซึ่งจะลบข้อมูลของทั้งทีม
- เมื่อมี migration ใหม่ใน `prisma/migrations` ให้ **คนเดียว** รันหลัง `git pull`
  และ `npm install`:

  ```bash
  npm run db:deploy:shared
  ```

  คำสั่งนี้เพิ่มเฉพาะ migration ที่ยังไม่ได้ใช้ ไม่ลบข้อมูล และใช้การเชื่อมต่อตรง
  (`DATABASE_URL_UNPOOLED`) ตามที่ Neon แนะนำสำหรับการแก้โครงสร้างตาราง
- **รูปภาพยังไม่ได้แชร์กัน** รูปที่อัปโหลดถูกเก็บในเครื่องของคนที่อัปโหลด
  (`storage/uploads/`) คนอื่นจะเห็นเป็นรูปเสีย จนกว่าจะย้ายไปเก็บบนคลาวด์
- อย่าส่งไฟล์ `.env` หรือที่อยู่ฐานข้อมูลในกลุ่มแชตหรือ commit ลง git
  ใครมีที่อยู่นี้ก็อ่านและแก้ข้อมูลทั้งหมดได้
- ถ้าจะกลับไปใช้ฐานข้อมูลในเครื่อง ให้เปลี่ยน `DATABASE_URL` กลับเป็นค่าเดิมจาก `.env.example`

### ถ้าเจอปัญหา

| อาการ | วิธีแก้ |
|---|---|
| `Invalid configuration. Fix these settings in .env` | ข้อความบอกว่าค่าไหนผิด แก้ใน `.env` แล้วรันใหม่ |
| `Can't reach database server` หรือ `ECONNREFUSED` | PostgreSQL ยังไม่ได้เปิด: วิธี A รัน `docker compose up -d` วิธี B เปิด service ชื่อ `postgresql-x64-17` ใน Services ของ Windows |
| `password authentication failed` หรือ `P1000: Authentication failed ... credentials for painaidee are not valid` (มักเจอตอนรัน `npm run db:migrate` หรือ `npm test`) | รหัสผ่านใน `.env` ไม่ตรงกับที่ตั้งไว้ฝั่งฐานข้อมูล ตรวจตามลำดับ: (1) `DATABASE_URL` **และ** `TEST_DATABASE_URL` ต้องไม่เหลือคำว่า `YOUR_DB_PASSWORD` และใช้รหัสเดียวกัน (2) รหัสผ่านมีเฉพาะตัวอักษรอังกฤษและตัวเลข (3) เคยเปิด Docker ด้วยรหัสเก่า: Docker จำรหัสแรกที่ตั้งไว้ ให้รัน `docker compose down -v` แล้ว `docker compose up -d` ใหม่ (ข้อมูลหาย) (4) เปิด PostgreSQL ที่ติดตั้งในเครื่องค้างอยู่ด้วย ทำให้พอร์ต 5432 ชนกัน ให้ปิดอย่างใดอย่างหนึ่ง (5) วิธี B: รัน `ALTER ROLE painaidee PASSWORD '...';` ใน `psql` ตามข้อ 5 |
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
| `npm run db:deploy:shared` | ใช้ migration ใหม่กับฐานข้อมูลร่วมบน Neon ผ่านการเชื่อมต่อตรง (ไม่ลบข้อมูล ให้คนเดียวรัน) |
| `npm run db:studio` | เปิดดูฐานข้อมูลในเบราว์เซอร์ |
| `npm run admin:create` | สร้างบัญชีผู้ดูแล หรือเปลี่ยนบัญชีที่มีอยู่ให้เป็นผู้ดูแล (ถามอีเมล ชื่อผู้ใช้ และรหัสผ่าน) |
| `npm run db:reset` | ล้างฐานข้อมูลสำหรับพัฒนาแล้วสร้างใหม่ |

`GET /healthz` ตอบ `200 {"status":"ok"}` เมื่อแอปเชื่อมต่อฐานข้อมูลได้
และตอบ `503` เมื่อเชื่อมต่อไม่ได้
