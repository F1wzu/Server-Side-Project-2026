// Step 6: an admin manages places directly: list (including unpublished),
// add, edit (content, hours, featured order, photo) and publish / unpublish.
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const storage = require('../src/storage');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

const UUID_PATH = /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

let category;
let otherCategory;
let admin;
let alice;
let photoBuffer;

// ---------- helpers ----------

const closedWeek = () => Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'closed' }));

const validJson = (overrides = {}) => ({
  name: 'ร้านกาแฟของผู้ดูแล',
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

const validFields = (overrides = {}) => {
  const fields = {
    name: 'ร้านกาแฟของผู้ดูแล',
    categoryId: String(category.id),
    description: 'กาแฟดี บรรยากาศริมคลอง',
    address: 'ซอยฉลองกรุง 1 ลาดกระบัง',
    latitude: '13.7279',
    longitude: '100.7782',
    status: 'published',
    featuredOrder: '',
  };
  for (let day = 0; day < 7; day += 1) fields[`state${day}`] = 'closed';
  return { ...fields, ...overrides };
};

const withFields = (req, fields) => Object.entries(fields).reduce((r, [key, value]) => r.field(key, value), req);
const photo = () => ({ buffer: photoBuffer, filename: 'photo.jpg', contentType: 'image/jpeg' });

async function apiMultipart(client, method, url, fields, file) {
  const token = await client.csrfToken();
  let req = withFields(client.agent[method](url).set('X-CSRF-Token', token), fields);
  if (file) req = req.attach('photo', file.buffer, { filename: file.filename, contentType: file.contentType });
  return req;
}

async function formMultipart(client, url, fields, file) {
  const token = await client.csrfToken();
  let req = withFields(client.agent.post(url), { _csrf: token, ...fields });
  if (file) req = req.attach('photo', file.buffer, { filename: file.filename, contentType: file.contentType });
  return req;
}

const uploadPath = (publicPath) => path.join(storage.UPLOAD_DIR, path.basename(publicPath));
const uploadExists = (publicPath) => fs.existsSync(uploadPath(publicPath));
const listUploads = () => (fs.existsSync(storage.UPLOAD_DIR) ? fs.readdirSync(storage.UPLOAD_DIR).sort() : []);
const fieldsOf = (res) => (res.body.error?.details ?? []).map((detail) => detail.field);

const makePlace = (overrides = {}) =>
  prisma.place.create({
    data: { categoryId: category.id, name: 'ร้านเดิม', description: 'รายละเอียดเดิม', address: 'ลาดกระบัง', ...overrides },
  });

// An admin session and a member session.
async function loggedInAdmin() {
  const client = createClient(app);
  await client.registerAdmin();
  return client;
}

// ---------- setup ----------

beforeAll(async () => {
  photoBuffer = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3a7d5c' } }).jpeg().toBuffer();
});

beforeEach(async () => {
  await resetDatabase();
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  otherCategory = await prisma.category.create({ data: { name: 'ตลาดและชุมชน' } });
  admin = await loggedInAdmin();
  alice = createClient(app);
  await alice.register({ username: 'alice', email: 'alice@example.com' });
});

afterAll(async () => {
  fs.rmSync(storage.UPLOAD_DIR, { recursive: true, force: true });
  await closeDatabase();
});

// ---------- 1. access ----------

describe('access', () => {
  test('a visitor is sent to login (pages) or gets 401 (API)', async () => {
    const visitor = createClient(app);
    for (const url of ['/admin/places', '/admin/places/new', '/admin/places/1/edit']) {
      const res = await visitor.get(url);
      expect(res.status).toBe(302);
      expect(res.headers.location).toMatch(/^\/login/);
    }
    expect((await visitor.get('/api/v1/admin/places')).status).toBe(401);
    expect((await visitor.get('/api/v1/admin/places/1')).status).toBe(401);
    expect((await visitor.post('/api/v1/admin/places', validJson())).status).toBe(401);
    expect(await prisma.place.count()).toBe(0);
  });

  test('a member gets 403 everywhere and nothing changes', async () => {
    const place = await makePlace();
    for (const url of ['/admin/places', '/admin/places/new', `/admin/places/${place.id}/edit`]) {
      expect((await alice.get(url)).status).toBe(403);
    }
    expect((await alice.get('/api/v1/admin/places')).status).toBe(403);
    expect((await alice.get(`/api/v1/admin/places/${place.id}`)).status).toBe(403);
    expect((await alice.post('/api/v1/admin/places', validJson())).status).toBe(403);
    expect((await alice.patch(`/api/v1/admin/places/${place.id}`, { status: 'unpublished' })).status).toBe(403);
    expect((await alice.postForm(`/admin/places/${place.id}/status`, { status: 'unpublished' })).status).toBe(403);
    expect((await formMultipart(alice, '/admin/places', validFields())).status).toBe(403);
    expect(await prisma.place.count()).toBe(1);
    expect((await prisma.place.findUnique({ where: { id: place.id } })).status).toBe('published');
  });
});

// ---------- 2. list ----------

describe('the list', () => {
  test('shows unpublished places too, and filters by status and name', async () => {
    await makePlace({ name: 'ร้านเผยแพร่' });
    await makePlace({ name: 'ร้านที่ซ่อนอยู่', status: 'unpublished' });

    const page = await admin.get('/admin/places');
    expect(page.status).toBe(200);
    expect(page.text).toContain('ร้านเผยแพร่');
    expect(page.text).toContain('ร้านที่ซ่อนอยู่');
    expect(page.text).toContain('เพิ่มสถานที่');

    const all = await admin.get('/api/v1/admin/places');
    expect(all.status).toBe(200);
    expect(all.body.data.map((place) => place.name).sort()).toEqual(['ร้านที่ซ่อนอยู่', 'ร้านเผยแพร่'].sort());
    expect(all.body.meta.total).toBe(2);

    const hidden = await admin.get('/api/v1/admin/places?status=unpublished');
    expect(hidden.body.data.map((place) => place.name)).toEqual(['ร้านที่ซ่อนอยู่']);
    const shown = await admin.get('/api/v1/admin/places?status=published');
    expect(shown.body.data.map((place) => place.name)).toEqual(['ร้านเผยแพร่']);
    const byName = await admin.get(`/api/v1/admin/places?q=${encodeURIComponent('ซ่อน')}`);
    expect(byName.body.data.map((place) => place.name)).toEqual(['ร้านที่ซ่อนอยู่']);
    // "%" is text, not a wildcard.
    expect((await admin.get('/api/v1/admin/places?q=%25')).body.data).toEqual([]);

    const filteredPage = await admin.get('/admin/places?status=unpublished');
    expect(filteredPage.text).toContain('ร้านที่ซ่อนอยู่');
    expect(filteredPage.text).not.toContain('ร้านเผยแพร่');
  });

  test('filters places that still lack a pin, opening hours or a photo', async () => {
    const complete = await makePlace({ name: 'ครบ', latitude: 13.73, longitude: 100.77, imagePath: '/images/a.webp' });
    await prisma.placeHours.create({ data: { placeId: complete.id, weekday: 1, state: 'closed' } });
    const unknownWeek = await makePlace({ name: 'ไม่รู้เวลา', latitude: 13.73, longitude: 100.77, imagePath: '/images/b.webp' });
    await prisma.placeHours.create({ data: { placeId: unknownWeek.id, weekday: 2, state: 'unknown' } });
    await makePlace({ name: 'ไม่มีอะไรเลย' });

    const names = async (query) => (await admin.get(`/api/v1/admin/places?${query}`)).body.data.map((p) => p.name).sort();
    expect(await names('missing=pin')).toEqual(['ไม่มีอะไรเลย']);
    expect(await names('missing=hours')).toEqual(['ไม่มีอะไรเลย', 'ไม่รู้เวลา'].sort());
    expect(await names('missing=photo')).toEqual(['ไม่มีอะไรเลย']);
    expect(await names('missing=bogus')).toHaveLength(3);
    expect(await names(`missing=hours&q=${encodeURIComponent('เวลา')}`)).toEqual(['ไม่รู้เวลา']);
    expect((await admin.get('/api/v1/admin/places')).body.data.find((p) => p.name === 'ครบ').hasPhoto).toBe(true);

    const page = await admin.get('/admin/places?missing=pin');
    expect(page.status).toBe(200);
    expect(page.text).toContain('ไม่มีอะไรเลย');
    expect(page.text).not.toContain('ไม่รู้เวลา');
    expect(page.text).toContain('<option value="pin" selected');
    expect((await admin.get('/admin/places')).text).toContain(`href="/admin/places/${complete.id}/reviews"`);
  });

  test('the public place page shows a manage button to admins only', async () => {
    const place = await makePlace({ name: 'ร้านสาธารณะ' });
    const link = `href="/admin/places/${place.id}/edit"`;
    expect((await admin.get(`/places/${place.id}`)).text).toContain(link);
    expect((await alice.get(`/places/${place.id}`)).text).not.toContain(link);
    expect((await createClient(app).get(`/places/${place.id}`)).text).not.toContain(link);
  });

  test('reports pin, known hours, rating and featured order; paginates by 20', async () => {
    const pinned = await makePlace({ name: 'มีหมุด', latitude: 13.73, longitude: 100.77, featuredOrder: 3 });
    await prisma.placeHours.create({ data: { placeId: pinned.id, weekday: 1, state: 'closed' } });
    await makePlace({ name: 'ไม่มีหมุด' });
    const rows = (await admin.get('/api/v1/admin/places')).body.data;
    const withPin = rows.find((row) => row.name === 'มีหมุด');
    const without = rows.find((row) => row.name === 'ไม่มีหมุด');
    expect(withPin).toMatchObject({ hasPin: true, hasHours: true, featuredOrder: 3, status: 'published' });
    expect(without).toMatchObject({ hasPin: false, hasHours: false, featuredOrder: null, ratingAvg: null });

    for (let i = 0; i < 20; i += 1) await makePlace({ name: `ร้านที่ ${String(i).padStart(2, '0')}` });
    const first = await admin.get('/api/v1/admin/places');
    expect(first.body.data).toHaveLength(20);
    expect(first.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 22 });
    expect((await admin.get('/api/v1/admin/places?page=2')).body.data).toHaveLength(2);
    expect((await admin.get('/admin/places?page=abc')).status).toBe(200);
  });
});

// ---------- 3. adding a place ----------

describe('adding a place', () => {
  test('page form with a photo: 303 to the edit page, one published place, seven hours rows, createdById set', async () => {
    const before = listUploads();
    const res = await formMultipart(admin, '/admin/places', validFields({ state1: 'open', opens1: '09:00', closes1: '17:30', state5: 'open', opens5: '18:00', closes5: '02:00', next5: 'on' }), photo());
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/admin/places/${(await prisma.place.findFirst()).id}/edit`);

    const places = await prisma.place.findMany({ include: { hours: { orderBy: { weekday: 'asc' } } } });
    expect(places).toHaveLength(1);
    const place = places[0];
    expect(place).toMatchObject({ name: 'ร้านกาแฟของผู้ดูแล', status: 'published', createdById: admin.id, categoryId: category.id });
    expect(place.imagePath).toMatch(UUID_PATH);
    expect(place.hours).toHaveLength(7);
    expect(place.hours[1]).toMatchObject({ state: 'open', closesNextDay: false });
    expect(place.hours[5]).toMatchObject({ state: 'open', closesNextDay: true });
    expect(place.hours[0]).toMatchObject({ state: 'closed', opensAt: null });
    expect(listUploads()).toEqual([...before, path.basename(place.imagePath)].sort());

    const list = await admin.get(res.headers.location);
    expect(list.text).toContain('data-flash');
    expect(list.text).toContain('&#34;ร้านกาแฟของผู้ดูแล&#34; แล้ว');
    expect((await request(app).get(`/places/${place.id}`)).status).toBe(200);
  });

  test('API JSON: 201 with the full detail, pin optional', async () => {
    const res = await admin.post('/api/v1/admin/places', validJson({ latitude: undefined, longitude: undefined, featuredOrder: 2 }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'ร้านกาแฟของผู้ดูแล', status: 'published', featuredOrder: 2, latitude: null, longitude: null, createdById: admin.id });
    expect(res.body.data.hours).toHaveLength(7);
    expect(await prisma.placeHours.count({ where: { placeId: res.body.data.id } })).toBe(7);

    const withPin = await admin.post('/api/v1/admin/places', validJson({ name: 'มีหมุด' }));
    expect(withPin.status).toBe(201);
    expect(withPin.body.data).toMatchObject({ latitude: 13.7279, longitude: 100.7782 });
    expect(await prisma.place.count()).toBe(2);
  });

  test('API multipart with a photo works', async () => {
    const fields = validFields();
    delete fields.featuredOrder;
    const res = await apiMultipart(admin, 'post', '/api/v1/admin/places', fields, photo());
    expect(res.status).toBe(201);
    expect(res.body.data.imagePath).toMatch(UUID_PATH);
    expect(uploadExists(res.body.data.imagePath)).toBe(true);
  });

  test('invalid hours: 400, nothing created, no photo file left; the page keeps what was typed', async () => {
    const before = listUploads();
    const badHours = validFields({ name: 'พิมพ์ไว้แล้ว', state2: 'open', opens2: '10:00', closes2: '' });
    const page = await formMultipart(admin, '/admin/places', badHours, photo());
    expect(page.status).toBe(400);
    expect(page.text).toContain('พิมพ์ไว้แล้ว');
    expect(page.text).toContain('วันที่เปิดต้องระบุเวลาเปิดและเวลาปิด');

    const api = await apiMultipart(admin, 'post', '/api/v1/admin/places', badHours, photo());
    expect(api.status).toBe(400);
    expect(api.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.place.count()).toBe(0);
    expect(await prisma.placeHours.count()).toBe(0);
    expect(listUploads()).toEqual(before);
  });

  test('an unknown category is refused and leaves no file behind', async () => {
    const before = listUploads();
    const res = await apiMultipart(admin, 'post', '/api/v1/admin/places', validFields({ categoryId: '99999' }), photo());
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toContain('categoryId');
    expect(await prisma.place.count()).toBe(0);
    expect(listUploads()).toEqual(before);
  });

  test('a half pin or a pin outside Lat Krabang is refused; a blank pin is fine', async () => {
    const halfLat = await admin.post('/api/v1/admin/places', validJson({ longitude: undefined }));
    expect(halfLat.status).toBe(400);
    expect(fieldsOf(halfLat)).toContain('longitude');
    const halfLng = await admin.post('/api/v1/admin/places', validJson({ latitude: undefined }));
    expect(halfLng.status).toBe(400);
    expect(fieldsOf(halfLng)).toContain('latitude');
    const far = await admin.post('/api/v1/admin/places', validJson({ latitude: 18.79, longitude: 98.98 }));
    expect(far.status).toBe(400);
    expect(fieldsOf(far)).toEqual(expect.arrayContaining(['latitude', 'longitude']));
    const text = await admin.post('/api/v1/admin/places', validJson({ latitude: 'abc', longitude: 'xyz' }));
    expect(text.status).toBe(400);
    expect(await prisma.place.count()).toBe(0);

    const blank = await formMultipart(admin, '/admin/places', validFields({ latitude: '', longitude: '' }));
    expect(blank.status).toBe(303);
    expect(await prisma.place.count()).toBe(1);
  });

  test('requires a CSRF token, also for multipart forms', async () => {
    const uploadsBefore = listUploads();
    const noToken = await admin.agent.post('/admin/places').type('form').send(validFields());
    expect(noToken.status).toBe(403);

    let req = withFields(admin.agent.post('/admin/places'), validFields());
    req = req.attach('photo', photoBuffer, { filename: 'p.jpg', contentType: 'image/jpeg' });
    expect((await req).status).toBe(403);

    await admin.csrfToken();
    const apiNoToken = await admin.agent.post('/api/v1/admin/places').send(validJson());
    expect(apiNoToken.status).toBe(403);
    const apiMultipartNoToken = await withFields(admin.agent.post('/api/v1/admin/places'), validFields()).attach('photo', photoBuffer, { filename: 'p.jpg', contentType: 'image/jpeg' });
    expect(apiMultipartNoToken.status).toBe(403);
    const patchNoToken = await admin.agent.patch('/api/v1/admin/places/1').send({ status: 'unpublished' });
    expect(patchNoToken.status).toBe(403);
    const statusNoToken = await admin.agent.post('/admin/places/1/status').type('form').send({ status: 'unpublished' });
    expect(statusNoToken.status).toBe(403);
    expect(await prisma.place.count()).toBe(0);
    expect(listUploads()).toEqual(uploadsBefore);
  });

  test('the new form renders with the map picker and seven days of hours', async () => {
    const res = await admin.get('/admin/places/new');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-map-picker');
    expect(res.text).toContain('name="state6"');
    expect(res.text).toContain('name="featuredOrder"');
    expect(res.text).toContain('คาเฟ่');
  });
});

// ---------- 4. editing ----------

describe('editing a place', () => {
  async function seeded() {
    const place = await makePlace({ name: 'ร้านเดิม', latitude: 13.73, longitude: 100.77, phone: '02-000-0000', featuredOrder: 5 });
    await prisma.placeHours.createMany({
      data: Array.from({ length: 7 }, (unused, weekday) => ({ placeId: place.id, weekday, state: weekday === 1 ? 'open' : 'unknown', opensAt: weekday === 1 ? new Date('1970-01-01T08:00:00Z') : null, closesAt: weekday === 1 ? new Date('1970-01-01T20:00:00Z') : null })),
    });
    return place;
  }

  test('the edit form shows the stored values; the API detail has status, featuredOrder and hours', async () => {
    const place = await seeded();
    const page = await admin.get(`/admin/places/${place.id}/edit`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('ร้านเดิม');
    expect(page.text).toContain('value="08:00"');
    expect(page.text).toContain('value="5"');

    const api = await admin.get(`/api/v1/admin/places/${place.id}`);
    expect(api.status).toBe(200);
    expect(api.body.data).toMatchObject({ id: place.id, status: 'published', featuredOrder: 5, latitude: 13.73, categoryId: category.id });
    expect(api.body.data.hours).toHaveLength(7);
    expect(api.body.data.hours[1]).toEqual({ weekday: 1, state: 'open', opensAt: '08:00', closesAt: '20:00', closesNextDay: false });
  });

  test('PATCH replaces content and all seven hours; still exactly seven rows', async () => {
    const place = await seeded();
    const hours = closedWeek();
    hours[3] = { weekday: 3, state: 'open', opensAt: '10:00', closesAt: '22:00', closesNextDay: false };
    const res = await admin.patch(`/api/v1/admin/places/${place.id}`, validJson({ name: 'ชื่อใหม่', categoryId: otherCategory.id, phone: null, hours, featuredOrder: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name: 'ชื่อใหม่', categoryId: otherCategory.id, phone: null, featuredOrder: 1, status: 'published', createdById: null });
    expect(res.body.data.hours[3]).toMatchObject({ state: 'open', opensAt: '10:00', closesAt: '22:00' });
    expect(res.body.data.hours[1]).toMatchObject({ state: 'closed', opensAt: null });

    const rows = await prisma.placeHours.findMany({ where: { placeId: place.id }, orderBy: { weekday: 'asc' } });
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.state)).toEqual(['closed', 'closed', 'closed', 'open', 'closed', 'closed', 'closed']);
  });

  test('invalid hours leave the old place and hours untouched (one transaction)', async () => {
    const place = await seeded();
    const hours = closedWeek();
    hours[2] = { weekday: 2, state: 'open', opensAt: '20:00', closesAt: '10:00', closesNextDay: false };
    const res = await admin.patch(`/api/v1/admin/places/${place.id}`, validJson({ name: 'ไม่ควรบันทึก', hours }));
    expect(res.status).toBe(400);
    const after = await prisma.place.findUnique({ where: { id: place.id }, include: { hours: true } });
    expect(after.name).toBe('ร้านเดิม');
    expect(after.hours).toHaveLength(7);
    expect(after.hours.find((row) => row.weekday === 1).state).toBe('open');
  });

  test('page form: saves, redirects 303, and shows errors with typed values', async () => {
    const place = await seeded();
    const ok = await formMultipart(admin, `/admin/places/${place.id}`, validFields({ name: 'แก้ผ่านฟอร์ม', featuredOrder: '7', status: 'unpublished' }));
    expect(ok.status).toBe(303);
    expect(ok.headers.location).toBe(`/admin/places/${place.id}/edit`);
    expect(await prisma.place.findUnique({ where: { id: place.id } })).toMatchObject({ name: 'แก้ผ่านฟอร์ม', featuredOrder: 7, status: 'unpublished' });

    const bad = await formMultipart(admin, `/admin/places/${place.id}`, validFields({ name: '', description: 'พิมพ์ค้างไว้' }));
    expect(bad.status).toBe(400);
    expect(bad.text).toContain('กรุณากรอกชื่อสถานที่');
    expect(bad.text).toContain('พิมพ์ค้างไว้');
    expect((await prisma.place.findUnique({ where: { id: place.id } })).name).toBe('แก้ผ่านฟอร์ม');
  });

  test('featured order: set, clear with empty, and 0, -1, 1.5, 1000, text refused', async () => {
    const place = await seeded();
    const url = `/api/v1/admin/places/${place.id}`;
    for (const bad of [0, -1, 1.5, 1000, '1e2', 'abc', '0']) {
      const res = await admin.patch(url, { featuredOrder: bad });
      expect(res.status).toBe(400);
      expect(fieldsOf(res)).toEqual(['featuredOrder']);
    }
    expect((await prisma.place.findUnique({ where: { id: place.id } })).featuredOrder).toBe(5);

    expect((await admin.patch(url, { featuredOrder: 999 })).body.data.featuredOrder).toBe(999);
    expect((await admin.patch(url, { featuredOrder: '12' })).body.data.featuredOrder).toBe(12);
    expect((await admin.patch(url, { featuredOrder: '' })).body.data.featuredOrder).toBeNull();
    expect((await prisma.place.findUnique({ where: { id: place.id } })).featuredOrder).toBeNull();

    const form = await formMultipart(admin, `/admin/places/${place.id}`, validFields({ featuredOrder: '1000' }));
    expect(form.status).toBe(400);
    expect(form.text).toContain('ลำดับแนะนำต้องเป็นจำนวนเต็ม');
  });

  test('ratings are not editable here', async () => {
    const place = await makePlace();
    const user = await prisma.user.findFirst({ where: { email: 'alice@example.com' } });
    await prisma.review.create({ data: { userId: user.id, placeId: place.id, rating: 4 } });
    await prisma.place.update({ where: { id: place.id }, data: { ratingAvg: 4, ratingCount: 1 } });
    await admin.patch(`/api/v1/admin/places/${place.id}`, validJson({ ratingAvg: 1, ratingCount: 50 }));
    expect(await prisma.place.findUnique({ where: { id: place.id } })).toMatchObject({ ratingCount: 1 });
    expect(Number((await prisma.place.findUnique({ where: { id: place.id } })).ratingAvg)).toBe(4);
  });

  test('a status-only PATCH changes nothing else; an empty PATCH is refused', async () => {
    const place = await seeded();
    const res = await admin.patch(`/api/v1/admin/places/${place.id}`, { status: 'unpublished' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'unpublished', name: 'ร้านเดิม', featuredOrder: 5 });
    expect(await prisma.placeHours.count({ where: { placeId: place.id, state: 'open' } })).toBe(1);
    expect((await admin.patch(`/api/v1/admin/places/${place.id}`, {})).status).toBe(400);
    expect((await admin.patch(`/api/v1/admin/places/${place.id}`, { status: 'deleted' })).status).toBe(400);
  });

  test('unknown or odd ids answer 404', async () => {
    const body = validJson();
    for (const id of ['99999', '0', '01', '-1', '1.5', 'abc', '99999999999']) {
      expect((await admin.get(`/admin/places/${id}/edit`)).status).toBe(404);
      expect((await admin.get(`/api/v1/admin/places/${id}`)).status).toBe(404);
      expect((await admin.patch(`/api/v1/admin/places/${id}`, body)).status).toBe(404);
      // A multipart post to a non-numeric path is not a photo route, so CSRF refuses it first.
      if (/^d+$/.test(id)) expect((await formMultipart(admin, `/admin/places/${id}`, validFields())).status).toBe(404);
      else expect((await admin.postForm(`/admin/places/${id}`, validFields())).status).toBe(404);
      expect((await admin.postForm(`/admin/places/${id}/status`, { status: 'unpublished' })).status).toBe(404);
    }
    expect(await prisma.place.count()).toBe(0);
  });
});

// ---------- 5. photo replacement ----------

describe('replacing a photo', () => {
  async function placeWithUpload() {
    const created = await apiMultipart(admin, 'post', '/api/v1/admin/places', validFields(), photo());
    expect(created.status).toBe(201);
    return created.body.data;
  }

  test('the old upload is deleted after the new one is saved', async () => {
    const place = await placeWithUpload();
    const oldPath = place.imagePath;
    expect(uploadExists(oldPath)).toBe(true);

    const res = await formMultipart(admin, `/admin/places/${place.id}`, validFields(), photo());
    expect(res.status).toBe(303);
    const after = await prisma.place.findUnique({ where: { id: place.id } });
    expect(after.imagePath).toMatch(UUID_PATH);
    expect(after.imagePath).not.toBe(oldPath);
    expect(uploadExists(after.imagePath)).toBe(true);
    expect(uploadExists(oldPath)).toBe(false);
  });

  test('saving without a new photo keeps the current one', async () => {
    const place = await placeWithUpload();
    const res = await formMultipart(admin, `/admin/places/${place.id}`, validFields({ name: 'เปลี่ยนแค่ชื่อ' }));
    expect(res.status).toBe(303);
    expect((await prisma.place.findUnique({ where: { id: place.id } })).imagePath).toBe(place.imagePath);
    expect(uploadExists(place.imagePath)).toBe(true);
  });

  test('a seed illustration under /images/places is never deleted from disk', async () => {
    const illustration = '/images/places/cafe.svg';
    const seedFile = path.join(__dirname, '..', 'public', 'images', 'places', 'cafe.svg');
    const place = await makePlace({ imagePath: illustration });
    const res = await apiMultipart(admin, 'patch', `/api/v1/admin/places/${place.id}`, validFields(), photo());
    expect(res.status).toBe(200);
    expect(res.body.data.imagePath).toMatch(UUID_PATH);
    expect(fs.existsSync(seedFile)).toBe(true);
  });

  test('a file an approved submission still uses is kept', async () => {
    const place = await placeWithUpload();
    const shared = place.imagePath;
    const submission = await prisma.submission.create({
      data: { userId: admin.id, categoryId: category.id, name: place.name, description: 'x', address: 'y', imagePath: shared, hours: closedWeek(), status: 'approved', placeId: place.id },
    });
    const res = await formMultipart(admin, `/admin/places/${place.id}`, validFields(), photo());
    expect(res.status).toBe(303);
    expect((await prisma.place.findUnique({ where: { id: place.id } })).imagePath).not.toBe(shared);
    expect(uploadExists(shared)).toBe(true);
    expect((await prisma.submission.findUnique({ where: { id: submission.id } })).imagePath).toBe(shared);
  });

  test('a refused photo or invalid form keeps the old file and adds none', async () => {
    const place = await placeWithUpload();
    const before = listUploads();
    const notImage = await apiMultipart(admin, 'patch', `/api/v1/admin/places/${place.id}`, validFields(), { buffer: Buffer.from('not an image'), filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(notImage.status).toBe(415);
    const invalid = await formMultipart(admin, `/admin/places/${place.id}`, validFields({ name: '' }), photo());
    expect(invalid.status).toBe(400);
    expect(listUploads()).toEqual(before);
    expect((await prisma.place.findUnique({ where: { id: place.id } })).imagePath).toBe(place.imagePath);
  });
});

// ---------- 6. publishing ----------

describe('unpublishing and publishing', () => {
  test('an unpublished place disappears from every public page and API; publishing brings it back with its rating', async () => {
    const place = await makePlace({ name: 'ร้านลึกลับสุดๆ', latitude: 13.73, longitude: 100.77, featuredOrder: 1 });
    const user = await prisma.user.findFirst({ where: { email: 'alice@example.com' } });
    await prisma.review.create({ data: { userId: user.id, placeId: place.id, rating: 5, comment: 'ดีมากจริงๆ' } });
    await prisma.place.update({ where: { id: place.id }, data: { ratingAvg: 5, ratingCount: 1 } });

    const visitor = request(app);
    const visible = async () => ({
      list: (await visitor.get('/places')).text.includes('ร้านลึกลับสุดๆ'),
      apiList: JSON.stringify((await visitor.get('/api/v1/places')).body).includes('ร้านลึกลับสุดๆ'),
      detail: (await visitor.get(`/places/${place.id}`)).status,
      apiDetail: (await visitor.get(`/api/v1/places/${place.id}`)).status,
      reviews: (await visitor.get(`/api/v1/places/${place.id}/reviews`)).status,
      map: (await visitor.get('/map')).text.includes('ร้านลึกลับสุดๆ'),
      apiMap: JSON.stringify((await visitor.get('/api/v1/places/map')).body).includes('ร้านลึกลับสุดๆ'),
      home: (await visitor.get('/')).text.includes('ร้านลึกลับสุดๆ'),
      recommendations: JSON.stringify((await visitor.get('/api/v1/recommendations')).body).includes('ร้านลึกลับสุดๆ'),
    });

    const before = await visible();
    expect(before).toMatchObject({ list: true, apiList: true, detail: 200, apiDetail: 200, map: true, apiMap: true, home: true, recommendations: true });

    const hide = await admin.postForm(`/admin/places/${place.id}/status`, { status: 'unpublished' });
    expect(hide.status).toBe(303);
    expect(hide.headers.location).toBe('/admin/places');
    expect(await visible()).toEqual({ list: false, apiList: false, detail: 404, apiDetail: 404, reviews: 404, map: false, apiMap: false, home: false, recommendations: false });
    // The admin still sees it.
    expect(JSON.stringify((await admin.get('/api/v1/admin/places')).body)).toContain('ร้านลึกลับสุดๆ');

    const show = await admin.postForm(`/admin/places/${place.id}/status`, { status: 'published' });
    expect(show.status).toBe(303);
    expect(await visible()).toMatchObject(before);
    const detail = await visitor.get(`/api/v1/places/${place.id}`);
    expect(detail.body.data).toMatchObject({ ratingAvg: 5, ratingCount: 1 });
    expect((await visitor.get(`/api/v1/places/${place.id}/reviews`)).body.data).toHaveLength(1);
    expect(await prisma.review.count({ where: { placeId: place.id } })).toBe(1);
  });

  test('the same through PATCH, and a bad status is refused', async () => {
    const place = await makePlace();
    expect((await admin.patch(`/api/v1/admin/places/${place.id}`, { status: 'unpublished' })).status).toBe(200);
    expect((await request(app).get(`/places/${place.id}`)).status).toBe(404);
    expect((await admin.patch(`/api/v1/admin/places/${place.id}`, { status: 'published' })).status).toBe(200);
    expect((await request(app).get(`/places/${place.id}`)).status).toBe(200);

    const bad = await admin.postForm(`/admin/places/${place.id}/status`, { status: 'bogus' });
    expect(bad.status).toBe(303);
    expect((await prisma.place.findUnique({ where: { id: place.id } })).status).toBe('published');
  });
});
