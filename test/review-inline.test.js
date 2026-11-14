// Editing and deleting your own review on the place page, and the star input.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();
let place;
let alice;
let bob;

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

beforeEach(async () => {
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  place = await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านทดสอบ', description: 'รายละเอียด', address: 'ลาดกระบัง' } });
  alice = await member('alice');
  bob = await member('bob');
});

afterAll(closeDatabase);

const page = () => `/places/${place.id}`;
const next = () => `/places/${place.id}#reviews`;
const reviewOf = (userId) => prisma.review.findFirst({ where: { userId } });

describe('own review on the place page', () => {
  beforeEach(async () => {
    await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'กาแฟอร่อยมาก' });
    await bob.post(`/api/v1/places/${place.id}/reviews`, { rating: 2, comment: 'เฉย ๆ' });
  });

  test('the author sees their review with edit and delete forms, once', async () => {
    const review = await reviewOf(alice.id);
    const html = (await alice.get(page())).text;
    expect(html).toContain('รีวิวของคุณ');
    expect(html).toContain(`action="/reviews/${review.id}/edit"`);
    expect(html).toContain(`action="/reviews/${review.id}/delete"`);
    expect(html.split('กาแฟอร่อยมาก').length - 1).toBe(2); // shown + textarea, not in the list
    expect(html.split('<article class="review" id="review-').length - 1).toBe(1); // only bob's
  });

  test('the edit form has five radios named rating and the saved one is checked', async () => {
    const html = (await alice.get(page())).text;
    const own = html.slice(html.indexOf('id="own-review"'));
    expect(own.match(/type="radio" id="own-rating-\d" name="rating"/g)).toHaveLength(5);
    expect(own).toMatch(/id="own-rating-4"[^>]*value="4" checked/);
    expect(own).not.toMatch(/id="own-rating-3"[^>]*checked/);
    expect(own).toContain('4 ดาว');
  });

  test('other members and visitors get no edit or delete forms for it', async () => {
    const review = await reviewOf(alice.id);
    for (const viewer of [bob, createClient(app)]) {
      const html = (await viewer.get(page())).text;
      expect(html).not.toContain(`/reviews/${review.id}/edit`);
      expect(html).not.toContain(`/reviews/${review.id}/delete`);
      expect(html).toContain('กาแฟอร่อยมาก'); // still in the public list
    }
  });

  test('editing with next goes back to the place page and saves', async () => {
    const review = await reviewOf(alice.id);
    const res = await alice.postForm(`/reviews/${review.id}/edit`, { rating: '5', comment: 'ดีขึ้นอีก', next: next() });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(next());
    const saved = await reviewOf(alice.id);
    expect(saved).toMatchObject({ rating: 5, comment: 'ดีขึ้นอีก' });
    expect((await alice.get(page())).text).toContain('บันทึกการแก้ไขรีวิวแล้ว');
  });

  test('a validation error returns to the place page with a message', async () => {
    const review = await reviewOf(alice.id);
    const res = await alice.postForm(`/reviews/${review.id}/edit`, { rating: '9', next: next() });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(next());
    expect((await reviewOf(alice.id)).rating).toBe(4);
  });

  test('deleting with next goes back to the place page', async () => {
    const review = await reviewOf(alice.id);
    const res = await alice.postForm(`/reviews/${review.id}/delete`, { next: next() });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(next());
    expect(await reviewOf(alice.id)).toMatchObject({ status: 'deleted' });
  });

  test.each([
    'https://evil.example',
    '//evil.example',
    '/places/1/../../admin',
    '/places/01',
    '/places/1#other',
    '/places/1?x=1',
    '/places/12345678901',
    '/places/1\evil',
  ])('a bad next (%s) falls back to /me/reviews', async (bad) => {
    const review = await reviewOf(alice.id);
    const res = await alice.postForm(`/reviews/${review.id}/edit`, { rating: '3', next: bad });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/me/reviews');
  });

  test('without next the redirect is still /me/reviews, for edit and delete', async () => {
    const review = await reviewOf(alice.id);
    expect((await alice.postForm(`/reviews/${review.id}/edit`, { rating: '3' })).headers.location).toBe('/me/reviews');
    expect((await alice.postForm(`/reviews/${review.id}/delete`)).headers.location).toBe('/me/reviews');
  });

  test('my reviews page uses the star input with the saved rating checked', async () => {
    const html = (await alice.get('/me/reviews')).text;
    expect(html.match(/name="rating"/g)).toHaveLength(5);
    expect(html).toMatch(/value="4" checked/);
  });
});

describe('creating a review from the place page', () => {
  test('shows five radios, none checked, and the form creates the review', async () => {
    const html = (await alice.get(page())).text;
    expect(html.match(/type="radio" id="rating-\d" name="rating"/g)).toHaveLength(5);
    expect(html).not.toMatch(/name="rating"[^>]*checked/);
    expect(html).not.toContain('<select id="rating"');
    const res = await alice.postForm(`/places/${place.id}/reviews`, { rating: '3', comment: 'โอเค' });
    expect(res.status).toBe(303);
    expect(await reviewOf(alice.id)).toMatchObject({ rating: 3, comment: 'โอเค' });
  });
});
