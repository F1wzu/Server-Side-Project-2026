// Fixes to replies and moderation: the 50-reply cap, replies from before a
// rewrite, returning to the right page, and unpublished places.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let place;
let alice;
let bob;
let admin;
let review;

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

const del = async (client, path) => client.agent.delete(path).set('X-CSRF-Token', await client.csrfToken());
const reply = (client, reviewId, body = 'ขอบคุณครับ') => client.post(`/api/v1/reviews/${reviewId}/replies`, { body });
const fill = (count, userId, reviewId) =>
  prisma.reviewReply.createMany({ data: Array.from({ length: count }, (_, i) => ({ reviewId, userId, body: `ตอบ ${i}` })) });

// Many extra reviews on the place, from throwaway users.
async function addReviews(count) {
  const { passwordHash } = await prisma.user.findUnique({ where: { id: alice.id } });
  for (let i = 0; i < count; i += 1) {
    const u = await prisma.user.create({ data: { username: `user${i}`, email: `u${i}@example.com`, passwordHash } });
    await prisma.review.create({ data: { userId: u.id, placeId: place.id, rating: 3 } });
  }
}

beforeEach(async () => {
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  place = await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านทดสอบ', description: 'รายละเอียด', address: 'ลาดกระบัง' } });
  alice = await member('alice');
  bob = await member('bob');
  admin = createClient(app);
  await admin.registerAdmin();
  review = (await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'กาแฟดี' })).body.data;
});

afterAll(closeDatabase);

describe('reply cap', () => {
  test('the 51st visible reply is refused (409) and 50 are shown', async () => {
    await fill(49, bob.id, review.id);
    expect((await reply(bob, review.id, 'ที่ 50')).status).toBe(201);
    const res = await reply(bob, review.id, 'ที่ 51');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
    expect(res.body.error.message).toBe('รีวิวนี้มีความเห็นตอบกลับครบ 50 รายการแล้ว');
    const list = await createClient(app).get(`/api/v1/places/${place.id}/reviews`);
    expect(list.body.data[0].replies).toHaveLength(50);
  });

  test('the admin list returns at most 100 replies per review', async () => {
    await fill(120, bob.id, review.id);
    const res = await admin.get('/api/v1/admin/reviews');
    expect(res.status).toBe(200);
    expect(res.body.data.find((r) => r.id === review.id).replies).toHaveLength(100);
  });

  test('create still works and hidden reviews are 404', async () => {
    expect((await reply(bob, review.id)).status).toBe(201);
    expect((await reply(bob, 999999)).status).toBe(404);
    await del(alice, `/api/v1/reviews/${review.id}`);
    expect((await reply(bob, review.id)).status).toBe(404);
  });
});

describe('replies from before a rewrite', () => {
  test('an admin-removed reply of the old text does not come back under the new review', async () => {
    const r = (await reply(bob, review.id, 'ตอบรีวิวเก่า')).body.data;
    await admin.post(`/api/v1/admin/replies/${r.id}/remove`, { reason: 'เหตุผลเดิมของแอดมิน' });
    expect((await bob.get(`/places/${place.id}`)).text).toContain('เหตุผลเดิมของแอดมิน');

    await del(alice, `/api/v1/reviews/${review.id}`);
    await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 5, comment: 'เขียนใหม่' });
    const page = await bob.get(`/places/${place.id}`);
    expect(page.text).toContain('เขียนใหม่');
    expect(page.text).not.toContain('เหตุผลเดิมของแอดมิน');
    // They do not count toward the cap of the new review either.
    expect((await reply(bob, review.id, 'ตอบใหม่')).status).toBe(201);
  });
});

describe('returning to the right page', () => {
  const nextPage = (n) => `/places/${place.id}?reviewsPage=${n}#review-${review.id}`;

  test('next may carry ?reviewsPage=N; bad variants fall back to /places', async () => {
    const ok = await bob.postForm(`/reviews/${review.id}/replies`, { body: 'x', next: nextPage(2) });
    expect(ok.headers.location).toBe(nextPage(2));
    const plain = await bob.postForm(`/reviews/${review.id}/replies`, { body: 'x', next: `/places/${place.id}?reviewsPage=3` });
    expect(plain.headers.location).toBe(`/places/${place.id}?reviewsPage=3`);
    const bad = [
      `/places/${place.id}?reviewsPage=0`,
      `/places/${place.id}?reviewsPage=x`,
      `/places/${place.id}?reviewsPage=2&a=1`,
      `/places/${place.id}?other=2`,
      `/places/${place.id}#review-1?reviewsPage=2`,
    ];
    for (const next of bad) {
      const res = await bob.postForm(`/reviews/${review.id}/replies`, { body: 'x', next });
      expect(res.headers.location).toBe('/places');
    }
  });

  test('the place page on page 2 builds next with reviewsPage', async () => {
    await addReviews(12);
    const p2 = await bob.get(`/places/${place.id}?reviewsPage=2`);
    expect(p2.text).toContain(`name="next" value="/places/${place.id}?reviewsPage=2#review-`);
    const p1 = await bob.get(`/places/${place.id}`);
    expect(p1.text).not.toContain('?reviewsPage=1#review-');
  });

  test('admin removal from page 2 returns to page 2 (site-wide list and place tab)', async () => {
    await addReviews(25);
    // Alice's review is the oldest, so it is on page 2 of 26 (20 per page).
    const r = (await reply(bob, review.id)).body.data;
    const rr = await admin.postForm(`/admin/replies/${r.id}/remove`, { reason: 'x', status: 'all', page: '2' });
    expect(rr.headers.location).toBe('/admin/reviews?page=2');
    const tab = await admin.postForm(`/admin/reviews/${review.id}/remove`, { reason: 'x', status: 'all', page: '2', placeId: String(place.id) });
    expect(tab.headers.location).toBe(`/admin/places/${place.id}/reviews?page=2`);
    // A bad page falls back to 1.
    const last = await prisma.review.findFirst({ where: { status: 'active' } });
    const bad = await admin.postForm(`/admin/reviews/${last.id}/remove`, { reason: 'x', status: 'all', page: 'abc' });
    expect(bad.headers.location).toBe('/admin/reviews');
    // The forms carry the current page.
    const page = await admin.get('/admin/reviews?page=2');
    expect(page.text).toContain('name="page" value="2"');
  });

  test('a reply form on an unpublished place goes to /places, not the 404 page', async () => {
    await prisma.place.update({ where: { id: place.id }, data: { status: 'unpublished' } });
    const res = await bob.postForm(`/reviews/${review.id}/replies`, { body: 'x', next: `/places/${place.id}#review-${review.id}` });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/places');
    // A validation error still returns to the review.
    await prisma.place.update({ where: { id: place.id }, data: { status: 'published' } });
    const empty = await bob.postForm(`/reviews/${review.id}/replies`, { body: ' ', next: `/places/${place.id}#review-${review.id}` });
    expect(empty.headers.location).toBe(`/places/${place.id}#review-${review.id}`);
  });
});
