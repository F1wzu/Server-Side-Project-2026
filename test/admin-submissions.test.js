// Step 6: the admin's submission queue: approve, return, reject.
const request = require('supertest');
const { createApp } = require('../src/app');
const adminSubmissionModel = require('../src/models/adminSubmission');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let category;
let member;
let admin;

const hours = Array.from({ length: 7 }, (unused, weekday) =>
  weekday === 5
    ? { weekday, state: 'open', opensAt: '18:00', closesAt: '02:00', closesNextDay: true }
    : weekday === 0
      ? { weekday, state: 'closed' }
      : { weekday, state: 'unknown' }
);
const content = (overrides = {}) => ({
  name: 'ร้านกาแฟหลังสถาบัน',
  categoryId: category.id,
  description: 'ร้านเล็ก ๆ บรรยากาศดี',
  address: 'ซอยฉลองกรุง 1',
  latitude: 13.7271,
  longitude: 100.7784,
  phone: '02-123-4567',
  websiteUrl: 'https://example.com/cafe',
  hours,
  ...overrides,
});

// A pending submission from the member, through the real endpoint.
async function submit(overrides) {
  const res = await member.post('/api/v1/submissions', content(overrides));
  expect(res.status).toBe(201);
  return res.body.data;
}
const row = (id) => prisma.submission.findUnique({ where: { id } });
const approvePath = (id) => `/api/v1/admin/submissions/${id}/approve`;

beforeEach(async () => {
  await resetDatabase();
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  member = createClient(app);
  await member.register();
  admin = createClient(app);
  await admin.registerAdmin();
});
afterAll(closeDatabase);

describe('who may use the queue', () => {
  test('a visitor is sent to login (page) or gets 401 (API)', async () => {
    const page = await request(app).get('/admin/submissions');
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe('/login?next=%2Fadmin%2Fsubmissions');
    expect((await request(app).get('/api/v1/admin/submissions')).status).toBe(401);
  });

  test('a member gets 403 everywhere, and cannot decide on their own submission', async () => {
    const submission = await submit();
    expect((await member.get('/admin/submissions')).status).toBe(403);
    expect((await member.get(`/admin/submissions/${submission.id}`)).status).toBe(403);
    expect((await member.get('/api/v1/admin/submissions')).status).toBe(403);
    expect((await member.post(approvePath(submission.id), { version: 1 })).status).toBe(403);
    expect((await member.postForm(`/admin/submissions/${submission.id}/approve`, { version: '1' })).status).toBe(403);
    expect((await row(submission.id)).status).toBe('pending');
    expect(await prisma.place.count()).toBe(0);
  });

  test('a decision needs a CSRF token', async () => {
    const submission = await submit();
    expect((await admin.agent.post(approvePath(submission.id)).send({ version: 1 })).status).toBe(403);
    expect(await prisma.place.count()).toBe(0);
  });
});

describe('the queue', () => {
  test('shows pending submissions oldest first, and filters by status', async () => {
    const first = await submit({ name: 'ที่หนึ่ง' });
    const second = await submit({ name: 'ที่สอง' });
    await prisma.submission.update({ where: { id: first.id }, data: { updatedAt: new Date(Date.now() - 60000) } });

    const res = await admin.get('/api/v1/admin/submissions');
    expect(res.body.data.map((item) => item.name)).toEqual(['ที่หนึ่ง', 'ที่สอง']);
    expect(res.body.data[0].user).toEqual({ id: expect.any(Number), username: 'สมชาย' });
    expect(res.body.meta.total).toBe(2);

    await admin.post(`/api/v1/admin/submissions/${second.id}/reject`, { version: 1, reason: 'ซ้ำ' });
    expect((await admin.get('/api/v1/admin/submissions?status=rejected')).body.data.map((item) => item.name)).toEqual(['ที่สอง']);
    expect((await admin.get('/api/v1/admin/submissions?status=all')).body.meta.total).toBe(2);
    expect((await admin.get('/api/v1/admin/submissions?status=nonsense')).body.meta.total).toBe(1); // falls back to pending

    const page = await admin.get('/admin/submissions');
    expect(page.status).toBe(200);
    expect(page.text).toContain('ที่หนึ่ง');
    expect(page.text).not.toContain('ที่สอง');
  });

  test('the detail shows the author, the history and possible duplicates', async () => {
    await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านกาแฟหลังสถาบัน', description: 'x', address: 'x' } });
    await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านข้าง ๆ', description: 'x', address: 'x', latitude: 13.7272, longitude: 100.7785 } });
    await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านไกล', description: 'x', address: 'x', latitude: 13.75, longitude: 100.8 } });
    const submission = await submit();

    const res = await admin.get(`/api/v1/admin/submissions/${submission.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('somchai@example.com');
    expect(res.body.data.events.map((event) => event.action)).toEqual(['submitted']);
    expect(res.body.data.possibleDuplicates.map((place) => place.name).sort()).toEqual(['ร้านกาแฟหลังสถาบัน', 'ร้านข้าง ๆ']);

    const page = await admin.get(`/admin/submissions/${submission.id}`);
    expect(page.text).toContain('อาจมีสถานที่นี้อยู่แล้ว');
    expect(page.text).toContain('data-map-picker');
    expect(page.text).toContain(`action="/admin/submissions/${submission.id}/approve"`);
  });

  test('an unknown or odd id is 404', async () => {
    for (const id of ['999999', 'abc', '01', '1e3']) {
      expect((await admin.get(`/api/v1/admin/submissions/${id}`)).status).toBe(404);
      expect((await admin.get(`/admin/submissions/${id}`)).status).toBe(404);
    }
  });
});

describe('approve', () => {
  test('creates exactly one published place with seven hours rows, and links it', async () => {
    const submission = await submit();
    const res = await admin.post(approvePath(submission.id), { version: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.submission).toMatchObject({ status: 'approved', version: 2, placeId: res.body.data.placeId });

    const places = await prisma.place.findMany({ include: { hours: { orderBy: { weekday: 'asc' } } } });
    expect(places).toHaveLength(1);
    const [place] = places;
    expect(place).toMatchObject({
      name: 'ร้านกาแฟหลังสถาบัน',
      status: 'published',
      categoryId: category.id,
      phone: '02-123-4567',
      websiteUrl: 'https://example.com/cafe',
      createdById: admin.id,
      ratingCount: 0,
    });
    expect(Number(place.latitude)).toBe(13.7271);
    expect(place.hours).toHaveLength(7);
    expect(place.hours[0].state).toBe('closed');
    expect(place.hours[5]).toMatchObject({ state: 'open', closesNextDay: true });
    expect(place.hours[5].opensAt.toISOString()).toContain('T18:00');
    expect(place.hours[1].state).toBe('unknown');

    const events = await prisma.submissionEvent.findMany({ where: { submissionId: submission.id }, orderBy: { id: 'asc' } });
    expect(events.map((event) => [event.action, event.actorId, event.note])).toEqual([
      ['submitted', expect.any(Number), null],
      ['approved', admin.id, null],
    ]);
  });

  test('the new place is public, and the member sees the link', async () => {
    const submission = await submit();
    expect((await request(app).get('/api/v1/places')).body.meta.total).toBe(0);
    const { body } = await admin.post(approvePath(submission.id), { version: 1 });

    expect((await request(app).get(`/places/${body.data.placeId}`)).status).toBe(200);
    expect((await request(app).get('/api/v1/places?q=กาแฟ')).body.data.map((place) => place.name)).toEqual(['ร้านกาแฟหลังสถาบัน']);
    const mine = await member.get(`/me/submissions/${submission.id}`);
    expect(mine.text).toContain('เผยแพร่สถานที่แล้ว');
    expect(mine.text).toContain(`/places/${body.data.placeId}`);
  });

  test('a moved pin is used for the place and recorded in the history', async () => {
    const submission = await submit();
    const res = await admin.post(approvePath(submission.id), { version: 1, latitude: 13.7301, longitude: 100.7812 });
    expect(res.status).toBe(201);

    const place = await prisma.place.findUnique({ where: { id: res.body.data.placeId } });
    expect([Number(place.latitude), Number(place.longitude)]).toEqual([13.7301, 100.7812]);
    const event = await prisma.submissionEvent.findFirst({ where: { submissionId: submission.id, action: 'approved' } });
    expect(event.note).toBe('ผู้ดูแลปรับตำแหน่งหมุดจาก 13.7271, 100.7784 เป็น 13.7301, 100.7812');
    expect(event.snapshot).toMatchObject({ latitude: 13.7301, longitude: 100.7812 });
    // The member reads about it on their submission page.
    expect((await member.get(`/me/submissions/${submission.id}`)).text).toContain('ผู้ดูแลปรับตำแหน่งหมุด');
  });

  test('sending the same pin back is not recorded as a move', async () => {
    const submission = await submit();
    await admin.post(approvePath(submission.id), { version: 1, latitude: '13.7271', longitude: '100.7784' });
    const event = await prisma.submissionEvent.findFirst({ where: { submissionId: submission.id, action: 'approved' } });
    expect(event.note).toBeNull();
  });

  test.each([
    ['outside the district', { latitude: 13.9, longitude: 100.9 }],
    ['only half a pin', { latitude: 13.73 }],
    ['not a number', { latitude: 'abc', longitude: '100.78' }],
  ])('a corrected pin that is %s is refused and nothing is published', async (label, pin) => {
    const submission = await submit();
    const res = await admin.post(approvePath(submission.id), { version: 1, ...pin });
    expect(res.status).toBe(400);
    expect(await prisma.place.count()).toBe(0);
    expect((await row(submission.id)).status).toBe('pending');
  });

  test('two approvals at the same moment publish one place; the other gets 409', async () => {
    const submission = await submit();
    const results = await Promise.all([
      adminSubmissionModel.approve(admin.id, submission.id, 1).then(() => 'ok', (err) => err.code),
      adminSubmissionModel.approve(admin.id, submission.id, 1).then(() => 'ok', (err) => err.code),
    ]);
    expect(results.sort()).toEqual(['INVALID_STATE', 'ok']);
    expect(await prisma.place.count()).toBe(1);
    expect(await prisma.placeHours.count()).toBe(7);
    expect(await prisma.submissionEvent.count({ where: { action: 'approved' } })).toBe(1);
  });

  test('approving again, or with a stale version, is refused with 409', async () => {
    const submission = await submit();
    expect((await admin.post(approvePath(submission.id), { version: 7 })).body.error.code).toBe('STALE_VERSION');
    expect(await prisma.place.count()).toBe(0);

    await admin.post(approvePath(submission.id), { version: 1 });
    const again = await admin.post(approvePath(submission.id), { version: 2 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
    expect(await prisma.place.count()).toBe(1);
  });

  test('if creating the place fails, the submission stays pending and nothing is left behind', async () => {
    const submission = await submit();
    // A link the database refuses makes the place insert fail inside the transaction.
    await prisma.$executeRaw`ALTER TABLE submissions DROP CONSTRAINT submissions_website_url_check`;
    try {
      await prisma.submission.update({ where: { id: submission.id }, data: { websiteUrl: 'not-a-link' } });
      const res = await admin.post(approvePath(submission.id), { version: 1 });
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toContain('places_website_url_check');
    } finally {
      await prisma.submission.update({ where: { id: submission.id }, data: { websiteUrl: null } });
      await prisma.$executeRaw`ALTER TABLE submissions ADD CONSTRAINT submissions_website_url_check CHECK (website_url ~* '^https?://[^[:space:]]+$')`;
    }
    expect(await row(submission.id)).toMatchObject({ status: 'pending', version: 1, placeId: null });
    expect(await prisma.place.count()).toBe(0);
    expect(await prisma.placeHours.count()).toBe(0);
    expect(await prisma.submissionEvent.count({ where: { submissionId: submission.id } })).toBe(1);
  });

  test('the form on the page approves and goes to the new place', async () => {
    const submission = await submit();
    const res = await admin.postForm(`/admin/submissions/${submission.id}/approve`, { version: '1', latitude: '13.7271', longitude: '100.7784' });
    expect(res.status).toBe(303);
    const place = await prisma.place.findFirst();
    expect(res.headers.location).toBe(`/places/${place.id}`);
    expect((await admin.get(res.headers.location)).text).toContain('อนุมัติแล้ว');
  });
});

describe('return and reject', () => {
  test.each([
    ['return', 'changes_requested', 'returned'],
    ['reject', 'rejected', 'rejected'],
  ])('%s needs a reason and records it', async (action, status, eventAction) => {
    const submission = await submit();
    const path = `/api/v1/admin/submissions/${submission.id}/${action}`;

    for (const reason of [undefined, '', '   ', '​​', 'x'.repeat(1001)]) {
      const res = await admin.post(path, { version: 1, reason });
      expect(res.status).toBe(400);
    }
    expect((await row(submission.id)).status).toBe('pending');

    const res = await admin.post(path, { version: 1, reason: '  ขอรูปหน้าร้านเพิ่ม  ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status, version: 2, reviewNote: 'ขอรูปหน้าร้านเพิ่ม' });
    const event = await prisma.submissionEvent.findFirst({ where: { submissionId: submission.id, action: eventAction } });
    expect(event).toMatchObject({ actorId: admin.id, note: 'ขอรูปหน้าร้านเพิ่ม' });
    expect(await prisma.place.count()).toBe(0);
  });

  test('a returned submission can be fixed, resubmitted and then approved', async () => {
    const submission = await submit();
    await admin.post(`/api/v1/admin/submissions/${submission.id}/return`, { version: 1, reason: 'ที่อยู่ไม่ครบ' });

    const page = await member.get(`/me/submissions/${submission.id}`);
    expect(page.text).toContain('ที่อยู่ไม่ครบ');
    expect((await member.patch(`/api/v1/me/submissions/${submission.id}`, { ...content({ address: 'ซอยฉลองกรุง 1 แขวงลาดกระบัง' }), version: 2 })).status).toBe(200);
    expect((await member.post(`/api/v1/me/submissions/${submission.id}/resubmit`, { version: 3 })).status).toBe(200);

    // The admin's old page (version 1) is stale now.
    expect((await admin.post(approvePath(submission.id), { version: 1 })).body.error.code).toBe('STALE_VERSION');
    const res = await admin.post(approvePath(submission.id), { version: 4 });
    expect(res.status).toBe(201);
    expect((await prisma.place.findFirst()).address).toBe('ซอยฉลองกรุง 1 แขวงลาดกระบัง');

    const events = await prisma.submissionEvent.findMany({ where: { submissionId: submission.id }, orderBy: { id: 'asc' } });
    expect(events.map((event) => event.action)).toEqual(['submitted', 'returned', 'edited', 'resubmitted', 'approved']);
  });

  test('a rejected submission is closed: the member cannot edit or resubmit it, the admin cannot approve it', async () => {
    const submission = await submit();
    await admin.post(`/api/v1/admin/submissions/${submission.id}/reject`, { version: 1, reason: 'อยู่นอกเขต' });

    expect((await member.patch(`/api/v1/me/submissions/${submission.id}`, { ...content(), version: 2 })).status).toBe(409);
    expect((await member.post(`/api/v1/me/submissions/${submission.id}/resubmit`, { version: 2 })).status).toBe(409);
    expect((await admin.post(approvePath(submission.id), { version: 2 })).status).toBe(409);
    const page = await member.get(`/me/submissions/${submission.id}`);
    expect(page.text).toContain('เหตุผลที่ไม่อนุมัติ');
    expect(page.text).toContain('อยู่นอกเขต');
    expect(page.text).not.toContain('ส่งตรวจสอบอีกครั้ง');
  });

  test('a decision at the same moment as another: only one wins', async () => {
    const submission = await submit();
    const results = await Promise.all([
      adminSubmissionModel.approve(admin.id, submission.id, 1).then(() => 'approved', (err) => err.code),
      adminSubmissionModel.reject(admin.id, submission.id, 1, 'ซ้ำ').then(() => 'rejected', (err) => err.code),
    ]);
    expect(results.filter((result) => result === 'INVALID_STATE')).toHaveLength(1);
    const final = await row(submission.id);
    expect(await prisma.place.count()).toBe(final.status === 'approved' ? 1 : 0);
    expect(await prisma.submissionEvent.count({ where: { submissionId: submission.id } })).toBe(2);
  });

  test('the forms on the page work and show a message for a missing reason', async () => {
    const submission = await submit();
    const missing = await admin.postForm(`/admin/submissions/${submission.id}/return`, { version: '1', reason: '' });
    expect(missing.status).toBe(303);
    expect(missing.headers.location).toBe(`/admin/submissions/${submission.id}`);
    expect((await admin.get(missing.headers.location)).text).toContain('กรุณากรอกเหตุผล');

    const done = await admin.postForm(`/admin/submissions/${submission.id}/return`, { version: '1', reason: '<script>alert(1)</script>' });
    expect(done.headers.location).toBe('/admin/submissions');
    const detail = await admin.get(`/admin/submissions/${submission.id}`);
    expect(detail.text).not.toContain('<script>alert(1)</script>');
    expect(detail.text).toContain('&lt;script&gt;');
    expect(detail.text).not.toContain(`action="/admin/submissions/${submission.id}/approve"`); // no longer pending
  });
});

describe('admin dashboard', () => {
  test('counts what is waiting', async () => {
    await submit();
    await submit({ name: 'อีกที่' });
    const page = await admin.get('/admin');
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/คำขอรอตรวจสอบ <strong>2<\/strong>/);
    expect(page.text).toMatch(/แจ้งข้อมูลผิดที่ยังเปิดอยู่ <strong>0<\/strong>/);
  });
});
