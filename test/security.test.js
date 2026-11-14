// Step 7: rate limits on member writes, and pages that obey the
// Content Security Policy (no inline scripts, event handlers or styles).
const request = require('supertest');
const { createApp } = require('../src/app');
const { resetRateLimits, WRITE_LIMIT } = require('../src/middleware/rateLimit');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let place;

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  place = await prisma.place.create({
    data: { categoryId: category.id, name: 'ร้านกาแฟริมคลอง', description: 'รายละเอียด', address: 'ถนนฉลองกรุง' },
  });
});
afterAll(closeDatabase);

const member = async (email) => {
  const client = createClient(app);
  await client.register({ email });
  return client;
};

// A report with real limits switched on; an empty body is refused with 400,
// which still counts, so a script cannot keep sending invalid data either.
async function report(client, body = {}) {
  const token = await client.csrfToken();
  return client.agent
    .post(`/api/v1/places/${place.id}/reports`)
    .set('X-CSRF-Token', token)
    .set('x-test-real-limits', '1')
    .send(body);
}

describe('member write limit', () => {
  test(`after ${WRITE_LIMIT} writes in 15 minutes the next one is refused with 429`, async () => {
    const alice = await member('alice@example.com');
    const statuses = [];
    for (let i = 0; i < WRITE_LIMIT; i += 1) statuses.push((await report(alice)).status);
    expect(statuses.every((status) => status === 400)).toBe(true);

    const refused = await report(alice, { reason: 'closed' });
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('RATE_LIMITED');
    expect(await prisma.placeReport.count()).toBe(0);
  });

  test('the limit is per account: another member can still write', async () => {
    const alice = await member('alice@example.com');
    for (let i = 0; i < WRITE_LIMIT; i += 1) await report(alice);
    expect((await report(alice, { reason: 'closed' })).status).toBe(429);

    const bob = await member('bob@example.com');
    expect((await report(bob, { reason: 'closed' })).status).toBe(201);
  });

  test('the form version shows the 429 page', async () => {
    const alice = await member('alice@example.com');
    for (let i = 0; i < WRITE_LIMIT; i += 1) await report(alice);
    const token = await alice.csrfToken();
    const res = await alice.agent
      .post(`/places/${place.id}/reports`)
      .type('form')
      .set('x-test-real-limits', '1')
      .send({ _csrf: token, reason: 'closed' });
    expect(res.status).toBe(429);
    expect(res.text).toContain('ส่งข้อมูลบ่อยเกินไป');
  });
});

describe('pages obey the Content Security Policy', () => {
  // Helmet's policy blocks inline scripts and event-handler attributes, so
  // any of these in a page would be silently broken in the browser.
  const INLINE = [
    [/<script(?![^>]*\bsrc=)[^>]*>/i, 'inline <script>'],
    [/\son[a-z]+\s*=/i, 'on...= event attribute'],
    [/javascript:/i, 'javascript: URL'],
    [/\sstyle\s*=/i, 'style= attribute'],
  ];

  test.each(['/', '/places', '/map', '/login', '/register'])('%s has no inline scripts, handlers or styles', async (path) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    for (const [pattern, label] of INLINE) expect([label, pattern.test(res.text)]).toEqual([label, false]);
  });

  test('a place page and the member pages have none either', async () => {
    const alice = await member('alice@example.com');
    for (const path of [`/places/${place.id}`, '/me', '/me/reviews', '/me/favorites', '/submissions/new', '/me/submissions']) {
      const res = await alice.get(path);
      expect([path, res.status]).toEqual([path, 200]);
      for (const [pattern, label] of INLINE) expect([path, label, pattern.test(res.text)]).toEqual([path, label, false]);
    }
  });

  test('the admin pages have none either', async () => {
    const admin = createClient(app);
    await admin.registerAdmin();
    const paths = ['/admin', '/admin/submissions', '/admin/places', '/admin/places/new', `/admin/places/${place.id}/edit`];
    for (const path of [...paths, '/admin/reviews', '/admin/reports', '/admin/categories']) {
      const res = await admin.get(path);
      expect([path, res.status]).toEqual([path, 200]);
      for (const [pattern, label] of INLINE) expect([path, label, pattern.test(res.text)]).toEqual([path, label, false]);
    }
  });
});
