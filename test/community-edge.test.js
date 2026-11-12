// Edge cases in reviews, reports, "my" lists and the seed that reviewers
// reproduced. Each describe block names the bug it guards against.
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const request = require('supertest');
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');
const seedPlaces = require('../prisma/data/places.json');

const app = createApp();

let category;
let place;
let alice;
let bob;

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

const del = async (client, url) => client.agent.delete(url).set('X-CSRF-Token', await client.csrfToken());
// The database wants seven days of hours on a submission.
const closedWeek = () => Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'closed' }));
const reviewRow = (id) => prisma.review.findUnique({ where: { id } });

beforeEach(async () => {
  await resetDatabase();
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  place = await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านทดสอบ', description: 'รายละเอียด', address: 'ลาดกระบัง' } });
  alice = await member('alice');
  bob = await member('bob');
});

afterAll(closeDatabase);

describe('editing a review is partial', () => {
  let review;
  beforeEach(async () => {
    review = (await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 3, comment: 'กาแฟดี' })).body.data;
  });

  test('a new rating alone keeps the comment', async () => {
    const res = await alice.patch(`/api/v1/reviews/${review.id}`, { rating: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rating: 5, comment: 'กาแฟดี' });
  });

  test('a new comment alone keeps the rating', async () => {
    const res = await alice.patch(`/api/v1/reviews/${review.id}`, { comment: 'ขนมก็อร่อย' });
    expect(res.body.data).toMatchObject({ rating: 3, comment: 'ขนมก็อร่อย' });
  });

  test.each([[null], ['']])('comment %p clears it on purpose', async (comment) => {
    const res = await alice.patch(`/api/v1/reviews/${review.id}`, { comment });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rating: 3, comment: null });
  });

  test('an empty PATCH is refused and changes nothing', async () => {
    expect((await alice.patch(`/api/v1/reviews/${review.id}`, {})).status).toBe(400);
    expect(await reviewRow(review.id)).toMatchObject({ rating: 3, comment: 'กาแฟดี' });
  });

  test('the page form (both fields) still works', async () => {
    await alice.postForm(`/reviews/${review.id}/edit`, { rating: '4', comment: '' });
    expect(await reviewRow(review.id)).toMatchObject({ rating: 4, comment: null });
  });

  test('creating still needs a rating', async () => {
    expect((await bob.post(`/api/v1/places/${place.id}/reviews`, { comment: 'ไม่มีดาว' })).status).toBe(400);
  });
});

describe('ratings are strict', () => {
  test.each([[true], [[5]], ['0x5'], ['5e0'], ['05'], ['4.0'], [''], [null], ['1 2']])(
    'rating %p is refused when writing and editing',
    async (value) => {
      expect((await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: value })).status).toBe(400);
      const review = (await bob.post(`/api/v1/places/${place.id}/reviews`, { rating: 2 })).body.data;
      expect((await bob.patch(`/api/v1/reviews/${review.id}`, { rating: value })).status).toBe(400);
      expect((await reviewRow(review.id)).rating).toBe(2);
    }
  );

  test.each([[4, 4], ['4', 4], [' 5 ', 5]])('rating %p is accepted as %p', async (value, stored) => {
    const res = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: value });
    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBe(stored);
  });
});

describe('comments and report details use the shared text rules', () => {
  test('a comment of only invisible characters is stored as no comment', async () => {
    const res = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: '​​ ' });
    expect(res.status).toBe(201);
    expect(res.body.data.comment).toBeNull();
  });

  test('a comment with a control character is refused', async () => {
    expect((await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'ok\u0007' })).status).toBe(400);
  });

  test('"other" with only zero-width spaces is refused', async () => {
    const res = await alice.post(`/api/v1/places/${place.id}/reports`, { reason: 'other', details: '​​​' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((detail) => detail.field)).toContain('details');
    expect(await prisma.placeReport.count()).toBe(0);
  });

  test('NUL in a comment or in report details is not a server error', async () => {
    const review = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'a\u0000b' });
    expect(review.status).toBe(201);
    expect(review.body.data.comment).toBe('ab');
    const report = await alice.post(`/api/v1/places/${place.id}/reports`, { reason: 'other', details: 'ปิด\u0000แล้ว' });
    expect(report.status).toBe(201);
    expect(report.body.data.details).toBe('ปิดแล้ว');
  });
});

describe('the author keeps control after the place is unpublished', () => {
  let review;
  beforeEach(async () => {
    review = (await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'ดี' })).body.data;
    await prisma.place.update({ where: { id: place.id }, data: { status: 'unpublished' } });
  });

  test('editing through the API still works', async () => {
    expect((await alice.patch(`/api/v1/reviews/${review.id}`, { rating: 2 })).status).toBe(200);
    expect((await reviewRow(review.id)).rating).toBe(2);
  });

  test('deleting through the API still works and the rating is recalculated', async () => {
    expect((await del(alice, `/api/v1/reviews/${review.id}`)).status).toBe(204);
    expect((await reviewRow(review.id)).status).toBe('deleted');
    expect((await prisma.place.findUnique({ where: { id: place.id } })).ratingCount).toBe(0);
  });

  test('"my reviews" offers delete but not edit, and the delete form works', async () => {
    const page = await alice.get('/me/reviews');
    expect(page.text).toContain(`action="/reviews/${review.id}/delete"`);
    expect(page.text).not.toContain(`action="/reviews/${review.id}/edit"`);
    await alice.postForm(`/reviews/${review.id}/delete`);
    expect((await reviewRow(review.id)).status).toBe('deleted');
  });

  test('someone else still cannot touch it, and nobody can write a new one', async () => {
    expect((await del(bob, `/api/v1/reviews/${review.id}`)).status).toBe(404);
    expect((await bob.post(`/api/v1/places/${place.id}/reviews`, { rating: 5 })).status).toBe(404);
  });
});

describe('a page number past the end shows the last page', () => {
  test('the place page shows the review instead of "no reviews yet"', async () => {
    await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'รีวิวเดียวของร้าน' });
    const page = await request(app).get(`/places/${place.id}?reviewsPage=5`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('รีวิวเดียวของร้าน');
    expect(page.text).not.toContain('สถานที่นี้ยังไม่มีรีวิว');
  });

  test('"my reviews" and its API show the last page', async () => {
    await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'รีวิวของฉัน' });
    const page = await alice.get('/me/reviews?page=3');
    expect(page.text).toContain('รีวิวของฉัน');
    expect(page.text).not.toContain('ยังไม่มีรีวิว');
    const api = await alice.get('/api/v1/me/reviews?page=3');
    expect(api.body.data).toHaveLength(1);
    expect(api.body.meta.page).toBe(1);
  });

  test('the empty states still show when there is nothing at all', async () => {
    expect((await alice.get('/me/reviews?page=3')).text).toContain('ยังไม่มีรีวิว');
    expect((await request(app).get(`/places/${place.id}?reviewsPage=2`)).text).toContain('สถานที่นี้ยังไม่มีรีวิว');
  });

  test('"my submissions" shows the last page', async () => {
    await prisma.submission.create({
      data: { userId: alice.id, categoryId: category.id, name: 'ร้านที่เสนอ', description: 'รายละเอียด', address: 'ลาดกระบัง', hours: closedWeek() },
    });
    const api = await alice.get('/api/v1/me/submissions?page=4');
    expect(api.status).toBe(200);
    expect(api.body.data.map((item) => item.name)).toEqual(['ร้านที่เสนอ']);
    expect((await alice.get('/me/submissions?page=4')).text).toContain('ร้านที่เสนอ');
  });
});

describe('ids in URLs are strict', () => {
  test('a leading zero is a 404 for reviews, reports and submissions', async () => {
    const review = (await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4 })).body.data;
    const submission = await prisma.submission.create({
      data: { userId: alice.id, categoryId: category.id, name: 'ร้านที่เสนอ', description: 'รายละเอียด', address: 'ลาดกระบัง', hours: closedWeek() },
    });
    expect((await alice.patch(`/api/v1/reviews/0${review.id}`, { rating: 5 })).status).toBe(404);
    expect((await del(alice, `/api/v1/reviews/0${review.id}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/places/0${place.id}/reviews`)).status).toBe(404);
    expect((await bob.post(`/api/v1/places/0${place.id}/reviews`, { rating: 5 })).status).toBe(404);
    expect((await alice.post(`/api/v1/places/0${place.id}/reports`, { reason: 'closed' })).status).toBe(404);
    expect((await alice.get(`/api/v1/me/submissions/0${submission.id}`)).status).toBe(404);
    expect((await alice.get(`/api/v1/me/submissions/${submission.id}`)).status).toBe(200);
    expect((await reviewRow(review.id)).rating).toBe(4);
  });

  test.each(['1e0', '0x1', '2147483648'])('/api/v1/reviews/%s is a 404', async (id) => {
    expect((await alice.patch(`/api/v1/reviews/${id}`, { rating: 5 })).status).toBe(404);
  });
});

describe('the seed only fills an empty database', () => {
  // Runs the real script against the test database (NODE_ENV=test makes the
  // app's config use TEST_DATABASE_URL).
  const runSeed = () =>
    execFileSync(process.execPath, [path.join(__dirname, '..', 'prisma', 'seed.js')], { env: process.env, encoding: 'utf8' });

  beforeEach(resetDatabase);

  test('running twice on an empty database adds everything once', async () => {
    expect(runSeed()).toContain('Seed finished');
    const counts = { places: await prisma.place.count(), categories: await prisma.category.count() };
    expect(counts.places).toBe(seedPlaces.length);
    expect(runSeed()).toContain('Places already exist; the seed only fills an empty database.');
    expect({ places: await prisma.place.count(), categories: await prisma.category.count() }).toEqual(counts);
  });

  test('a renamed place is not added again', async () => {
    runSeed();
    const first = await prisma.place.findFirst({ orderBy: { id: 'asc' } });
    await prisma.place.update({ where: { id: first.id }, data: { name: 'ชื่อใหม่ที่ผู้ดูแลตั้ง' } });
    runSeed();
    expect(await prisma.place.count()).toBe(seedPlaces.length);
    expect(await prisma.place.count({ where: { name: first.name } })).toBe(0);
  });

  test('existing categories are kept and none are added', async () => {
    const name = seedPlaces[0].category;
    await prisma.category.create({ data: { name } });
    const output = runSeed();
    expect(await prisma.category.count()).toBe(1);
    const expected = seedPlaces.filter((item) => item.category.toLowerCase() === name.toLowerCase()).length;
    expect(await prisma.place.count()).toBe(expected);
    if (expected < seedPlaces.length) expect(output).toContain('skipped');
  });
});
