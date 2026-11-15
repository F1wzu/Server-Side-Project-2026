// Markup the UX fixes rely on. The behaviour itself (asking before a delete,
// not sending a form twice, folding the search form on a phone) lives in
// public/js/site.js and CSS; these tests keep the hooks those need in place.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();
let place;

beforeEach(async () => {
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  place = await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านมอคค่า', description: 'กาแฟ', address: 'ลาดกระบัง' } });
});

afterAll(closeDatabase);

async function member(name = 'alice') {
  const client = createClient(app);
  await client.register({ username: name, email: `${name}@example.com` });
  return client;
}

describe('opening hours on a place page', () => {
  test('a place with no known hours shows one line, not seven empty rows', async () => {
    await prisma.placeHours.createMany({ data: Array.from({ length: 7 }, (unused, weekday) => ({ placeId: place.id, weekday })) });
    const res = await createClient(app).get(`/places/${place.id}`);
    expect(res.text).toContain('ยังไม่ระบุเวลาเปิดบริการของสถานที่นี้');
    expect(res.text).not.toContain('<dl class="opening-hours">');
  });

  test('one known day brings the whole week back', async () => {
    await prisma.placeHours.createMany({
      data: Array.from({ length: 7 }, (unused, weekday) => ({ placeId: place.id, weekday, state: weekday === 0 ? 'closed' : 'unknown' })),
    });
    const res = await createClient(app).get(`/places/${place.id}`);
    expect(res.text).toContain('<dl class="opening-hours">');
    expect(res.text).not.toContain('ยังไม่ระบุเวลาเปิดบริการของสถานที่นี้');
  });
});

describe('deleting asks first', () => {
  test("a member's own review and reply delete forms carry a confirmation question", async () => {
    const alice = await member();
    const posted = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 5, comment: 'ดี' });
    expect(posted.status).toBe(201);
    await alice.post(`/api/v1/reviews/${posted.body.data.id}/replies`, { body: 'ขอบคุณ' });

    const page = await alice.get(`/places/${place.id}`);
    expect(page.text).toMatch(/action="\/reviews\/\d+\/delete" data-confirm="[^"]+"/);
    expect(page.text).toMatch(/action="\/replies\/\d+\/delete" data-confirm="[^"]+"/);
    const mine = await alice.get('/me/reviews');
    expect(mine.text).toMatch(/action="\/reviews\/\d+\/delete" data-confirm="[^"]+"/);
  });
});

describe('phone layout hooks', () => {
  test('the place search form can fold, and starts open while a search is in use', async () => {
    const client = createClient(app);
    const plain = await client.get('/places');
    expect(plain.text).toMatch(/<form class="filter-panel"[^>]* data-collapsible="[^"]+">/);
    expect(plain.text).not.toMatch(/<form class="filter-panel"[^>]* data-active/);
    const searching = await client.get('/places?q=มอค');
    expect(searching.text).toMatch(/<form class="filter-panel"[^>]* data-active>/);
  });

  test('the menu offers logout to a member and not to a visitor', async () => {
    expect((await createClient(app).get('/')).text).not.toContain('class="nav-logout"');
    const alice = await member();
    expect((await alice.get('/')).text).toContain('<form class="nav-logout" action="/logout" method="post">');
  });
});
