// Step 4: "แจ้งข้อมูลผิด", members reporting wrong information about a place.
const path = require('node:path');
const ejs = require('ejs');
const { createApp } = require('../src/app');
const reportModel = require('../src/models/report');
const viewHelpers = require('../src/views/helpers');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let place;
let hidden;

beforeEach(async () => {
  // users and places are truncated with CASCADE, which also empties place_reports.
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  const base = { categoryId: category.id, description: 'รายละเอียด', address: 'ถนนฉลองกรุง' };
  place = await prisma.place.create({ data: { ...base, name: 'ร้านกาแฟริมคลอง' } });
  hidden = await prisma.place.create({ data: { ...base, name: 'ร้านที่ซ่อนอยู่', status: 'unpublished' } });
});
afterAll(closeDatabase);

const member = async (email = 'somchai@example.com') => {
  const client = createClient(app);
  await client.register({ email });
  return client;
};
const reportsPath = (id) => `/api/v1/places/${id}/reports`;

describe('API: POST /api/v1/places/:id/reports', () => {
  test('a member reports a place; the report is stored as open', async () => {
    const client = await member();
    const res = await client.post(reportsPath(place.id), { reason: 'closed', details: '  ปิดไปตั้งแต่เดือนที่แล้ว  ' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ placeId: place.id, reason: 'closed', details: 'ปิดไปตั้งแต่เดือนที่แล้ว', status: 'open' });

    const rows = await prisma.placeReport.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ placeId: place.id, reason: 'closed', status: 'open', resolvedById: null, resolvedAt: null });
    expect(await reportModel.listOpenCount()).toBe(1);
  });

  test('details are optional, except for "other"', async () => {
    const client = await member();
    expect((await client.post(reportsPath(place.id), { reason: 'moved', details: '' })).status).toBe(201);
    expect((await prisma.placeReport.findFirst()).details).toBeNull();

    const other = await (await member('other@example.com')).post(reportsPath(place.id), { reason: 'other', details: '   ' });
    expect(other.status).toBe(400);
    expect(other.body.error.code).toBe('VALIDATION_ERROR');
    expect(other.body.error.details.map((detail) => detail.field)).toContain('details');
  });

  test.each([
    ['an unknown reason', { reason: 'spam' }, 'reason'],
    ['a missing reason', {}, 'reason'],
    ['details over 1000 characters', { reason: 'wrong_info', details: 'ก'.repeat(1001) }, 'details'],
  ])('refuses %s', async (label, body, field) => {
    const res = await (await member()).post(reportsPath(place.id), body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((detail) => detail.field)).toContain(field);
    expect(await prisma.placeReport.count()).toBe(0);
  });

  test('accepts details of exactly 1000 characters', async () => {
    const res = await (await member()).post(reportsPath(place.id), { reason: 'wrong_info', details: 'ก'.repeat(1000) });
    expect(res.status).toBe(201);
  });

  test('one open report per member per place; another member may still report it', async () => {
    const client = await member();
    expect((await client.post(reportsPath(place.id), { reason: 'closed' })).status).toBe(201);

    const again = await client.post(reportsPath(place.id), { reason: 'moved' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REPORT_EXISTS');

    const someoneElse = await (await member('somsri@example.com')).post(reportsPath(place.id), { reason: 'closed' });
    expect(someoneElse.status).toBe(201);
    expect(await prisma.placeReport.count()).toBe(2);
  });

  test('once a report is handled, the same member may report the place again', async () => {
    const client = await member();
    await client.post(reportsPath(place.id), { reason: 'closed' });
    const admin = await prisma.user.create({ data: { username: 'แอดมิน', email: 'admin@example.com', passwordHash: 'x', role: 'admin' } });
    await prisma.placeReport.updateMany({ data: { status: 'dismissed', resolvedById: admin.id, resolvedAt: new Date() } });

    expect((await client.post(reportsPath(place.id), { reason: 'moved' })).status).toBe(201);
    expect(await reportModel.listOpenCount()).toBe(1);
  });

  test('a visitor gets 401', async () => {
    const res = await createClient(app).post(reportsPath(place.id), { reason: 'closed' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  test.each([
    ['an unpublished place', () => hidden.id],
    ['an unknown place', () => 999999],
    ['an id that is not a number', () => 'abc'],
  ])('%s is 404', async (label, id) => {
    const res = await (await member()).post(reportsPath(id()), { reason: 'closed' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await prisma.placeReport.count()).toBe(0);
  });

  test('a request without the CSRF token is refused', async () => {
    const client = await member();
    const res = await client.agent.post(reportsPath(place.id)).send({ reason: 'closed' });
    expect(res.status).toBe(403);
    expect(await prisma.placeReport.count()).toBe(0);
  });
});

describe('page: POST /places/:id/reports', () => {
  test('stores the report and shows a thank-you message on the place page', async () => {
    const client = await member();
    const res = await client.postForm(`/places/${place.id}/reports`, { reason: 'wrong_info', details: 'เบอร์โทรผิด' });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/places/${place.id}#report`);
    expect(await prisma.placeReport.count()).toBe(1);

    const page = await client.get(`/places/${place.id}`);
    expect(page.text).toContain('ขอบคุณที่แจ้ง ผู้ดูแลจะตรวจสอบข้อมูลนี้');
    // A flash message is shown once.
    expect((await client.get(`/places/${place.id}`)).text).not.toContain('ขอบคุณที่แจ้ง');
  });

  test('a fixable error goes back to the place with an error message', async () => {
    const client = await member();
    const missing = await client.postForm(`/places/${place.id}/reports`, { reason: 'other', details: '' });
    expect(missing.status).toBe(303);
    expect(missing.headers.location).toBe(`/places/${place.id}#report`);
    expect((await client.get(`/places/${place.id}`)).text).toContain('กรุณาอธิบายว่าข้อมูลใดไม่ถูกต้อง');

    await client.postForm(`/places/${place.id}/reports`, { reason: 'closed' });
    const twice = await client.postForm(`/places/${place.id}/reports`, { reason: 'closed' });
    expect(twice.status).toBe(303);
    expect((await client.get(`/places/${place.id}`)).text).toContain('คุณแจ้งข้อมูลสถานที่นี้ไว้แล้ว');
    expect(await prisma.placeReport.count()).toBe(1);
  });

  test('a visitor is sent to the login page', async () => {
    const res = await createClient(app).postForm(`/places/${place.id}/reports`, { reason: 'closed' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/login/);
    expect(await prisma.placeReport.count()).toBe(0);
  });

  test('an unpublished place is 404', async () => {
    const res = await (await member()).postForm(`/places/${hidden.id}/reports`, { reason: 'closed' });
    expect(res.status).toBe(404);
    expect(await prisma.placeReport.count()).toBe(0);
  });

  test('a form without the CSRF token is refused', async () => {
    const client = await member();
    const res = await client.agent.post(`/places/${place.id}/reports`).type('form').send({ reason: 'closed' });
    expect(res.status).toBe(403);
    expect(await prisma.placeReport.count()).toBe(0);
  });
});

describe('the report form partial', () => {
  const render = (currentUser) =>
    ejs.renderFile(path.join(__dirname, '..', 'src', 'views', 'partials', 'report-form.ejs'), {
      ...viewHelpers,
      place: { id: 7 },
      currentUser,
      csrfToken: () => 'token-123',
    });

  test('a visitor sees a login link that comes back to the place', async () => {
    const html = await render(null);
    expect(html).toContain('href="/login?next=%2Fplaces%2F7"');
    expect(html).not.toContain('<form');
  });

  test('a member sees the form with the four reasons and the CSRF field', async () => {
    const html = await render({ id: 1, username: 'สมชาย' });
    expect(html).toContain('action="/places/7/reports"');
    expect(html).toContain('name="_csrf" value="token-123"');
    for (const value of ['closed', 'moved', 'wrong_info', 'other']) expect(html).toContain(`value="${value}"`);
    expect(html).toMatch(/<textarea[^>]*name="details"[^>]*maxlength="1000"/);
    expect(html).toContain('ส่งรายงาน');
  });
});

describe('database rules', () => {
  const insert = async (data) => {
    const user = await prisma.user.create({ data: { username: 'สมชาย', email: `u${Date.now()}${Math.random()}@example.com`, passwordHash: 'x' } });
    return prisma.placeReport.create({ data: { placeId: place.id, userId: user.id, ...data } });
  };

  test.each([
    ['"other" without details', { reason: 'other' }],
    ['blank details', { reason: 'closed', details: '   ' }],
    ['a resolved report without who and when', { reason: 'closed', status: 'resolved' }],
    ['an open report with a resolver', { reason: 'closed', resolvedAt: new Date() }],
  ])('refuses %s', async (label, data) => {
    await expect(insert(data)).rejects.toThrow();
  });

  test('two open reports by one member for one place are refused', async () => {
    const report = await insert({ reason: 'closed' });
    await expect(prisma.placeReport.create({ data: { placeId: place.id, userId: report.userId, reason: 'moved' } })).rejects.toMatchObject({ code: 'P2002' });
  });

  test('deleting a place deletes its reports', async () => {
    await insert({ reason: 'closed' });
    await prisma.place.delete({ where: { id: place.id } });
    expect(await prisma.placeReport.count()).toBe(0);
  });
});
