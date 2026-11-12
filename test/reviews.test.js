// Step 4: reviews, the rating average, and saved places.
const request = require('supertest');
const { createApp } = require('../src/app');
const reviewModel = require('../src/models/review');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let place;
let other;
let hidden;
let alice;
let bob;

// A logged-in member with an account of their own.
async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

const placeRow = (id) => prisma.place.findUnique({ where: { id }, select: { ratingAvg: true, ratingCount: true } });
const rating = async (id) => {
  const row = await placeRow(id);
  return { avg: row.ratingAvg === null ? null : Number(row.ratingAvg), count: row.ratingCount };
};

beforeEach(async () => {
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  const base = { categoryId: category.id, description: 'รายละเอียด', address: 'ลาดกระบัง' };
  place = await prisma.place.create({ data: { ...base, name: 'ร้านทดสอบ' } });
  other = await prisma.place.create({ data: { ...base, name: 'ร้านข้าง ๆ' } });
  hidden = await prisma.place.create({ data: { ...base, name: 'ร้านที่ซ่อน', status: 'unpublished' } });
  alice = await member('alice');
  bob = await member('bob');
});

afterAll(closeDatabase);

describe('writing a review', () => {
  test('creates the review and sets the place\'s average and count', async () => {
    const res = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: '  กาแฟดี  ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ rating: 4, comment: 'กาแฟดี', status: 'active', user: { username: 'alice' } });
    expect(res.body.data).not.toHaveProperty('removedById');
    expect(await rating(place.id)).toEqual({ avg: 4, count: 1 });
  });

  test('a second review of the same place by the same member is refused with 409', async () => {
    await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4 });
    const res = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REVIEW_EXISTS');
    expect(await rating(place.id)).toEqual({ avg: 4, count: 1 });
  });

  test('two reviews sent at the same moment by one member store only one', async () => {
    const results = await Promise.all([
      reviewModel.create(alice.id, place.id, { rating: 5, comment: null }).then(() => 'ok', (err) => err.code),
      reviewModel.create(alice.id, place.id, { rating: 3, comment: null }).then(() => 'ok', (err) => err.code),
    ]);
    expect(results.sort()).toEqual(['REVIEW_EXISTS', 'ok']);
    expect(await prisma.review.count()).toBe(1);
    expect((await rating(place.id)).count).toBe(1);
  });

  test('many members reviewing at the same moment never lose a review from the average', async () => {
    const members = await Promise.all(['cust1', 'cust2', 'cust3', 'cust4', 'cust5', 'cust6'].map(member));
    const stars = [5, 4, 3, 2, 1, 5];
    await Promise.all(members.map((client, i) => reviewModel.create(client.id, place.id, { rating: stars[i], comment: null })));
    expect(await rating(place.id)).toEqual({ avg: 3.33, count: 6 });
  });

  test.each([
    ['0', { rating: 0 }],
    ['6', { rating: 6 }],
    ['3.5', { rating: 3.5 }],
    ['text', { rating: 'five' }],
    ['missing', {}],
    ['a comment over 2000 characters', { rating: 4, comment: 'x'.repeat(2001) }],
  ])('a rating of %s is refused', async (label, body) => {
    const res = await alice.post(`/api/v1/places/${place.id}/reviews`, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.review.count()).toBe(0);
  });

  test('an unpublished or unknown place cannot be reviewed', async () => {
    for (const id of [hidden.id, 999999, 'abc']) {
      expect((await alice.post(`/api/v1/places/${id}/reviews`, { rating: 5 })).status).toBe(404);
    }
  });

  test('a visitor cannot review: 401 from the API, login page from the form', async () => {
    expect((await createClient(app).post(`/api/v1/places/${place.id}/reviews`, { rating: 5 })).status).toBe(401);
    const form = await createClient(app).postForm(`/places/${place.id}/reviews`, { rating: 5 });
    expect(form.status).toBe(302);
    expect(form.headers.location).toBe('/login');
  });

  test('the form on the place page publishes the review and shows it', async () => {
    const res = await alice.postForm(`/places/${place.id}/reviews`, { rating: '5', comment: 'บรรยากาศดีมาก' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/places/${place.id}#reviews`);

    const page = await alice.get(`/places/${place.id}`);
    expect(page.text).toContain('เผยแพร่รีวิวของคุณแล้ว');
    expect(page.text).toContain('บรรยากาศดีมาก');
    expect(page.text).toContain('5 จาก 5 คะแนน');
    expect(page.text).toContain('คุณรีวิวสถานที่นี้แล้ว');
    expect(page.text).not.toContain('action="/places/' + place.id + '/reviews"'); // no second form
  });

  test('the form shows a clear message for a bad rating', async () => {
    await alice.postForm(`/places/${place.id}/reviews`, { rating: '3.5' });
    const page = await alice.get(`/places/${place.id}`);
    expect(page.text).toContain('คะแนนต้องเป็นจำนวนเต็ม 1 ถึง 5');
    expect(await prisma.review.count()).toBe(0);
  });

  test('a comment cannot inject HTML into the page', async () => {
    await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: '<script>alert(1)</script>' });
    const page = await request(app).get(`/places/${place.id}`);
    expect(page.text).not.toContain('<script>alert(1)</script>');
    expect(page.text).toContain('&lt;script&gt;');
  });
});

describe('editing and deleting', () => {
  let review;
  beforeEach(async () => {
    review = (await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 2, comment: 'ธรรมดา' })).body.data;
    await bob.post(`/api/v1/places/${place.id}/reviews`, { rating: 5 });
  });

  test('editing updates the review and the average', async () => {
    expect(await rating(place.id)).toEqual({ avg: 3.5, count: 2 });
    const res = await alice.patch(`/api/v1/reviews/${review.id}`, { rating: 4, comment: '' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rating: 4, comment: null });
    expect(await rating(place.id)).toEqual({ avg: 4.5, count: 2 });
  });

  test('deleting is soft, updates the average, and the member can write again', async () => {
    expect((await alice.agent.delete(`/api/v1/reviews/${review.id}`).set('X-CSRF-Token', await alice.csrfToken())).status).toBe(204);
    expect(await rating(place.id)).toEqual({ avg: 5, count: 1 });
    expect((await prisma.review.findUnique({ where: { id: review.id } })).status).toBe('deleted');

    const again = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 3 });
    expect(again.status).toBe(201);
    expect(again.body.data.id).toBe(review.id); // the same row is reused
    expect(await rating(place.id)).toEqual({ avg: 4, count: 2 });
  });

  test('when the last review is deleted, the place has no rating again', async () => {
    const del = async (client, id) => client.agent.delete(`/api/v1/reviews/${id}`).set('X-CSRF-Token', await client.csrfToken());
    const bobs = await prisma.review.findFirst({ where: { userId: bob.id } });
    await del(alice, review.id);
    await del(bob, bobs.id);
    expect(await rating(place.id)).toEqual({ avg: null, count: 0 });
  });

  test('a member cannot edit or delete another member\'s review (404)', async () => {
    expect((await bob.patch(`/api/v1/reviews/${review.id}`, { rating: 1 })).status).toBe(404);
    expect((await bob.agent.delete(`/api/v1/reviews/${review.id}`).set('X-CSRF-Token', await bob.csrfToken())).status).toBe(404);
    const edit = await bob.postForm(`/reviews/${review.id}/edit`, { rating: '1' });
    expect(edit.status).toBe(303);
    expect((await prisma.review.findUnique({ where: { id: review.id } })).rating).toBe(2);
    expect(await rating(place.id)).toEqual({ avg: 3.5, count: 2 });
  });

  test('a deleted review cannot be edited', async () => {
    await alice.agent.delete(`/api/v1/reviews/${review.id}`).set('X-CSRF-Token', await alice.csrfToken());
    expect((await alice.patch(`/api/v1/reviews/${review.id}`, { rating: 5 })).status).toBe(404);
  });

  test('a review removed by an admin cannot be edited, deleted, restored or replaced', async () => {
    const admin = await member('admin');
    await prisma.review.update({ where: { id: review.id }, data: { status: 'removed', removedById: admin.id, removedReason: 'สแปม' } });
    await reviewModel.recalculateRating(prisma, place.id);

    expect((await alice.patch(`/api/v1/reviews/${review.id}`, { rating: 5 })).status).toBe(404);
    expect((await alice.agent.delete(`/api/v1/reviews/${review.id}`).set('X-CSRF-Token', await alice.csrfToken())).status).toBe(404);
    const again = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 5 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
    expect((await prisma.review.findUnique({ where: { id: review.id } })).status).toBe('removed');
    expect(await rating(place.id)).toEqual({ avg: 5, count: 1 });

    const mine = await alice.get('/me/reviews');
    expect(mine.text).toContain('ผู้ดูแลนำออก');
    expect(mine.text).toContain('สแปม');
    expect(mine.text).not.toContain(`/reviews/${review.id}/edit`);
  });

  test('the edit and delete forms on "my reviews" work', async () => {
    const page = await alice.get('/me/reviews');
    expect(page.status).toBe(200);
    expect(page.text).toContain('ร้านทดสอบ');
    expect(page.text).toContain(`action="/reviews/${review.id}/edit"`);

    expect((await alice.postForm(`/reviews/${review.id}/edit`, { rating: '5', comment: 'ดีขึ้นมาก' })).headers.location).toBe('/me/reviews');
    expect((await alice.get('/me/reviews')).text).toContain('บันทึกการแก้ไขรีวิวแล้ว');
    expect(await rating(place.id)).toEqual({ avg: 5, count: 2 });

    await alice.postForm(`/reviews/${review.id}/delete`);
    expect((await alice.get('/me/reviews')).text).toContain('ยังไม่มีรีวิว');
  });
});

describe('reading reviews', () => {
  test('the public list shows active reviews only, newest first, with the author\'s name only', async () => {
    await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4 });
    const second = await bob.post(`/api/v1/places/${place.id}/reviews`, { rating: 2 });
    await bob.agent.delete(`/api/v1/reviews/${second.body.data.id}`).set('X-CSRF-Token', await bob.csrfToken());

    const res = await request(app).get(`/api/v1/places/${place.id}/reviews`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, pageSize: 10, total: 1 });
    expect(res.body.data[0].user).toEqual({ id: alice.id, username: 'alice' });
    expect(JSON.stringify(res.body)).not.toMatch(/email|passwordHash/);
  });

  test('reviews of an unpublished place are not public', async () => {
    expect((await request(app).get(`/api/v1/places/${hidden.id}/reviews`)).status).toBe(404);
  });

  test('"my reviews" needs a login and lists only my own', async () => {
    expect((await request(app).get('/api/v1/me/reviews')).status).toBe(401);
    await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4 });
    await bob.post(`/api/v1/places/${other.id}/reviews`, { rating: 2 });
    const mine = await alice.get('/api/v1/me/reviews');
    expect(mine.body.data.map((review) => review.place.name)).toEqual(['ร้านทดสอบ']);
  });

  test('top rated on the home page needs three reviews', async () => {
    const extra = await member('carol');
    for (const client of [alice, bob]) await client.post(`/api/v1/places/${place.id}/reviews`, { rating: 5 });
    expect((await request(app).get('/api/v1/recommendations')).body.data.highlyRated).toEqual([]);
    await extra.post(`/api/v1/places/${place.id}/reviews`, { rating: 4 });
    const { highlyRated } = (await request(app).get('/api/v1/recommendations')).body.data;
    expect(highlyRated.map((item) => [item.name, item.ratingAvg, item.ratingCount])).toEqual([['ร้านทดสอบ', 4.67, 3]]);
  });
});

describe('saved places', () => {
  const put = async (client, id) => client.agent.put(`/api/v1/me/favorites/${id}`).set('X-CSRF-Token', await client.csrfToken());
  const del = async (client, id) => client.agent.delete(`/api/v1/me/favorites/${id}`).set('X-CSRF-Token', await client.csrfToken());

  test('saving answers 201 the first time and 200 after, with one row', async () => {
    expect((await put(alice, place.id)).status).toBe(201);
    expect((await put(alice, place.id)).status).toBe(200);
    expect(await prisma.favorite.count()).toBe(1);
  });

  test('saving the same place twice at the same moment creates one row and no error', async () => {
    const results = await Promise.all([put(alice, place.id), put(alice, place.id)]);
    expect(results.map((res) => res.status).sort()).toEqual([200, 201]);
    expect(await prisma.favorite.count()).toBe(1);
  });

  test('removing answers 204, even when it was not saved', async () => {
    await put(alice, place.id);
    expect((await del(alice, place.id)).status).toBe(204);
    expect((await del(alice, place.id)).status).toBe(204);
    expect(await prisma.favorite.count()).toBe(0);
  });

  test('only published places can be saved', async () => {
    expect((await put(alice, hidden.id)).status).toBe(404);
    expect((await put(alice, 999999)).status).toBe(404);
  });

  test('the list holds my saved places only, and drops a place once it is unpublished', async () => {
    await put(alice, place.id);
    await put(alice, other.id);
    await put(bob, other.id);
    expect((await alice.get('/api/v1/me/favorites')).body.data.map((item) => item.name)).toEqual(['ร้านข้าง ๆ', 'ร้านทดสอบ']);

    await prisma.place.update({ where: { id: other.id }, data: { status: 'unpublished' } });
    const res = await alice.get('/api/v1/me/favorites');
    expect(res.body.data.map((item) => item.name)).toEqual(['ร้านทดสอบ']);
    expect(res.body.meta.total).toBe(1);
  });

  test('a visitor cannot save', async () => {
    expect((await request(app).get('/api/v1/me/favorites')).status).toBe(401);
    expect((await createClient(app).put(`/api/v1/me/favorites/${place.id}`)).status).toBe(401);
  });

  test('the button on the place page saves and removes, and the page shows the state', async () => {
    let page = await alice.get(`/places/${place.id}`);
    expect(page.text).toContain('data-favorite data-place="' + place.id + '"');
    expect(page.text).toMatch(/name="action" value="save"/);

    const saved = await alice.postForm(`/favorites/${place.id}`, { action: 'save', next: `/places/${place.id}` });
    expect(saved.status).toBe(303);
    expect(saved.headers.location).toBe(`/places/${place.id}`);
    page = await alice.get(`/places/${place.id}`);
    expect(page.text).toContain('บันทึกแล้ว');
    expect(page.text).toMatch(/name="action" value="remove"/);

    const list = await alice.get('/me/favorites');
    expect(list.text).toContain('1 สถานที่ในรายการของคุณ');
    expect(list.text).toContain('ร้านทดสอบ');

    await alice.postForm(`/favorites/${place.id}`, { action: 'remove', next: '/me/favorites' });
    expect((await alice.get('/me/favorites')).text).toContain('ยังไม่มีสถานที่ที่บันทึก');
  });

  test('the form never redirects to another website', async () => {
    const res = await alice.postForm(`/favorites/${place.id}`, { action: 'save', next: 'https://evil.example' });
    expect(res.headers.location).toBe(`/places/${place.id}`);
  });
});
