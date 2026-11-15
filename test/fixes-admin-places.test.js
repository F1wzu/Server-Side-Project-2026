// Fixes in admin place management: post-commit read, row locking, upload
// errors on the page forms, long `back` links, hours on API content edits,
// page clamping and the photo column / labels.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const storage = require('../src/storage');
const adminPlaceModel = require('../src/models/adminPlace');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let category;
let admin;
let photoBuffer;
let bigBuffer;

const closedWeek = () => Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'closed' }));
const validFields = (overrides = {}) => {
  const fields = {
    name: 'ร้านทดสอบ',
    categoryId: String(category.id),
    description: 'รายละเอียดร้าน',
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
const attach = (req, buffer) => req.attach('photo', buffer, { filename: 'p.jpg', contentType: 'image/jpeg' });

const listUploads = () => (fs.existsSync(storage.UPLOAD_DIR) ? fs.readdirSync(storage.UPLOAD_DIR).sort() : []);
const makePlace = (overrides = {}) =>
  prisma.place.create({ data: { categoryId: category.id, name: 'ร้านเดิม', description: 'รายละเอียดเดิม', address: 'ลาดกระบัง', ...overrides } });
const apiPlace = (overrides = {}) =>
  admin.post('/api/v1/admin/places', { name: 'ร้านเวลา', categoryId: category.id, description: 'd', address: 'a', hours: closedWeek(), ...overrides });

beforeAll(async () => {
  photoBuffer = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3a7d5c' } }).jpeg().toBuffer();
  bigBuffer = Buffer.concat([photoBuffer, Buffer.alloc(5 * 1024 * 1024 + 10)]);
});

beforeEach(async () => {
  await resetDatabase();
  fs.rmSync(storage.UPLOAD_DIR, { recursive: true, force: true });
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  admin = createClient(app);
  await admin.registerAdmin();
});

afterAll(async () => {
  fs.rmSync(storage.UPLOAD_DIR, { recursive: true, force: true });
  await closeDatabase();
});

describe('model read-back', () => {
  test('create and update return the place read inside the transaction', async () => {
    const user = await prisma.user.findFirst();
    const content = { name: 'ร้านใหม่', categoryId: category.id, description: 'x', address: 'y', latitude: null, longitude: null, phone: null, websiteUrl: null, hours: closedWeek() };
    const created = await adminPlaceModel.create(user.id, content, null, {});
    expect(created.name).toBe('ร้านใหม่');
    expect(created.hours).toHaveLength(7);
    const { place } = await adminPlaceModel.update(created.id, { ...content, name: 'ชื่อใหม่' }, {}, null);
    expect(place.name).toBe('ชื่อใหม่');
    await expect(adminPlaceModel.update(999999, null, { status: 'published' }, null)).rejects.toMatchObject({ status: 404 });
  });
});

describe('concurrent edits with photos', () => {
  test('no unreferenced file is left and the old cover is removed', async () => {
    const created = await apiPlace({ name: 'ร้านรูป' });
    const id = created.body.data.id;
    const token = await admin.csrfToken();
    const edit = () => attach(withFields(admin.agent.patch(`/api/v1/admin/places/${id}`).set('X-CSRF-Token', token), { status: 'published' }), photoBuffer);

    const seed = await edit();
    expect(seed.status).toBe(200);
    const oldCover = seed.body.data.imagePath;

    const results = await Promise.all([edit(), edit()]);
    results.forEach((res) => expect(res.status).toBe(200));

    const place = await prisma.place.findUnique({ where: { id } });
    const files = listUploads();
    expect(files).toEqual([path.basename(place.imagePath)]);
    expect(files).not.toContain(path.basename(oldCover));
  });
});

describe('upload error on the page form', () => {
  test('oversized photo re-renders the form with typed values and a Thai error', async () => {
    const token = await admin.csrfToken();
    const res = await attach(withFields(admin.agent.post('/admin/places').field('_csrf', token), validFields({ name: 'ชื่อที่พิมพ์ไว้' })), bigBuffer);
    expect(res.status).toBe(413);
    expect(res.text).toContain('รูปต้องมีขนาดไม่เกิน 5 MB');
    expect(res.text).toContain('ชื่อที่พิมพ์ไว้');
    expect(await prisma.place.count()).toBe(0);
    expect(listUploads()).toEqual([]);
  });

  test('the edit form behaves the same and changes nothing', async () => {
    const place = await makePlace();
    const token = await admin.csrfToken();
    const res = await attach(withFields(admin.agent.post(`/admin/places/${place.id}`).field('_csrf', token), validFields({ name: 'แก้ไขแล้ว' })), bigBuffer);
    expect(res.status).toBe(413);
    expect(res.text).toContain('รูปต้องมีขนาดไม่เกิน 5 MB');
    expect(res.text).toContain('แก้ไขแล้ว');
    expect((await prisma.place.findUnique({ where: { id: place.id } })).name).toBe('ร้านเดิม');
    expect(listUploads()).toEqual([]);
  });

  test('the API still answers the upload error directly', async () => {
    const token = await admin.csrfToken();
    const res = await attach(withFields(admin.agent.post('/api/v1/admin/places').set('X-CSRF-Token', token), validFields()), bigBuffer);
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });
});

describe('status back link', () => {
  test('a long Thai search in back is accepted', async () => {
    const place = await makePlace();
    const back = `/admin/places?${new URLSearchParams({ q: 'ก'.repeat(150), status: 'all' }).toString()}`;
    expect(back.length).toBeGreaterThan(500);
    const res = await admin.postForm(`/admin/places/${place.id}/status`, { status: 'unpublished', back });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(back);
  });

  test('an unsafe back falls back to the list', async () => {
    const place = await makePlace();
    const res = await admin.postForm(`/admin/places/${place.id}/status`, { status: 'unpublished', back: '//evil.example' });
    expect(res.headers.location).toBe('/admin/places');
  });
});

describe('API PATCH hours', () => {
  test('content without hours is refused and hours stay', async () => {
    const id = (await apiPlace()).body.data.id;
    const res = await admin.patch(`/api/v1/admin/places/${id}`, { name: 'ชื่อใหม่' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([{ field: 'hours', message: 'กรุณาส่งเวลาเปิดปิดครบ 7 วัน (hours) เมื่อแก้ไขเนื้อหาสถานที่' }]);
    const hours = await prisma.placeHours.findMany({ where: { placeId: id } });
    expect(hours.every((day) => day.state === 'closed')).toBe(true);
  });

  test('hours that are not valid JSON are refused', async () => {
    const id = (await apiPlace()).body.data.id;
    const res = await admin.patch(`/api/v1/admin/places/${id}`, { name: 'ก', hours: 'not json' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('hours');
  });

  test('hours as a JSON string in multipart are accepted', async () => {
    const id = (await apiPlace()).body.data.id;
    const token = await admin.csrfToken();
    const hours = JSON.stringify(Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'unknown' })));
    const fields = { name: 'ชื่อใหม่', categoryId: String(category.id), description: 'd', address: 'a', hours };
    const res = await withFields(admin.agent.patch(`/api/v1/admin/places/${id}`).set('X-CSRF-Token', token), fields);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('ชื่อใหม่');
  });

  test('a publication-only PATCH needs no hours', async () => {
    const id = (await apiPlace()).body.data.id;
    const res = await admin.patch(`/api/v1/admin/places/${id}`, { status: 'unpublished' });
    expect(res.status).toBe(200);
  });
});

describe('list page', () => {
  test('a page past the end shows the last page with rows', async () => {
    await prisma.place.createMany({
      data: Array.from({ length: 21 }, (unused, i) => ({ categoryId: category.id, name: `สถานที่ ${String(i).padStart(2, '0')}`, description: 'd', address: 'a' })),
    });
    const far = await admin.get('/admin/places?page=9');
    expect(far.status).toBe(200);
    expect(far.text).toContain('สถานที่ 20');
    const api = await admin.get('/api/v1/admin/places?page=9');
    expect(api.body.data).toHaveLength(1);
    expect(api.body.meta.page).toBe(2);
  });

  test('shows the photo column and the photos link', async () => {
    const withPhoto = await makePlace({ name: 'มีรูป', imagePath: '/uploads/x.webp' });
    const without = await makePlace({ name: 'ไม่มีรูป' });
    const res = await admin.get('/admin/places');
    expect(res.text).toContain('<th scope="col">รูป</th>');
    expect(res.text).toContain('data-label="รูป"');
    expect(res.text).toContain(`href="/admin/places/${withPhoto.id}/photos" aria-label="รูปภาพของ มีรูป"`);
    expect(res.text).toContain(`href="/admin/places/${without.id}/photos"`);
  });
});

describe('photo labels', () => {
  test('start at 1 when there is no cover, 2 when there is', async () => {
    const place = await makePlace();
    await prisma.placePhoto.create({ data: { placeId: place.id, imagePath: '/uploads/a.webp', position: 0 } });
    let res = await admin.get(`/admin/places/${place.id}/photos`);
    expect(res.text).toContain('รูปที่ 1 ของ ร้านเดิม');
    expect(res.text).not.toContain('รูปที่ 2 ของ ร้านเดิม');
    await prisma.place.update({ where: { id: place.id }, data: { imagePath: '/uploads/cover.webp' } });
    res = await admin.get(`/admin/places/${place.id}/photos`);
    expect(res.text).toContain('รูปที่ 2 ของ ร้านเดิม');
  });
});
