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

describe('ordering and filtering the reviews of a place', () => {
  // Three members review the place with 5, 1 and 3 stars, in that order.
  async function threeReviews() {
    for (const [name, rating] of [['ann', 5], ['ben', 1], ['cat', 3]]) {
      const client = await member(name);
      const res = await client.post(`/api/v1/places/${place.id}/reviews`, { rating, comment: `รีวิวของ ${name}` });
      expect(res.status).toBe(201);
    }
  }
  const ratingsOf = async (query = '') => (await createClient(app).get(`/api/v1/places/${place.id}/reviews${query}`)).body.data.map((review) => review.rating);

  test('the API sorts by rating or age and filters by exact stars', async () => {
    await threeReviews();
    expect(await ratingsOf()).toEqual([3, 1, 5]); // newest first
    expect(await ratingsOf('?sort=oldest')).toEqual([5, 1, 3]);
    expect(await ratingsOf('?sort=highest')).toEqual([5, 3, 1]);
    expect(await ratingsOf('?sort=lowest')).toEqual([1, 3, 5]);
    expect(await ratingsOf('?rating=1')).toEqual([1]);
    const res = await createClient(app).get(`/api/v1/places/${place.id}/reviews?rating=4`);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });

  test('a nonsense order or star value falls back to the default instead of failing', async () => {
    await threeReviews();
    expect(await ratingsOf('?sort=drop%20table&rating=9')).toEqual([3, 1, 5]);
    expect(await ratingsOf('?rating=abc')).toEqual([3, 1, 5]);
  });

  test('the page shows the controls, applies them and keeps them when paging', async () => {
    await threeReviews();
    const client = createClient(app);
    const plain = await client.get(`/places/${place.id}`);
    expect(plain.text).toContain('<form class="review-filter"');
    expect(plain.text).not.toContain('ล้างตัวกรอง');

    const lowest = await client.get(`/places/${place.id}?reviewSort=lowest`);
    expect(lowest.text.indexOf('รีวิวของ ben')).toBeLessThan(lowest.text.indexOf('รีวิวของ ann'));
    expect(lowest.text).toContain('<option value="lowest" selected>');
    expect(lowest.text).toContain('ล้างตัวกรอง');

    const oneStar = await client.get(`/places/${place.id}?reviewRating=1`);
    expect(oneStar.text).toContain('รีวิวของ ben');
    expect(oneStar.text).not.toContain('รีวิวของ ann');

    const none = await client.get(`/places/${place.id}?reviewRating=4`);
    expect(none.text).toContain('ไม่มีรีวิว 4 ดาวของสถานที่นี้');
  });

  test('a place with one review or none has no controls to clutter the page', async () => {
    expect((await createClient(app).get(`/places/${place.id}`)).text).not.toContain('class="review-filter"');
  });
});

describe('hooks for the photo preview and the character counter', () => {
  test('the submission form marks its photo input, and review text has a limit to count against', async () => {
    const alice = await member();
    const form = await alice.get('/submissions/new');
    expect(form.text).toMatch(/<input id="photo" name="photos" type="file" multiple data-max-files="5" data-cover-first/);
    const page = await alice.get(`/places/${place.id}`);
    expect(page.text).toMatch(/<textarea id="comment" name="comment" rows="3" maxlength="2000"/);
  });
});
