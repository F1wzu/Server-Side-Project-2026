// Step 5: members propose places (with an optional photo), follow them on
// "my submissions", and edit / resubmit one that an admin sent back.
// Admin actions arrive in step 6, so the tests play the admin through Prisma.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const storage = require('../src/storage');
const { detectImageType } = require('../src/utils/photo');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

const UUID_PATH = /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
const INVALID_STATE_TEXT = 'แก้ไขหรือส่งใหม่ได้เฉพาะคำขอที่ผู้ดูแลส่งกลับให้แก้ไขเท่านั้น';
const UNSUPPORTED_TEXT = 'รองรับเฉพาะรูป JPEG, PNG หรือ WebP';

let category;
let otherCategory;
let place;
let admin;
let alice;
let bob;
let gpsJpeg;
let pngPhoto;

// ---------- helpers ----------

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

const closedWeek = () => Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'closed' }));

// A valid submission for the JSON API.
const validJson = (overrides = {}) => ({
  name: 'ร้านกาแฟริมคลอง',
  categoryId: category.id,
  description: 'กาแฟดี บรรยากาศริมคลอง',
  address: 'ซอยฉลองกรุง 1 ลาดกระบัง',
  latitude: 13.7279,
  longitude: 100.7782,
  phone: '02-123-4567',
  websiteUrl: 'https://example.com/cafe',
  hours: closedWeek(),
  ...overrides,
});

// The same content as flat multipart fields (state0..6 etc.), as the form sends it.
const validFields = (overrides = {}) => {
  const fields = {
    name: 'ร้านกาแฟริมคลอง',
    categoryId: String(category.id),
    description: 'กาแฟดี บรรยากาศริมคลอง',
    address: 'ซอยฉลองกรุง 1 ลาดกระบัง',
    latitude: '13.7279',
    longitude: '100.7782',
    phone: '02-123-4567',
    websiteUrl: 'https://example.com/cafe',
  };
  for (let day = 0; day < 7; day += 1) fields[`state${day}`] = 'closed';
  return { ...fields, ...overrides };
};

const withFields = (req, fields) => Object.entries(fields).reduce((r, [key, value]) => r.field(key, value), req);

// Multipart request to the API, with the CSRF header.
async function apiMultipart(client, method, url, fields, photo) {
  const token = await client.csrfToken();
  let req = withFields(client.agent[method](url).set('X-CSRF-Token', token), fields);
  if (photo) req = req.attach('photo', photo.buffer, { filename: photo.filename, contentType: photo.contentType });
  return req;
}

// Multipart form post to a page, with `_csrf` as a field (as the browser sends it).
async function formMultipart(client, url, fields, photo) {
  const token = await client.csrfToken();
  let req = withFields(client.agent.post(url), { _csrf: token, ...fields });
  if (photo) req = req.attach('photo', photo.buffer, { filename: photo.filename, contentType: photo.contentType });
  return req;
}

const jpegPhoto = () => ({ buffer: gpsJpeg, filename: 'photo.jpg', contentType: 'image/jpeg' });

const createViaApi = async (client, overrides = {}) => {
  const res = await client.post('/api/v1/submissions', validJson(overrides));
  expect(res.status).toBe(201);
  return res.body.data;
};

// The admin sends a submission back with a note (what step 6 will do).
async function returnToMember(id, note = 'กรุณาเพิ่มรูปหน้าร้านและเบอร์โทรที่ถูกต้อง') {
  const updated = await prisma.submission.update({
    where: { id },
    data: { status: 'changes_requested', reviewNote: note, version: { increment: 1 } },
    include: { category: true },
  });
  await prisma.submissionEvent.create({
    data: { submissionId: id, actorId: admin.id, action: 'returned', note, snapshot: { name: updated.name, categoryName: updated.category.name } },
  });
  return updated;
}

const storedFile = (publicPath) => path.join(storage.UPLOAD_DIR, path.basename(publicPath));
const listUploads = () => (fs.existsSync(storage.UPLOAD_DIR) ? fs.readdirSync(storage.UPLOAD_DIR).sort() : []);
const fieldsOf = (res) => (res.body.error?.details ?? []).map((detail) => detail.field);
const eventsOf = (id) => prisma.submissionEvent.findMany({ where: { submissionId: id }, orderBy: { id: 'asc' } });

// ---------- setup ----------

beforeAll(async () => {
  gpsJpeg = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3a7d5c' } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'PaiNaiDeeCam', Model: 'TestModel' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 43/1 37/1', GPSLongitudeRef: 'E', GPSLongitude: '100/1 46/1 42/1' },
    })
    .toBuffer();
  pngPhoto = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c0392b' } }).png().toBuffer();
});

beforeEach(async () => {
  await resetDatabase();
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  otherCategory = await prisma.category.create({ data: { name: 'ตลาดและชุมชน' } });
  place = await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านที่เผยแพร่แล้ว', description: 'รายละเอียด', address: 'ลาดกระบัง' } });
  admin = await prisma.user.create({ data: { username: 'admin', email: 'admin@example.com', passwordHash: 'not-a-real-hash', role: 'admin' } });
  alice = await member('alice');
  bob = await member('bob');
});

afterAll(async () => {
  fs.rmSync(storage.UPLOAD_DIR, { recursive: true, force: true });
  await closeDatabase();
});

// ---------- 1. creating through the API ----------

describe('creating a submission through the API', () => {
  test('multipart with a photo: 201, pending, version 1, one "submitted" event, photo stored as WebP without EXIF/GPS', async () => {
    // The fixture really carries GPS data.
    const input = await sharp(gpsJpeg).metadata();
    expect(input.exif).toBeDefined();
    expect(input.exif.toString('latin1')).toContain('PaiNaiDeeCam');

    const before = listUploads();
    const res = await apiMultipart(alice, 'post', '/api/v1/submissions', validFields({ next5: 'on', state5: 'open', opens5: '18:00', closes5: '02:00' }), jpegPhoto());
    expect(res.status).toBe(201);
    const data = res.body.data;
    expect(data).toMatchObject({ status: 'pending', version: 1, name: 'ร้านกาแฟริมคลอง', categoryId: category.id, latitude: 13.7279, longitude: 100.7782, userId: alice.id });
    expect(data.hours[5]).toEqual({ weekday: 5, state: 'open', opensAt: '18:00', closesAt: '02:00', closesNextDay: true });
    expect(data.imagePath).toMatch(UUID_PATH);

    const events = await eventsOf(data.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: 'submitted', actorId: alice.id });
    expect(events[0].snapshot).toMatchObject({ name: 'ร้านกาแฟริมคลอง', categoryName: 'คาเฟ่', imagePath: data.imagePath, latitude: 13.7279 });
    expect(events[0].snapshot.hours).toHaveLength(7);

    // The file: a new random name in the temp folder, WebP, no metadata.
    expect(listUploads()).toEqual([...before, path.basename(data.imagePath)].sort());
    const stored = fs.readFileSync(storedFile(data.imagePath));
    expect(detectImageType(stored)).toBe('webp');
    const output = await sharp(stored).metadata();
    expect(output.format).toBe('webp');
    expect(output.exif).toBeUndefined();
    expect(output.xmp).toBeUndefined();
    expect(stored.includes('PaiNaiDeeCam')).toBe(false);
    expect(stored.includes('Exif')).toBe(false);

    // It is served at its public path.
    const served = await alice.get(data.imagePath);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toMatch(/^image\/webp/);
  });

  test('JSON without a photo: 201, pending, version 1, imagePath null, one "submitted" event', async () => {
    const res = await alice.post('/api/v1/submissions', validJson({ name: '  ตลาดนัดหัวตะเข้  ' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: 'pending', version: 1, imagePath: null, name: 'ตลาดนัดหัวตะเข้' });
    const events = await eventsOf(res.body.data.id);
    expect(events.map((event) => event.action)).toEqual(['submitted']);
    expect(events[0].snapshot).toMatchObject({ name: 'ตลาดนัดหัวตะเข้', categoryName: 'คาเฟ่', imagePath: null });
  });

  test('a visitor gets 401 and nothing is stored', async () => {
    const res = await createClient(app).post('/api/v1/submissions', validJson());
    expect(res.status).toBe(401);
    expect(await prisma.submission.count()).toBe(0);
  });
});

// ---------- 2. the page form ----------

describe('the page form', () => {
  test('the form page needs a login and shows the fields', async () => {
    const visitor = await createClient(app).get('/submissions/new');
    expect(visitor.status).toBe(302);
    expect(visitor.headers.location).toMatch(/^\/login/);
    const page = await alice.get('/submissions/new');
    expect(page.status).toBe(200);
    expect(page.text).toContain('enctype="multipart/form-data"');
    expect(page.text).toContain('name="_csrf"');
  });

  test('a multipart post with the _csrf field creates the submission and redirects to it with a flash', async () => {
    const res = await formMultipart(alice, '/submissions', validFields(), jpegPhoto());
    expect(res.status).toBe(303);
    const row = await prisma.submission.findFirst();
    expect(row).toMatchObject({ userId: alice.id, status: 'pending', version: 1 });
    expect(row.imagePath).toMatch(UUID_PATH);
    expect(res.headers.location).toBe(`/me/submissions/${row.id}`);

    const page = await alice.get(res.headers.location);
    expect(page.status).toBe(200);
    expect(page.text).toContain('ส่งคำขอแล้ว ผู้ดูแลจะตรวจสอบก่อนเผยแพร่');
    expect(page.text).toContain('ร้านกาแฟริมคลอง');
    // The flash is shown once.
    expect((await alice.get(res.headers.location)).text).not.toContain('ส่งคำขอแล้ว ผู้ดูแลจะตรวจสอบก่อนเผยแพร่');
  });

  test('a validation error shows the form again (400) with the typed values and field messages', async () => {
    const res = await formMultipart(alice, '/submissions', validFields({ name: 'ร้านที่พิมพ์ไว้แล้ว', description: '', latitude: '13.9', longitude: '100.9' }));
    expect(res.status).toBe(400);
    expect(res.text).toContain('value="ร้านที่พิมพ์ไว้แล้ว"');
    expect(res.text).toContain('ซอยฉลองกรุง 1 ลาดกระบัง');
    expect(res.text).toContain('กรุณากรอกรายละเอียด');
    expect(res.text).toContain('id="description-error"');
    expect(res.text).toContain('อยู่นอกเขตลาดกระบัง');
    expect(await prisma.submission.count()).toBe(0);
  });

  test('a text file named .jpg shows the form again with the photo message and stores nothing', async () => {
    const before = listUploads();
    const res = await formMultipart(alice, '/submissions', validFields({ name: 'ร้านรูปปลอม' }), {
      buffer: Buffer.from('นี่ไม่ใช่รูปภาพ แค่ข้อความธรรมดา'),
      filename: 'photo.jpg',
      contentType: 'image/jpeg',
    });
    expect(res.status).toBe(415);
    expect(res.text).toContain(UNSUPPORTED_TEXT);
    expect(res.text).toContain('id="photo-error"');
    expect(res.text).toContain('value="ร้านรูปปลอม"');
    expect(await prisma.submission.count()).toBe(0);
    expect(listUploads()).toEqual(before);
  });
});

// ---------- 3. validation ----------

describe('validation (API)', () => {
  const expectRefused = async (body, field) => {
    const res = await alice.post('/api/v1/submissions', body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(fieldsOf(res).some((name) => name === field || name.startsWith(`${field}.`))).toBe(true);
    expect(await prisma.submission.count()).toBe(0);
    return res;
  };

  test('a missing pin is refused', async () => {
    const { latitude, longitude, ...noPin } = validJson(); // eslint-disable-line no-unused-vars
    await expectRefused(noPin, 'latitude');
    await expectRefused(validJson({ latitude: '', longitude: '' }), 'latitude');
  });

  test('a pin outside Lat Krabang is refused; one inside is accepted', async () => {
    const res = await expectRefused(validJson({ latitude: 13.9, longitude: 100.9 }), 'latitude');
    expect(fieldsOf(res)).toContain('latitude');
    await expectRefused(validJson({ latitude: 13.72, longitude: 100.6 }), 'longitude');
    await expectRefused(validJson({ latitude: 'abc', longitude: 100.77 }), 'latitude');
    const ok = await alice.post('/api/v1/submissions', validJson({ latitude: 13.72, longitude: 100.77 }));
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ latitude: 13.72, longitude: 100.77 });
  });

  test.each([
    ['name', ''],
    ['name', '   '],
    ['name', 'x'.repeat(201)],
    ['description', ''],
    ['description', 'x'.repeat(5001)],
    ['address', ''],
    ['address', 'x'.repeat(501)],
  ])('%s %j is refused', async (field, value) => {
    await expectRefused(validJson({ [field]: value }), field);
  });

  test('the longest allowed texts are accepted', async () => {
    const res = await alice.post('/api/v1/submissions', validJson({ name: 'x'.repeat(200), description: 'x'.repeat(5000), address: 'x'.repeat(500) }));
    expect(res.status).toBe(201);
  });

  test('an unknown category is refused', async () => {
    await expectRefused(validJson({ categoryId: 999999 }), 'categoryId');
    await expectRefused(validJson({ categoryId: 'abc' }), 'categoryId');
  });

  test('an open day without times is refused', async () => {
    const hours = closedWeek();
    hours[1] = { weekday: 1, state: 'open' };
    await expectRefused(validJson({ hours }), 'hours');
  });

  test('closing before opening without "next day" is refused', async () => {
    const hours = closedWeek();
    hours[5] = { weekday: 5, state: 'open', opensAt: '18:00', closesAt: '02:00', closesNextDay: false };
    await expectRefused(validJson({ hours }), 'hours');
  });

  test('overnight 18:00-02:00 with "next day" is accepted', async () => {
    const hours = closedWeek();
    hours[5] = { weekday: 5, state: 'open', opensAt: '18:00', closesAt: '02:00', closesNextDay: true };
    const res = await alice.post('/api/v1/submissions', validJson({ hours }));
    expect(res.status).toBe(201);
    expect(res.body.data.hours[5]).toEqual({ weekday: 5, state: 'open', opensAt: '18:00', closesAt: '02:00', closesNextDay: true });
  });

  test('fewer than seven days (JSON) are refused', async () => {
    await expectRefused(validJson({ hours: closedWeek().slice(0, 6) }), 'hours');
  });

  test('flat form hours: an open day without times is refused (multipart)', async () => {
    const res = await apiMultipart(alice, 'post', '/api/v1/submissions', validFields({ state2: 'open', opens2: '', closes2: '' }));
    expect(res.status).toBe(400);
    expect(fieldsOf(res).some((name) => name.startsWith('hours'))).toBe(true);
  });

  test('a phone number with letters is refused', async () => {
    await expectRefused(validJson({ phone: '02-abc-4567' }), 'phone');
  });

  test('a javascript: link is refused', async () => {
    await expectRefused(validJson({ websiteUrl: 'javascript:alert(1)' }), 'websiteUrl');
  });

  test('phone and link are optional', async () => {
    const res = await alice.post('/api/v1/submissions', validJson({ phone: '', websiteUrl: '' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ phone: null, websiteUrl: null });
  });
});

// ---------- 4. uploads ----------

describe('refused uploads (API)', () => {
  test.each([
    ['a 6 MB file', () => {
      const big = Buffer.alloc(6 * 1024 * 1024, 0x41);
      big.set([0xff, 0xd8, 0xff, 0xe0]);
      return { buffer: big, filename: 'big.jpg', contentType: 'image/jpeg' };
    }, 413, 'FILE_TOO_LARGE'],
    ['a program renamed .jpg', () => ({ buffer: Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4096, 0x90)]), filename: 'photo.jpg', contentType: 'image/jpeg' }), 415, 'UNSUPPORTED_FILE'],
    ['a text file', () => ({ buffer: Buffer.from('สวัสดี นี่ไม่ใช่รูปภาพ'), filename: 'note.txt', contentType: 'text/plain' }), 415, 'UNSUPPORTED_FILE'],
  ])('%s is refused, no submission row and no file are left', async (label, makeFile, status, code) => {
    const before = listUploads();
    const res = await apiMultipart(alice, 'post', '/api/v1/submissions', validFields(), makeFile());
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
    expect(await prisma.submission.count()).toBe(0);
    expect(await prisma.submissionEvent.count()).toBe(0);
    expect(listUploads()).toEqual(before);
  });

  test('a valid photo with an unknown category leaves no orphan file', async () => {
    const before = listUploads();
    const res = await apiMultipart(alice, 'post', '/api/v1/submissions', validFields({ categoryId: '999999' }), jpegPhoto());
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toContain('categoryId');
    expect(await prisma.submission.count()).toBe(0);
    expect(listUploads()).toEqual(before);
  });
});

// ---------- 5. CSRF ----------

describe('CSRF', () => {
  test('a multipart post to the API without a token is 403 and stores nothing', async () => {
    const before = listUploads();
    const res = await withFields(alice.agent.post('/api/v1/submissions'), validFields()).attach('photo', gpsJpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.submission.count()).toBe(0);
    expect(listUploads()).toEqual(before);
  });

  test('a multipart post to the API with a wrong token is 403', async () => {
    const res = await withFields(alice.agent.post('/api/v1/submissions').set('X-CSRF-Token', 'wrong'), validFields());
    expect(res.status).toBe(403);
    expect(await prisma.submission.count()).toBe(0);
  });

  test('a multipart post to the page form without _csrf is 403 and stores nothing', async () => {
    await alice.csrfToken(); // the session has a token, the form just does not send it
    const before = listUploads();
    const res = await withFields(alice.agent.post('/submissions'), validFields()).attach('photo', gpsJpeg, { filename: 'photo.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(403);
    expect(await prisma.submission.count()).toBe(0);
    expect(listUploads()).toEqual(before);
  });

  test('a multipart PATCH without a token is 403 and changes nothing', async () => {
    const created = await createViaApi(alice);
    await returnToMember(created.id);
    const res = await withFields(alice.agent.patch(`/api/v1/me/submissions/${created.id}`), validFields({ name: 'ชื่อใหม่', version: '2' }));
    expect(res.status).toBe(403);
    expect(await prisma.submission.findUnique({ where: { id: created.id } })).toMatchObject({ name: 'ร้านกาแฟริมคลอง', version: 2 });
  });

  test('a non-photo route does not read _csrf from a multipart body: /places/:id/reviews is 403', async () => {
    const token = await alice.csrfToken();
    const res = await alice.agent.post(`/places/${place.id}/reviews`).field('_csrf', token).field('rating', '5').field('comment', 'ดีมาก');
    expect(res.status).toBe(403);
    expect(await prisma.review.count()).toBe(0);
  });

  test('a non-photo route does not read _csrf from a multipart body: /logout is 403 and the member stays logged in', async () => {
    const token = await alice.csrfToken();
    const res = await alice.agent.post('/logout').field('_csrf', token);
    expect(res.status).toBe(403);
    expect((await alice.get('/api/v1/me')).status).toBe(200);
  });

  test('the resubmit route (no photo) does not read _csrf from a multipart body', async () => {
    const created = await createViaApi(alice);
    await returnToMember(created.id);
    const token = await alice.csrfToken();
    const res = await alice.agent.post(`/me/submissions/${created.id}/resubmit`).field('_csrf', token).field('version', '2');
    expect(res.status).toBe(403);
    expect((await prisma.submission.findUnique({ where: { id: created.id } })).status).toBe('changes_requested');
  });
});

// ---------- 6. privacy ----------

describe('privacy', () => {
  const SECRET = 'ร้านลับเฉพาะผู้เสนอ';

  test('a submission appears on no public page or API', async () => {
    await createViaApi(alice, { name: SECRET, latitude: 13.73, longitude: 100.78 });
    const visitor = createClient(app);
    const encoded = encodeURIComponent(SECRET);
    const responses = await Promise.all([
      visitor.get('/'),
      visitor.get('/places'),
      visitor.get('/map'),
      visitor.get('/api/v1/places?pageSize=50'),
      visitor.get('/api/v1/places/map'),
      visitor.get('/api/v1/recommendations'),
      alice.get('/places'),
    ]);
    for (const res of responses) {
      expect(res.status).toBe(200);
      expect(res.text).not.toContain(SECRET);
    }
    // The published place is listed, so the lists themselves work.
    expect((await visitor.get('/api/v1/places')).body.data.map((item) => item.name)).toEqual(['ร้านที่เผยแพร่แล้ว']);
    // Searching by its name finds nothing (the search page echoes the query, so count results instead).
    for (const client of [visitor, alice]) {
      const api = await client.get(`/api/v1/places?q=${encoded}`);
      expect(api.status).toBe(200);
      expect(api.body.data).toEqual([]);
      const page = await client.get(`/places?q=${encoded}`);
      expect(page.status).toBe(200);
      expect(page.text).toContain('พบ <strong>0</strong> สถานที่');
      expect(page.text).not.toContain(`>${SECRET}<`);
    }
  });

  test('another member gets 404 for viewing, editing and resubmitting it', async () => {
    const created = await createViaApi(alice, { name: SECRET });
    await returnToMember(created.id); // editable for its owner, so 404 is about ownership
    const id = created.id;

    const page = await bob.get(`/me/submissions/${id}`);
    expect(page.status).toBe(404);
    expect(page.text).not.toContain(SECRET);
    expect((await bob.get(`/me/submissions/${id}/edit`)).status).toBe(404);
    const api = await bob.get(`/api/v1/me/submissions/${id}`);
    expect(api.status).toBe(404);
    expect(JSON.stringify(api.body)).not.toContain(SECRET);

    expect((await bob.patch(`/api/v1/me/submissions/${id}`, validJson({ name: 'ของบ็อบ', version: 2 }))).status).toBe(404);
    expect((await bob.post(`/api/v1/me/submissions/${id}/resubmit`, { version: 2 })).status).toBe(404);
    expect((await formMultipart(bob, `/me/submissions/${id}`, validFields({ name: 'ของบ็อบ', version: '2' }))).status).toBe(404);
    expect((await bob.postForm(`/me/submissions/${id}/resubmit`, { version: '2' })).status).toBe(404);

    const row = await prisma.submission.findUnique({ where: { id } });
    expect(row).toMatchObject({ name: SECRET, status: 'changes_requested', version: 2 });
    expect(await prisma.submissionEvent.count({ where: { submissionId: id } })).toBe(2);
  });

  test('odd ids are 404', async () => {
    for (const id of ['999999', 'abc', '1.5', '0']) {
      expect((await alice.get(`/api/v1/me/submissions/${id}`)).status).toBe(404);
    }
  });

  test('a visitor gets 401 from the API and the login page from pages', async () => {
    const created = await createViaApi(alice);
    const visitor = createClient(app);
    expect((await visitor.get('/api/v1/me/submissions')).status).toBe(401);
    expect((await visitor.get(`/api/v1/me/submissions/${created.id}`)).status).toBe(401);
    expect((await visitor.patch(`/api/v1/me/submissions/${created.id}`, validJson({ version: 1 }))).status).toBe(401);
    expect((await visitor.post(`/api/v1/me/submissions/${created.id}/resubmit`, { version: 1 })).status).toBe(401);
    for (const url of ['/me/submissions', `/me/submissions/${created.id}`, `/me/submissions/${created.id}/edit`]) {
      const res = await visitor.get(url);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`/login?next=${encodeURIComponent(url)}`);
    }
    const form = await formMultipart(visitor, '/submissions', validFields());
    expect(form.status).toBe(302);
    expect(form.headers.location).toBe('/login');
    expect(await prisma.submission.count()).toBe(1);
  });
});

// ---------- 7. workflow ----------

describe('editing and resubmitting', () => {
  test('a pending submission cannot be edited or resubmitted through the API (409 INVALID_STATE)', async () => {
    const created = await createViaApi(alice);
    const edit = await alice.patch(`/api/v1/me/submissions/${created.id}`, validJson({ name: 'ชื่อใหม่', version: 1 }));
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('INVALID_STATE');
    const resubmit = await alice.post(`/api/v1/me/submissions/${created.id}/resubmit`, { version: 1 });
    expect(resubmit.status).toBe(409);
    expect(resubmit.body.error.code).toBe('INVALID_STATE');
    expect(await prisma.submission.findUnique({ where: { id: created.id } })).toMatchObject({ name: 'ร้านกาแฟริมคลอง', version: 1, status: 'pending' });
    expect(await prisma.submissionEvent.count()).toBe(1);
  });

  test('a pending submission edited with a photo leaves no orphan file', async () => {
    const created = await createViaApi(alice);
    const before = listUploads();
    const res = await apiMultipart(alice, 'patch', `/api/v1/me/submissions/${created.id}`, validFields({ version: '1' }), jpegPhoto());
    expect(res.status).toBe(409);
    expect(listUploads()).toEqual(before);
  });

  test('a pending submission cannot be edited or resubmitted from the pages; the message is shown after the redirect', async () => {
    const created = await createViaApi(alice);
    const url = `/me/submissions/${created.id}`;

    const editPage = await alice.get(`${url}/edit`);
    expect(editPage.status).toBe(303);
    expect(editPage.headers.location).toBe(url);
    expect((await alice.get(url)).text).toContain('แก้ไขได้เฉพาะคำขอที่ผู้ดูแลส่งกลับให้แก้ไขเท่านั้น');

    const edit = await formMultipart(alice, url, validFields({ name: 'ชื่อใหม่', version: '1' }));
    expect(edit.status).toBe(303);
    expect(edit.headers.location).toBe(url);
    expect((await alice.get(url)).text).toContain(INVALID_STATE_TEXT);

    const resubmit = await alice.postForm(`${url}/resubmit`, { version: '1' });
    expect(resubmit.status).toBe(303);
    expect(resubmit.headers.location).toBe(url);
    expect((await alice.get(url)).text).toContain(INVALID_STATE_TEXT);

    expect(await prisma.submission.findUnique({ where: { id: created.id } })).toMatchObject({ name: 'ร้านกาแฟริมคลอง', version: 1, status: 'pending' });
  });

  test('a returned submission can be edited (version +1, "edited") and resubmitted (pending, version +1, "resubmitted")', async () => {
    const created = await createViaApi(alice);
    await returnToMember(created.id);

    const edit = await alice.patch(`/api/v1/me/submissions/${created.id}`, validJson({ name: 'ร้านกาแฟริมคลอง (แก้แล้ว)', categoryId: otherCategory.id, version: 2 }));
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ name: 'ร้านกาแฟริมคลอง (แก้แล้ว)', categoryId: otherCategory.id, status: 'changes_requested', version: 3 });

    const resubmit = await alice.post(`/api/v1/me/submissions/${created.id}/resubmit`, { version: 3 });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data).toMatchObject({ status: 'pending', version: 4 });

    const events = await eventsOf(created.id);
    expect(events.map((event) => event.action)).toEqual(['submitted', 'returned', 'edited', 'resubmitted']);
    expect(events[2].snapshot).toMatchObject({ name: 'ร้านกาแฟริมคลอง (แก้แล้ว)', categoryName: 'ตลาดและชุมชน' });
    expect(events[3].snapshot).toMatchObject({ name: 'ร้านกาแฟริมคลอง (แก้แล้ว)', categoryName: 'ตลาดและชุมชน' });

    // Pending again: no more edits.
    const again = await alice.patch(`/api/v1/me/submissions/${created.id}`, validJson({ version: 4 }));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
  });

  test('the page form edits and resubmits a returned submission', async () => {
    const created = await createViaApi(alice);
    await returnToMember(created.id);
    const url = `/me/submissions/${created.id}`;

    const form = await alice.get(`${url}/edit`);
    expect(form.status).toBe(200);
    expect(form.text).toContain('name="version" value="2"');
    expect(form.text).toContain('value="ร้านกาแฟริมคลอง"');

    const edit = await formMultipart(alice, url, validFields({ name: 'ชื่อที่แก้จากฟอร์ม', version: '2' }));
    expect(edit.status).toBe(303);
    expect(edit.headers.location).toBe(url);
    expect(await prisma.submission.findUnique({ where: { id: created.id } })).toMatchObject({ name: 'ชื่อที่แก้จากฟอร์ม', version: 3 });

    const invalid = await formMultipart(alice, url, validFields({ name: '', version: '3' }));
    expect(invalid.status).toBe(400);
    expect(invalid.text).toContain('กรุณากรอกชื่อสถานที่');

    const resubmit = await alice.postForm(`${url}/resubmit`, { version: '3' });
    expect(resubmit.status).toBe(303);
    expect((await alice.get(url)).text).toContain('ส่งให้ผู้ดูแลตรวจสอบอีกครั้งแล้ว');
    expect(await prisma.submission.findUnique({ where: { id: created.id } })).toMatchObject({ status: 'pending', version: 4 });
  });

  test('a stale version is 409 STALE_VERSION and nothing changes', async () => {
    const created = await createViaApi(alice);
    await returnToMember(created.id); // version is now 2
    const eventsBefore = await prisma.submissionEvent.count();

    const edit = await alice.patch(`/api/v1/me/submissions/${created.id}`, validJson({ name: 'ชื่อจากหน้าเก่า', version: 1 }));
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('STALE_VERSION');
    const resubmit = await alice.post(`/api/v1/me/submissions/${created.id}/resubmit`, { version: 1 });
    expect(resubmit.status).toBe(409);
    expect(resubmit.body.error.code).toBe('STALE_VERSION');

    expect(await prisma.submission.findUnique({ where: { id: created.id } })).toMatchObject({ name: 'ร้านกาแฟริมคลอง', version: 2, status: 'changes_requested' });
    expect(await prisma.submissionEvent.count()).toBe(eventsBefore);
  });

  test('a missing version is 400', async () => {
    const created = await createViaApi(alice);
    await returnToMember(created.id);
    const { version, ...noVersion } = validJson(); // eslint-disable-line no-unused-vars
    const res = await alice.patch(`/api/v1/me/submissions/${created.id}`, noVersion);
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toContain('version');
  });

  test('two edits sent at the same moment with the same version: exactly one succeeds', async () => {
    const created = await createViaApi(alice);
    await returnToMember(created.id);
    const token = await alice.csrfToken();
    const send = (name) => alice.agent.patch(`/api/v1/me/submissions/${created.id}`).set('X-CSRF-Token', token).send(validJson({ name, version: 2 }));
    const results = await Promise.all([send('แก้ครั้งที่หนึ่ง'), send('แก้ครั้งที่สอง')]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(results.find((res) => res.status === 409).body.error.code).toBe('STALE_VERSION');
    const winner = results.find((res) => res.status === 200).body.data.name;
    expect(await prisma.submission.findUnique({ where: { id: created.id } })).toMatchObject({ name: winner, version: 3 });
    expect(await prisma.submissionEvent.count({ where: { submissionId: created.id, action: 'edited' } })).toBe(1);
  });

  test('a new photo replaces the old one and deletes its file; an edit without a photo keeps it', async () => {
    const res = await apiMultipart(alice, 'post', '/api/v1/submissions', validFields(), jpegPhoto());
    expect(res.status).toBe(201);
    const { id, imagePath: oldPath } = res.body.data;
    expect(fs.existsSync(storedFile(oldPath))).toBe(true);
    await returnToMember(id);

    const withPhoto = await apiMultipart(alice, 'patch', `/api/v1/me/submissions/${id}`, validFields({ version: '2' }), { buffer: pngPhoto, filename: 'new.png', contentType: 'image/png' });
    expect(withPhoto.status).toBe(200);
    const newPath = withPhoto.body.data.imagePath;
    expect(newPath).toMatch(UUID_PATH);
    expect(newPath).not.toBe(oldPath);
    expect(fs.existsSync(storedFile(oldPath))).toBe(false);
    expect(fs.existsSync(storedFile(newPath))).toBe(true);
    expect(await sharp(fs.readFileSync(storedFile(newPath))).metadata()).toMatchObject({ format: 'webp', width: 300, height: 200 });
    expect((await alice.get(oldPath)).status).toBe(404);

    // Without a photo (multipart and JSON): the current photo stays.
    const multipartNoPhoto = await apiMultipart(alice, 'patch', `/api/v1/me/submissions/${id}`, validFields({ name: 'ไม่เปลี่ยนรูป', version: '3' }));
    expect(multipartNoPhoto.status).toBe(200);
    expect(multipartNoPhoto.body.data.imagePath).toBe(newPath);
    const jsonNoPhoto = await alice.patch(`/api/v1/me/submissions/${id}`, validJson({ version: 4 }));
    expect(jsonNoPhoto.status).toBe(200);
    expect(jsonNoPhoto.body.data).toMatchObject({ imagePath: newPath, version: 5 });
    expect(fs.existsSync(storedFile(newPath))).toBe(true);
  });

  test('the page form replaces the photo too', async () => {
    const created = await apiMultipart(alice, 'post', '/api/v1/submissions', validFields(), jpegPhoto());
    const { id, imagePath: oldPath } = created.body.data;
    await returnToMember(id);
    const res = await formMultipart(alice, `/me/submissions/${id}`, validFields({ version: '2' }), { buffer: pngPhoto, filename: 'new.png', contentType: 'image/png' });
    expect(res.status).toBe(303);
    const row = await prisma.submission.findUnique({ where: { id } });
    expect(row.imagePath).toMatch(UUID_PATH);
    expect(row.imagePath).not.toBe(oldPath);
    expect(fs.existsSync(storedFile(oldPath))).toBe(false);
  });

  test('the detail page shows the note, the history, and the buttons only when returned', async () => {
    const created = await createViaApi(alice);
    const url = `/me/submissions/${created.id}`;

    const pending = await alice.get(url);
    expect(pending.status).toBe(200);
    expect(pending.text).toContain('รอตรวจสอบ');
    expect(pending.text).toContain('ส่งคำขอ'); // "submitted" in the timeline
    expect(pending.text).toContain('ระหว่างนี้แก้ไขไม่ได้');
    expect(pending.text).not.toContain(`href="${url}/edit"`);
    expect(pending.text).not.toContain(`action="${url}/resubmit"`);

    await returnToMember(created.id, 'รูปไม่ชัด กรุณาถ่ายหน้าร้านใหม่');
    const returned = await alice.get(url);
    expect(returned.text).toContain('สิ่งที่ต้องแก้ไข');
    expect(returned.text).toContain('รูปไม่ชัด กรุณาถ่ายหน้าร้านใหม่');
    expect(returned.text).toContain('ผู้ดูแลส่งกลับให้แก้ไข');
    expect(returned.text).toContain('รอแก้ไข');
    expect(returned.text).toContain(`href="${url}/edit"`);
    expect(returned.text).toContain(`action="${url}/resubmit"`);
    expect(returned.text).toContain('name="version" value="2"');

    // The history in the API: in order, without internal actor ids on the events.
    const api = await alice.get(`/api/v1/me/submissions/${created.id}`);
    expect(api.status).toBe(200);
    expect(api.body.data.events.map((event) => event.action)).toEqual(['submitted', 'returned']);
    expect(api.body.data.events[1].note).toBe('รูปไม่ชัด กรุณาถ่ายหน้าร้านใหม่');
    for (const event of api.body.data.events) expect(event).not.toHaveProperty('actorId');
  });
});

// ---------- 8. my submissions ----------

describe('my submissions', () => {
  test('the list shows only my own submissions (page and API)', async () => {
    await createViaApi(alice, { name: 'ของอลิซหนึ่ง' });
    await createViaApi(alice, { name: 'ของอลิซสอง' });
    await createViaApi(bob, { name: 'ของบ็อบเท่านั้น' });

    const page = await alice.get('/me/submissions');
    expect(page.status).toBe(200);
    expect(page.text).toContain('ของอลิซหนึ่ง');
    expect(page.text).toContain('ของอลิซสอง');
    expect(page.text).not.toContain('ของบ็อบเท่านั้น');

    const api = await alice.get('/api/v1/me/submissions');
    expect(api.status).toBe(200);
    expect(api.body.data.map((item) => item.name).sort()).toEqual(['ของอลิซสอง', 'ของอลิซหนึ่ง'].sort());
    expect(api.body.meta.total).toBe(2);

    const bobs = await bob.get('/api/v1/me/submissions');
    expect(bobs.body.data.map((item) => item.name)).toEqual(['ของบ็อบเท่านั้น']);
  });

  test('a member without submissions sees the empty state', async () => {
    const page = await bob.get('/me/submissions');
    expect(page.status).toBe(200);
    expect(page.text).toContain('ยังไม่มีคำขอของคุณ');
  });
});
