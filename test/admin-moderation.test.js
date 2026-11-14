// Step 6: admin tools for reviews, "wrong information" reports and categories.
const { createApp } = require('../src/app');
const categoryModel = require('../src/models/category');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

// Seven days of unknown opening hours (the database checks the length).
const WEEK = Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'unknown' }));

let category;
let place;
let admin;
let alice;
let bob;

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

const placeRow = async (id) => {
  const row = await prisma.place.findUnique({ where: { id }, select: { ratingAvg: true, ratingCount: true } });
  return { avg: row.ratingAvg === null ? null : Number(row.ratingAvg), count: row.ratingCount };
};

// A review written through the real endpoint.
async function review(client, placeId, body = { rating: 4, comment: 'อร่อยมาก' }) {
  const res = await client.post(`/api/v1/places/${placeId}/reviews`, body);
  expect(res.status).toBe(201);
  return res.body.data;
}

async function report(client, placeId, body = { reason: 'closed' }) {
  const res = await client.post(`/api/v1/places/${placeId}/reports`, body);
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeEach(async () => {
  await resetDatabase();
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  place = await prisma.place.create({
    data: { categoryId: category.id, name: 'ร้านทดสอบ', description: 'รายละเอียด', address: 'ลาดกระบัง' },
  });
  admin = createClient(app);
  await admin.registerAdmin();
  alice = await member('alice');
  bob = await member('bob');
});

afterAll(closeDatabase);

// ---------------------------------------------------------------- access

describe('access control', () => {
  const routes = [
    ['get', '/api/v1/admin/reviews'],
    ['post', '/api/v1/admin/reviews/1/remove', { reason: 'x' }],
    ['get', '/api/v1/admin/reports'],
    ['post', '/api/v1/admin/reports/1/resolve', { status: 'resolved' }],
    ['post', '/api/v1/admin/categories', { name: 'ใหม่' }],
    ['patch', '/api/v1/admin/categories/1', { name: 'ใหม่' }],
    ['delete', '/api/v1/admin/categories/1'],
  ];
  const pages = [
    ['get', '/admin/reviews'],
    ['get', '/admin/places/1/reviews'],
    ['get', '/admin/places/1/reports'],
    ['get', '/admin/reports'],
    ['get', '/admin/categories'],
    ['post', '/admin/reviews/1/remove', { reason: 'x' }],
    ['post', '/admin/reports/1/resolve', { status: 'resolved' }],
    ['post', '/admin/categories', { name: 'ใหม่' }],
    ['post', '/admin/categories/1', { name: 'ใหม่' }],
    ['post', '/admin/categories/1/delete'],
  ];

  async function send(client, [method, path, body]) {
    if (method === 'get') return client.get(path);
    if (path.startsWith('/admin/')) return client.postForm(path, body);
    const token = await client.csrfToken();
    return client.agent[method](path).set('X-CSRF-Token', token).send(body ?? {});
  }

  test('a visitor gets 401 from the API and a redirect to the login page from pages', async () => {
    const visitor = createClient(app);
    for (const route of routes) expect((await send(visitor, route)).status).toBe(401);
    for (const route of pages) {
      const res = await send(visitor, route);
      expect([302, 303]).toContain(res.status);
      expect(res.headers.location).toMatch(/^\/login/);
    }
  });

  test('a member gets 403 on every route', async () => {
    for (const route of routes) expect((await send(alice, route)).status).toBe(403);
    for (const route of pages) expect((await send(alice, route)).status).toBe(403);
  });

  test('changes need a CSRF token', async () => {
    const created = await review(alice, place.id);
    const noToken = await admin.agent.post(`/api/v1/admin/reviews/${created.id}/remove`).send({ reason: 'ไม่เหมาะสม' });
    expect(noToken.status).toBe(403);
    const form = await admin.agent.post(`/admin/reviews/${created.id}/remove`).type('form').send({ reason: 'ไม่เหมาะสม' });
    expect(form.status).toBe(403);
    expect((await prisma.review.findUnique({ where: { id: created.id } })).status).toBe('active');

    const category403 = await admin.agent.delete(`/api/v1/admin/categories/${category.id}`);
    expect(category403.status).toBe(403);
    const close = await admin.agent.post('/api/v1/admin/reports/1/resolve').send({ status: 'resolved' });
    expect(close.status).toBe(403);
  });
});

// --------------------------------------------------------------- reviews

describe('admin reviews', () => {
  test('lists every review with place, author, rating, comment and status, newest first', async () => {
    const first = await review(alice, place.id, { rating: 5, comment: 'ดีเยี่ยม' });
    const second = await review(bob, place.id, { rating: 2, comment: 'เฉย ๆ' });
    await alice.agent.delete(`/api/v1/reviews/${first.id}`).set('X-CSRF-Token', await alice.csrfToken());

    const res = await admin.get('/api/v1/admin/reviews');
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(res.body.data.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(res.body.data[0]).toMatchObject({
      rating: 2,
      comment: 'เฉย ๆ',
      status: 'active',
      user: { username: 'bob' },
      place: { id: place.id, name: 'ร้านทดสอบ' },
    });
    expect(res.body.data[1].status).toBe('deleted');
    expect(res.body.data[0]).not.toHaveProperty('removedById');
  });

  test('filters by status; an unknown status means all; pages hold 20', async () => {
    const a = await review(alice, place.id);
    await review(bob, place.id);
    await admin.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: 'ผิดกฎ' });

    const removed = await admin.get('/api/v1/admin/reviews?status=removed');
    expect(removed.body.data.map((r) => r.id)).toEqual([a.id]);
    expect((await admin.get('/api/v1/admin/reviews?status=active')).body.meta.total).toBe(1);
    expect((await admin.get('/api/v1/admin/reviews?status=deleted')).body.meta.total).toBe(0);
    expect((await admin.get('/api/v1/admin/reviews?status=bogus')).body.meta.total).toBe(2);
    expect((await admin.get('/api/v1/admin/reviews?status=all')).body.meta.total).toBe(2);

    // 25 reviews: 20 on page 1, 5 on page 2
    const users = [];
    for (let i = 0; i < 25; i += 1) {
      users.push({ username: `user${i}`, email: `user${i}@example.com`, passwordHash: 'x' });
    }
    await prisma.user.createMany({ data: users });
    const all = await prisma.user.findMany({ where: { username: { startsWith: 'user' } } });
    await prisma.review.createMany({ data: all.map((u) => ({ userId: u.id, placeId: place.id, rating: 3 })) });
    const page1 = await admin.get('/api/v1/admin/reviews?status=active');
    expect(page1.body.data).toHaveLength(20);
    const page2 = await admin.get('/api/v1/admin/reviews?status=active&page=2');
    expect(page2.body.data).toHaveLength(6);
  });

  test('the page lists reviews, tabs and the form', async () => {
    await review(alice, place.id, { rating: 3, comment: 'ข้อความทดสอบ' });
    const res = await admin.get('/admin/reviews');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ร้านทดสอบ');
    expect(res.text).toContain('alice');
    expect(res.text).toContain('ข้อความทดสอบ');
    expect(res.text).toContain('/remove');
  });

  test('removing sets the status, the admin and the reason, and recalculates the rating', async () => {
    const a = await review(alice, place.id, { rating: 5 });
    await review(bob, place.id, { rating: 3 });
    expect(await placeRow(place.id)).toEqual({ avg: 4, count: 2 });

    const res = await admin.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: '  โฆษณา  ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: a.id, status: 'removed', removedReason: 'โฆษณา' });
    expect(res.body.data).not.toHaveProperty('removedById');

    const row = await prisma.review.findUnique({ where: { id: a.id } });
    expect(row).toMatchObject({ status: 'removed', removedById: admin.id, removedReason: 'โฆษณา' });
    expect(await placeRow(place.id)).toEqual({ avg: 3, count: 1 });
  });

  test('removing the only review leaves the place without a rating', async () => {
    const a = await review(alice, place.id, { rating: 5 });
    await admin.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: 'ผิดกฎ' });
    expect(await placeRow(place.id)).toEqual({ avg: null, count: 0 });
  });

  test('a reason is required (400), 1 to 500 visible characters', async () => {
    const a = await review(alice, place.id);
    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: '​​' }, { reason: 'x'.repeat(501) }, { reason: 123 }]) {
      const res = await admin.post(`/api/v1/admin/reviews/${a.id}/remove`, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await prisma.review.findUnique({ where: { id: a.id } })).status).toBe('active');
    expect((await admin.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: 'x'.repeat(500) })).status).toBe(200);
  });

  test('only an active review can be removed (409 INVALID_STATE); unknown ids are 404', async () => {
    const a = await review(alice, place.id);
    const b = await review(bob, place.id);
    await bob.agent.delete(`/api/v1/reviews/${b.id}`).set('X-CSRF-Token', await bob.csrfToken());

    expect((await admin.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: 'ผิดกฎ' })).status).toBe(200);
    const again = await admin.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: 'อีกครั้ง' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
    expect((await prisma.review.findUnique({ where: { id: a.id } })).removedReason).toBe('ผิดกฎ');

    const deleted = await admin.post(`/api/v1/admin/reviews/${b.id}/remove`, { reason: 'ผิดกฎ' });
    expect(deleted.status).toBe(409);
    expect(deleted.body.error.code).toBe('INVALID_STATE');

    expect((await admin.post('/api/v1/admin/reviews/99999/remove', { reason: 'x' })).status).toBe(404);
    expect((await admin.post('/api/v1/admin/reviews/abc/remove', { reason: 'x' })).status).toBe(404);
    expect((await admin.post('/api/v1/admin/reviews/01/remove', { reason: 'x' })).status).toBe(404);
  });

  test('two simultaneous removals: exactly one succeeds and the rating is right', async () => {
    const a = await review(alice, place.id, { rating: 5 });
    await review(bob, place.id, { rating: 3 });
    const other = createClient(app);
    await other.registerAdmin({ username: 'admin2', email: 'admin2@example.com' });

    const results = await Promise.all([
      admin.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: 'หนึ่ง' }),
      other.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: 'สอง' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await placeRow(place.id)).toEqual({ avg: 3, count: 1 });
  });

  test('the form removes the review and redirects back with the filter kept', async () => {
    const a = await review(alice, place.id);
    const res = await admin.postForm(`/admin/reviews/${a.id}/remove`, { reason: 'ไม่เหมาะสม', status: 'active' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/reviews?status=active');
    expect((await prisma.review.findUnique({ where: { id: a.id } })).status).toBe('removed');

    const page = await admin.get('/admin/reviews?status=removed');
    expect(page.text).toContain('นำรีวิวออกแล้ว');
    expect(page.text).toContain('ไม่เหมาะสม');
  });

  test('form errors (no reason, already removed) flash an error and redirect; a bad filter is ignored', async () => {
    const a = await review(alice, place.id);
    const noReason = await admin.postForm(`/admin/reviews/${a.id}/remove`, { reason: '', status: '"><x' });
    expect(noReason.status).toBe(303);
    expect(noReason.headers.location).toBe('/admin/reviews');
    expect((await admin.get('/admin/reviews')).text).toContain('กรุณา');

    await admin.postForm(`/admin/reviews/${a.id}/remove`, { reason: 'ผิดกฎ' });
    const twice = await admin.postForm(`/admin/reviews/${a.id}/remove`, { reason: 'ผิดกฎ' });
    expect(twice.status).toBe(303);
    expect((await admin.get('/admin/reviews')).text).toContain('ไม่ได้อยู่ในสถานะที่นำออกได้');

    const missing = await admin.postForm('/admin/reviews/99999/remove', { reason: 'x' });
    expect(missing.status).toBe(303);
  });

  test('the API filters by place, together with status; an unknown or malformed place is 404', async () => {
    const other = await prisma.place.create({
      data: { categoryId: category.id, name: 'ร้านอื่น', description: 'รายละเอียด', address: 'ลาดกระบัง' },
    });
    const a = await review(alice, place.id);
    const b = await review(bob, place.id);
    const c = await review(alice, other.id);
    await admin.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: 'ผิดกฎ' });

    const here = await admin.get(`/api/v1/admin/reviews?placeId=${place.id}`);
    expect(here.status).toBe(200);
    expect(here.body.data.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(here.body.meta.total).toBe(2);
    const active = await admin.get(`/api/v1/admin/reviews?placeId=${place.id}&status=active`);
    expect(active.body.data.map((r) => r.id)).toEqual([b.id]);
    expect((await admin.get(`/api/v1/admin/reviews?placeId=${other.id}`)).body.data.map((r) => r.id)).toEqual([c.id]);
    expect((await admin.get('/api/v1/admin/reviews?placeId=')).body.meta.total).toBe(3);

    for (const bad of ['99999', 'abc', '01', '-1']) {
      const res = await admin.get(`/api/v1/admin/reviews?placeId=${bad}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  test("a place's reviews tab shows only that place, with status tabs and remove forms", async () => {
    const other = await prisma.place.create({
      data: { categoryId: category.id, name: 'ร้านอื่น', description: 'รายละเอียด', address: 'ลาดกระบัง' },
    });
    await review(alice, place.id, { rating: 4, comment: 'รีวิวร้านนี้' });
    await review(bob, other.id, { rating: 2, comment: 'รีวิวร้านอื่น' });

    const res = await admin.get(`/admin/places/${place.id}/reviews`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('รีวิวของ ร้านทดสอบ');
    expect(res.text).toContain('รีวิวร้านนี้');
    expect(res.text).not.toContain('รีวิวร้านอื่น');
    expect(res.text).toContain(`href="/admin/places/${place.id}/reviews?status=removed"`);
    expect(res.text).toContain(`name="placeId" value="${place.id}"`);
    expect(res.text).toContain(`href="/admin/places/${place.id}/edit"`);

    expect((await admin.get('/admin/places/99999/reviews')).status).toBe(404);
    expect((await admin.get('/admin/places/abc/reviews')).status).toBe(404);
  });

  test('removing from a place tab returns to that tab and recalculates the rating', async () => {
    const a = await review(alice, place.id, { rating: 5 });
    await review(bob, place.id, { rating: 1 });
    const res = await admin.postForm(`/admin/reviews/${a.id}/remove`, { reason: 'ไม่เหมาะสม', status: 'active', placeId: String(place.id) });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/admin/places/${place.id}/reviews?status=active`);
    expect(await placeRow(place.id)).toEqual({ avg: 1, count: 1 });
    const page = await admin.get(`/admin/places/${place.id}/reviews?status=removed`);
    expect(page.text).toContain('นำรีวิวออกแล้ว');
    expect(page.text).toContain('ไม่เหมาะสม');

    // A malformed placeId falls back to the site-wide list.
    const carol = await member('carol');
    const b = await review(carol, place.id, { rating: 3 });
    const fallback = await admin.postForm(`/admin/reviews/${b.id}/remove`, { reason: 'x', placeId: '../x' });
    expect(fallback.headers.location).toBe('/admin/reviews');
  });

  test('the places list and the edit form link to the reviews tab', async () => {
    expect((await admin.get('/admin/places')).text).toContain(`href="/admin/places/${place.id}/reviews"`);
    expect((await admin.get(`/admin/places/${place.id}/edit`)).text).toContain(`href="/admin/places/${place.id}/reviews"`);
  });

  test('a removed review is hidden from the public place page and API', async () => {
    const a = await review(alice, place.id, { rating: 5, comment: 'ข้อความที่จะถูกนำออก' });
    expect((await createClient(app).get(`/places/${place.id}`)).text).toContain('ข้อความที่จะถูกนำออก');

    await admin.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: 'ผิดกฎ' });
    const visitor = createClient(app);
    expect((await visitor.get(`/places/${place.id}`)).text).not.toContain('ข้อความที่จะถูกนำออก');
    const api = await visitor.get(`/api/v1/places/${place.id}/reviews`);
    expect(api.body.data).toHaveLength(0);
    expect(api.body.meta.total).toBe(0);
  });

  test('the author cannot edit, delete or replace a removed review, and sees the reason', async () => {
    const a = await review(alice, place.id, { rating: 5 });
    await admin.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: 'ผิดกฎของชุมชน' });

    expect((await alice.patch(`/api/v1/reviews/${a.id}`, { rating: 1 })).status).toBe(404);
    const del = await alice.agent.delete(`/api/v1/reviews/${a.id}`).set('X-CSRF-Token', await alice.csrfToken());
    expect(del.status).toBe(404);
    const again = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 5 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');

    const row = await prisma.review.findUnique({ where: { id: a.id } });
    expect(row).toMatchObject({ status: 'removed', rating: 5, removedReason: 'ผิดกฎของชุมชน' });
    expect((await alice.get('/me/reviews')).text).toContain('ผิดกฎของชุมชน');
  });

  test('escapes a review comment, a username and a removal reason on the admin page', async () => {
    const payload = '<script>alert(1)</script>';
    const a = await review(alice, place.id, { rating: 3, comment: payload });
    let page = await admin.get('/admin/reviews');
    expect(page.text).not.toContain(payload);
    expect(page.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');

    await admin.post(`/api/v1/admin/reviews/${a.id}/remove`, { reason: payload });
    page = await admin.get('/admin/reviews?status=removed');
    expect(page.text).not.toContain(payload);
    expect(page.text).toContain('&lt;script&gt;alert(1)');
  });
});

// --------------------------------------------------------------- reports

describe('admin reports', () => {
  test('lists open reports oldest first with place, reporter, reason and details', async () => {
    const r1 = await report(alice, place.id, { reason: 'closed', details: 'ปิดแล้ว' });
    const r2 = await report(bob, place.id, { reason: 'other', details: 'ที่อยู่ผิด' });
    await prisma.placeReport.update({ where: { id: r1.id }, data: { createdAt: new Date('2026-01-01') } });

    const res = await admin.get('/api/v1/admin/reports');
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    expect(res.body.data.map((r) => r.id)).toEqual([r1.id, r2.id]);
    expect(res.body.data[0]).toMatchObject({
      reason: 'closed',
      details: 'ปิดแล้ว',
      status: 'open',
      place: { id: place.id, name: 'ร้านทดสอบ' },
      user: { username: 'alice' },
    });

    const html = await admin.get('/admin/reports');
    expect(html.status).toBe(200);
    expect(html.text).toContain(`/admin/places/${place.id}/reports`);
    expect(html.text).toContain('ปิดกิจการ');
    expect(html.text).toContain('อื่น ๆ');
    expect(html.text).toContain('alice');
  });

  test('filters by status; open is the default', async () => {
    const r1 = await report(alice, place.id);
    const r2 = await report(bob, place.id);
    await admin.post(`/api/v1/admin/reports/${r1.id}/resolve`, { status: 'resolved' });
    await admin.post(`/api/v1/admin/reports/${r2.id}/resolve`, { status: 'dismissed' });
    await report(alice, place.id, { reason: 'moved' });

    expect((await admin.get('/api/v1/admin/reports')).body.meta.total).toBe(1);
    expect((await admin.get('/api/v1/admin/reports?status=resolved')).body.data.map((r) => r.id)).toEqual([r1.id]);
    expect((await admin.get('/api/v1/admin/reports?status=dismissed')).body.data.map((r) => r.id)).toEqual([r2.id]);
    expect((await admin.get('/api/v1/admin/reports?status=all')).body.meta.total).toBe(3);
    expect((await admin.get('/api/v1/admin/reports?status=bogus')).body.meta.total).toBe(1);
  });

  test('closing sets the status, the admin and the time', async () => {
    const r = await report(alice, place.id);
    const res = await admin.post(`/api/v1/admin/reports/${r.id}/resolve`, { status: 'resolved' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: r.id, status: 'resolved' });
    expect(res.body.data.resolvedAt).toBeTruthy();

    const row = await prisma.placeReport.findUnique({ where: { id: r.id } });
    expect(row).toMatchObject({ status: 'resolved', resolvedById: admin.id });
    expect(row.resolvedAt).toBeInstanceOf(Date);

    const dismissed = await report(bob, place.id);
    expect((await admin.post(`/api/v1/admin/reports/${dismissed.id}/resolve`, { status: 'dismissed' })).body.data.status).toBe('dismissed');
  });

  test('the status must be resolved or dismissed (400)', async () => {
    const r = await report(alice, place.id);
    for (const body of [{}, { status: 'open' }, { status: 'all' }, { status: 5 }]) {
      const res = await admin.post(`/api/v1/admin/reports/${r.id}/resolve`, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await prisma.placeReport.findUnique({ where: { id: r.id } })).status).toBe('open');
  });

  test('a closed report cannot be closed again (409); unknown ids are 404', async () => {
    const r = await report(alice, place.id);
    await admin.post(`/api/v1/admin/reports/${r.id}/resolve`, { status: 'resolved' });
    const again = await admin.post(`/api/v1/admin/reports/${r.id}/resolve`, { status: 'dismissed' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
    expect((await prisma.placeReport.findUnique({ where: { id: r.id } })).status).toBe('resolved');

    expect((await admin.post('/api/v1/admin/reports/99999/resolve', { status: 'resolved' })).status).toBe(404);
    expect((await admin.post('/api/v1/admin/reports/x/resolve', { status: 'resolved' })).status).toBe(404);
  });

  test('the API filters by place, together with status; an unknown or malformed place is 404', async () => {
    const other = await prisma.place.create({
      data: { categoryId: category.id, name: 'ร้านอื่น', description: 'รายละเอียด', address: 'ลาดกระบัง' },
    });
    const r1 = await report(alice, place.id);
    const r2 = await report(bob, place.id);
    const r3 = await report(alice, other.id);
    await admin.post(`/api/v1/admin/reports/${r2.id}/resolve`, { status: 'resolved' });

    expect((await admin.get(`/api/v1/admin/reports?placeId=${place.id}`)).body.data.map((r) => r.id)).toEqual([r1.id]);
    const all = await admin.get(`/api/v1/admin/reports?placeId=${place.id}&status=all`);
    expect(all.body.data.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort());
    expect((await admin.get(`/api/v1/admin/reports?placeId=${other.id}`)).body.data.map((r) => r.id)).toEqual([r3.id]);
    expect((await admin.get('/api/v1/admin/reports?placeId=')).body.meta.total).toBe(2);
    for (const bad of ['99999', 'abc', '01']) {
      const res = await admin.get(`/api/v1/admin/reports?placeId=${bad}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  test("a place's reports tab shows only that place, and closing returns to it", async () => {
    const other = await prisma.place.create({
      data: { categoryId: category.id, name: 'ร้านอื่น', description: 'รายละเอียด', address: 'ลาดกระบัง' },
    });
    const r1 = await report(alice, place.id, { reason: 'closed', details: 'แจ้งร้านนี้' });
    await report(bob, other.id, { reason: 'other', details: 'แจ้งร้านอื่น' });

    const page = await admin.get(`/admin/places/${place.id}/reports`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('แจ้งข้อมูลผิดของ ร้านทดสอบ');
    expect(page.text).toContain('แจ้งร้านนี้');
    expect(page.text).not.toContain('แจ้งร้านอื่น');
    expect(page.text).toContain(`name="placeId" value="${place.id}"`);
    expect(page.text).toContain(`href="/admin/places/${place.id}/edit"`);
    expect(page.text).toContain(`href="/admin/places/${place.id}/reviews"`);

    const res = await admin.postForm(`/admin/reports/${r1.id}/resolve`, { status: 'resolved', filter: 'open', placeId: String(place.id) });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/admin/places/${place.id}/reports`);
    expect((await prisma.placeReport.findUnique({ where: { id: r1.id } })).status).toBe('resolved');
    expect((await admin.get(`/admin/places/${place.id}/reports?status=resolved`)).text).toContain('แจ้งร้านนี้');

    expect((await admin.get('/admin/places/99999/reports')).status).toBe(404);
    expect((await admin.get('/admin/places/abc/reports')).status).toBe(404);
  });

  test('two simultaneous closes: exactly one succeeds', async () => {
    const r = await report(alice, place.id);
    const other = createClient(app);
    await other.registerAdmin({ username: 'admin2', email: 'admin2@example.com' });
    const results = await Promise.all([
      admin.post(`/api/v1/admin/reports/${r.id}/resolve`, { status: 'resolved' }),
      other.post(`/api/v1/admin/reports/${r.id}/resolve`, { status: 'dismissed' }),
    ]);
    expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
    expect((await prisma.placeReport.findUnique({ where: { id: r.id } })).resolvedById).not.toBeNull();
  });

  test('after closing, the same member can report the place again; the open count follows', async () => {
    const reportModel = require('../src/models/report');
    const r = await report(alice, place.id);
    expect(await reportModel.listOpenCount()).toBe(1);
    expect((await alice.post(`/api/v1/places/${place.id}/reports`, { reason: 'moved' })).status).toBe(409);

    await admin.post(`/api/v1/admin/reports/${r.id}/resolve`, { status: 'resolved' });
    expect(await reportModel.listOpenCount()).toBe(0);
    await report(alice, place.id, { reason: 'moved' });
    expect(await reportModel.listOpenCount()).toBe(1);
  });

  test('the form closes the report and redirects back to the same filter', async () => {
    const r = await report(alice, place.id);
    const res = await admin.postForm(`/admin/reports/${r.id}/resolve`, { status: 'dismissed', filter: 'all' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/reports?status=all');
    expect((await prisma.placeReport.findUnique({ where: { id: r.id } })).status).toBe('dismissed');
    expect((await admin.get('/admin/reports?status=dismissed')).text).toContain('ไม่ดำเนินการ');

    const again = await admin.postForm(`/admin/reports/${r.id}/resolve`, { status: 'resolved' });
    expect(again.status).toBe(303);
    expect(again.headers.location).toBe('/admin/reports');
    expect((await admin.get('/admin/reports')).text).toContain('ถูกปิดไปแล้ว');

    const bad = await admin.postForm(`/admin/reports/${r.id}/resolve`, { status: 'nope', filter: '"><x' });
    expect(bad.status).toBe(303);
    expect(bad.headers.location).toBe('/admin/reports');
    expect((await admin.postForm('/admin/reports/99999/resolve', { status: 'resolved' })).status).toBe(303);
  });

  test('escapes report details and the place name on the admin page', async () => {
    const payload = '<script>alert(1)</script>';
    await report(alice, place.id, { reason: 'other', details: payload });
    const html = await admin.get('/admin/reports');
    expect(html.text).not.toContain(payload);
    expect(html.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});

// ------------------------------------------------------------ categories

describe('admin categories', () => {
  test('the page lists categories with place counts (unpublished included) and pending submissions', async () => {
    await prisma.place.create({
      data: { categoryId: category.id, name: 'ซ่อนอยู่', description: 'x', address: 'y', status: 'unpublished' },
    });
    await prisma.submission.create({
      data: { userId: alice.id, categoryId: category.id, name: 'คำขอ', description: 'x', address: 'y', hours: WEEK },
    });
    const empty = await prisma.category.create({ data: { name: 'หมวดว่าง' } });

    const res = await admin.get('/admin/categories');
    expect(res.status).toBe(200);
    expect(res.text).toContain('2 สถานที่ · 1 คำขอที่รอตรวจ');
    expect(res.text).toContain(`/admin/categories/${empty.id}/delete`);
    expect(res.text).not.toContain(`/admin/categories/${category.id}/delete`);

    const listed = await categoryModel.listForAdmin();
    expect(listed.find((c) => c.id === category.id)).toMatchObject({ placeCount: 2, submissionCount: 1, pendingCount: 1 });
  });

  test('add: 201, trimmed name; the public list shows it', async () => {
    const res = await admin.post('/api/v1/admin/categories', { name: '  ตลาดนัด  ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'ตลาดนัด' });
    const names = (await createClient(app).get('/api/v1/categories')).body.data.map((c) => c.name);
    expect(names).toContain('ตลาดนัด');
  });

  test('name must be 1 to 80 visible characters (400)', async () => {
    for (const body of [{}, { name: '' }, { name: '   ' }, { name: '​' }, { name: 'ก'.repeat(81) }, { name: 5 }]) {
      const res = await admin.post('/api/v1/admin/categories', body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await admin.post('/api/v1/admin/categories', { name: 'ก'.repeat(80) })).status).toBe(201);
  });

  test('a duplicate name, ignoring case, is refused on add (409 CONFLICT, Thai message)', async () => {
    await admin.post('/api/v1/admin/categories', { name: 'Coffee' });
    for (const name of ['Coffee', 'coffee', 'COFFEE', ' coffee ']) {
      const res = await admin.post('/api/v1/admin/categories', { name });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.message).toBe('มีหมวดหมู่ชื่อนี้อยู่แล้ว');
    }
    expect(await prisma.category.count({ where: { name: { contains: 'offee', mode: 'insensitive' } } })).toBe(1);
  });

  test('rename: 200; same name in other case works; a duplicate of another category is refused', async () => {
    const coffee = (await admin.post('/api/v1/admin/categories', { name: 'Coffee' })).body.data;
    await admin.post('/api/v1/admin/categories', { name: 'Park' });

    const renamed = await admin.patch(`/api/v1/admin/categories/${coffee.id}`, { name: 'COFFEE' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('COFFEE');
    expect((await admin.patch(`/api/v1/admin/categories/${coffee.id}`, { name: 'COFFEE' })).status).toBe(200);
    expect((await admin.patch(`/api/v1/admin/categories/${coffee.id}`, { name: 'Cafe' })).body.data.name).toBe('Cafe');

    const dup = await admin.patch(`/api/v1/admin/categories/${coffee.id}`, { name: 'PARK' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    expect((await prisma.category.findUnique({ where: { id: coffee.id } })).name).toBe('Cafe');

    expect((await admin.patch(`/api/v1/admin/categories/${coffee.id}`, { name: '' })).status).toBe(400);
    expect((await admin.patch('/api/v1/admin/categories/99999', { name: 'x' })).status).toBe(404);
    expect((await admin.patch('/api/v1/admin/categories/abc', { name: 'x' })).status).toBe(404);
  });

  test('delete: 204 for an unused category; 404 for an unknown one', async () => {
    const empty = await prisma.category.create({ data: { name: 'หมวดว่าง' } });
    expect((await admin.agent.delete(`/api/v1/admin/categories/${empty.id}`).set('X-CSRF-Token', await admin.csrfToken())).status).toBe(204);
    expect(await prisma.category.findUnique({ where: { id: empty.id } })).toBeNull();
    const missing = await admin.agent.delete(`/api/v1/admin/categories/${empty.id}`).set('X-CSRF-Token', await admin.csrfToken());
    expect(missing.status).toBe(404);
    const bad = await admin.agent.delete('/api/v1/admin/categories/0').set('X-CSRF-Token', await admin.csrfToken());
    expect(bad.status).toBe(404);
  });

  test('delete is refused while a place uses the category (409 CATEGORY_IN_USE)', async () => {
    const res = await admin.agent.delete(`/api/v1/admin/categories/${category.id}`).set('X-CSRF-Token', await admin.csrfToken());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CATEGORY_IN_USE');
    expect(await prisma.category.findUnique({ where: { id: category.id } })).not.toBeNull();
  });

  test('delete is refused while only a submission uses the category', async () => {
    const other = await prisma.category.create({ data: { name: 'ใช้โดยคำขอ' } });
    await prisma.submission.create({
      data: { userId: alice.id, categoryId: other.id, name: 'คำขอ', description: 'x', address: 'y', hours: WEEK, status: 'rejected' },
    });
    const res = await admin.agent.delete(`/api/v1/admin/categories/${other.id}`).set('X-CSRF-Token', await admin.csrfToken());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CATEGORY_IN_USE');
  });

  test('the foreign-key error is also turned into CATEGORY_IN_USE (a place added after the check)', async () => {
    const racing = await prisma.category.create({ data: { name: 'แข่งกัน' } });
    // Put a place in the category in the gap between the model's check and its delete.
    const realDelete = prisma.category.delete.bind(prisma.category);
    const spy = jest.spyOn(prisma.category, 'delete').mockImplementation(async (args) => {
      await prisma.place.create({ data: { categoryId: racing.id, name: 'มาทีหลัง', description: 'x', address: 'y' } });
      return realDelete(args);
    });
    try {
      await expect(categoryModel.remove(racing.id)).rejects.toMatchObject({ status: 409, code: 'CATEGORY_IN_USE' });
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.category.findUnique({ where: { id: racing.id } })).not.toBeNull();
  });

  test('page forms: add, rename, delete flash a message and redirect to the list', async () => {
    const added = await admin.postForm('/admin/categories', { name: 'ตลาดนัด' });
    expect(added.status).toBe(303);
    expect(added.headers.location).toBe('/admin/categories');
    const row = await prisma.category.findFirst({ where: { name: 'ตลาดนัด' } });
    expect(row).not.toBeNull();
    expect((await admin.get('/admin/categories')).text).toContain('เพิ่มหมวดหมู่');

    const renamed = await admin.postForm(`/admin/categories/${row.id}`, { name: 'ตลาด' });
    expect(renamed.status).toBe(303);
    expect((await prisma.category.findUnique({ where: { id: row.id } })).name).toBe('ตลาด');

    const dup = await admin.postForm('/admin/categories', { name: 'คาเฟ่' });
    expect(dup.status).toBe(303);
    expect((await admin.get('/admin/categories')).text).toContain('มีหมวดหมู่ชื่อนี้อยู่แล้ว');
    expect((await admin.postForm('/admin/categories', { name: '' })).status).toBe(303);
    expect((await admin.get('/admin/categories')).text).toContain('กรุณา');

    const inUse = await admin.postForm(`/admin/categories/${category.id}/delete`);
    expect(inUse.status).toBe(303);
    expect((await admin.get('/admin/categories')).text).toContain('ลบไม่ได้');
    expect(await prisma.category.findUnique({ where: { id: category.id } })).not.toBeNull();

    const removed = await admin.postForm(`/admin/categories/${row.id}/delete`);
    expect(removed.status).toBe(303);
    expect(await prisma.category.findUnique({ where: { id: row.id } })).toBeNull();

    expect((await admin.postForm('/admin/categories/99999', { name: 'x' })).status).toBe(303);
    expect((await admin.postForm('/admin/categories/abc/delete')).status).toBe(303);
  });

  test('escapes a category name containing markup on the admin page', async () => {
    const payload = '<script>alert(1)</script>';
    await admin.post('/api/v1/admin/categories', { name: payload });
    const html = await admin.get('/admin/categories');
    expect(html.text).not.toContain(payload);
    expect(html.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });
});
