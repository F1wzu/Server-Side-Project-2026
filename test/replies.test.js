// Replies under a review: any member replies, one level deep; authors edit
// and delete their own; admins remove any with a reason.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let place;
let alice; // writes the review
let bob; // replies
let carol; // another member
let admin;
let review;

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

const del = async (client, path) => client.agent.delete(path).set('X-CSRF-Token', await client.csrfToken());
const reply = async (client, reviewId, body = 'ขอบคุณสำหรับรีวิวครับ') => client.post(`/api/v1/reviews/${reviewId}/replies`, { body });
const next = () => `/places/${place.id}#review-${review.id}`;

beforeEach(async () => {
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  place = await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านทดสอบ', description: 'รายละเอียด', address: 'ลาดกระบัง' } });
  alice = await member('alice');
  bob = await member('bob');
  carol = await member('carol');
  admin = createClient(app);
  await admin.registerAdmin();
  review = (await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'กาแฟดี' })).body.data;
});

afterAll(closeDatabase);

describe('writing a reply', () => {
  test('a member replies through the API (201) and it shows under the review in the public API', async () => {
    const res = await reply(bob, review.id);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ reviewId: review.id, body: 'ขอบคุณสำหรับรีวิวครับ', status: 'active', user: { username: 'bob' } });
    expect(res.body.data).not.toHaveProperty('removedById');

    await reply(alice, review.id, 'ยินดีครับ'); // the review's author may answer too
    const list = await createClient(app).get(`/api/v1/places/${place.id}/reviews`);
    expect(list.body.data[0].replies.map((r) => r.body)).toEqual(['ขอบคุณสำหรับรีวิวครับ', 'ยินดีครับ']);
    expect(list.body.data[0].replies[0]).not.toHaveProperty('removedById');
  });

  test('the form posts back to the review on the place page, which shows the reply', async () => {
    const res = await bob.postForm(`/reviews/${review.id}/replies`, { body: 'ไปมาแล้วเหมือนกัน', next: next() });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(next());
    const page = await bob.get(`/places/${place.id}`);
    expect(page.text).toContain('ไปมาแล้วเหมือนกัน');
    expect(page.text).toContain('ตอบกลับรีวิวแล้ว');
    expect(page.text).toContain(`id="review-${review.id}"`);
  });

  test('an unsafe next falls back to /places', async () => {
    for (const bad of ['https://evil.example', '//evil.example', `/places/${place.id}#review-01`, '/admin', `/places/${place.id}/../x`]) {
      const res = await bob.postForm(`/reviews/${review.id}/replies`, { body: 'x', next: bad });
      expect(res.headers.location).toBe('/places');
    }
  });

  test('visitors get 401 or the login page; a missing CSRF token is 403', async () => {
    const visitor = createClient(app);
    expect((await reply(visitor, review.id)).status).toBe(401);
    const form = await visitor.postForm(`/reviews/${review.id}/replies`, { body: 'x' });
    expect(form.headers.location).toMatch(/^\/login/);
    const noToken = await bob.agent.post(`/api/v1/reviews/${review.id}/replies`).send({ body: 'x' });
    expect(noToken.status).toBe(403);
    expect(await prisma.reviewReply.count()).toBe(0);
  });

  test('the body is required, visible, at most 1000 characters (400)', async () => {
    for (const body of [undefined, '', '   ', '​​', 'x'.repeat(1001), 5]) {
      const res = await bob.post(`/api/v1/reviews/${review.id}/replies`, { body });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await reply(bob, review.id, `  ${'ก'.repeat(1000)}  `)).status).toBe(201);
  });

  test('replying to a hidden or unknown review is 404', async () => {
    expect((await reply(bob, 99999)).status).toBe(404);
    expect((await bob.post('/api/v1/reviews/abc/replies', { body: 'x' })).status).toBe(404);

    await prisma.place.update({ where: { id: place.id }, data: { status: 'unpublished' } });
    expect((await reply(bob, review.id)).status).toBe(404);
    await prisma.place.update({ where: { id: place.id }, data: { status: 'published' } });

    await del(alice, `/api/v1/reviews/${review.id}`);
    expect((await reply(bob, review.id)).status).toBe(404);
  });

  test('replies to a removed review disappear with it', async () => {
    await reply(bob, review.id, 'ตอบไว้ก่อน');
    await admin.post(`/api/v1/admin/reviews/${review.id}/remove`, { reason: 'ผิดกฎ' });
    expect((await createClient(app).get(`/places/${place.id}`)).text).not.toContain('ตอบไว้ก่อน');
    expect((await reply(carol, review.id)).status).toBe(404);
  });

  test('when the author deletes and writes again, the old replies do not carry over', async () => {
    await reply(bob, review.id, 'ตอบรีวิวเก่า');
    await del(alice, `/api/v1/reviews/${review.id}`);
    const again = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 2, comment: 'รีวิวใหม่' });
    expect(again.body.data.id).toBe(review.id); // the same row is reused
    const list = await createClient(app).get(`/api/v1/places/${place.id}/reviews`);
    expect(list.body.data[0].replies).toEqual([]);
  });
});

describe('editing and deleting your own reply', () => {
  test('the author edits (200) and deletes (204); others get 404', async () => {
    const r = (await reply(bob, review.id)).body.data;
    expect((await carol.patch(`/api/v1/replies/${r.id}`, { body: 'แก้ของคนอื่น' })).status).toBe(404);
    expect((await del(carol, `/api/v1/replies/${r.id}`)).status).toBe(404);

    const edited = await bob.patch(`/api/v1/replies/${r.id}`, { body: '  แก้แล้ว  ' });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({ id: r.id, body: 'แก้แล้ว' });
    expect((await bob.patch(`/api/v1/replies/${r.id}`, { body: '' })).status).toBe(400);

    expect((await del(bob, `/api/v1/replies/${r.id}`)).status).toBe(204);
    expect((await prisma.reviewReply.findUnique({ where: { id: r.id } })).status).toBe('deleted');
    expect((await bob.patch(`/api/v1/replies/${r.id}`, { body: 'x' })).status).toBe(404);
    expect((await del(bob, `/api/v1/replies/${r.id}`)).status).toBe(404);
    const list = await createClient(app).get(`/api/v1/places/${place.id}/reviews`);
    expect(list.body.data[0].replies).toEqual([]);
  });

  test('the place page offers edit and delete only on your own replies, and the forms come back', async () => {
    const r = (await reply(bob, review.id, 'ของบ็อบ')).body.data;
    expect((await bob.get(`/places/${place.id}`)).text).toContain(`action="/replies/${r.id}/edit"`);
    expect((await carol.get(`/places/${place.id}`)).text).not.toContain(`action="/replies/${r.id}/edit"`);
    expect((await createClient(app).get(`/places/${place.id}`)).text).not.toContain(`/reviews/${review.id}/replies`);

    const edit = await bob.postForm(`/replies/${r.id}/edit`, { body: 'แก้จากหน้าเว็บ', next: next() });
    expect(edit.headers.location).toBe(next());
    expect((await bob.get(`/places/${place.id}`)).text).toContain('แก้จากหน้าเว็บ');

    const wrong = await carol.postForm(`/replies/${r.id}/delete`, { next: next() });
    expect(wrong.headers.location).toBe(next());
    expect((await carol.get(`/places/${place.id}`)).text).toContain('ไม่พบความเห็นตอบกลับนี้');

    await bob.postForm(`/replies/${r.id}/delete`, { next: next() });
    expect((await createClient(app).get(`/places/${place.id}`)).text).not.toContain('แก้จากหน้าเว็บ');
  });

  test('replies to your own review show inside the "your review" panel', async () => {
    await reply(bob, review.id, 'ตอบรีวิวของอลิซ');
    const page = await alice.get(`/places/${place.id}`);
    const panel = page.text.slice(page.text.indexOf('id="own-review"'));
    expect(panel).toContain('ตอบรีวิวของอลิซ');
  });
});

describe('admin removal', () => {
  test('an admin removes a reply with a reason; only its author sees the reason', async () => {
    const r = (await reply(bob, review.id, 'ข้อความไม่เหมาะสม')).body.data;
    const res = await admin.post(`/api/v1/admin/replies/${r.id}/remove`, { reason: '  ภาษาไม่สุภาพ  ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: r.id, status: 'removed', removedReason: 'ภาษาไม่สุภาพ' });
    expect(res.body.data).not.toHaveProperty('removedById');
    expect(await prisma.reviewReply.findUnique({ where: { id: r.id } })).toMatchObject({ removedById: admin.id });

    const own = await bob.get(`/places/${place.id}`);
    expect(own.text).toContain('ภาษาไม่สุภาพ');
    expect(own.text).not.toContain(`action="/replies/${r.id}/edit"`);
    for (const viewer of [carol, createClient(app)]) {
      const page = await viewer.get(`/places/${place.id}`);
      expect(page.text).not.toContain('ข้อความไม่เหมาะสม');
      expect(page.text).not.toContain('ภาษาไม่สุภาพ');
    }
    expect((await bob.patch(`/api/v1/replies/${r.id}`, { body: 'x' })).status).toBe(404);
  });

  test('a reason is required; twice is 409; unknown is 404; members get 403', async () => {
    const r = (await reply(bob, review.id)).body.data;
    expect((await admin.post(`/api/v1/admin/replies/${r.id}/remove`, { reason: ' ' })).status).toBe(400);
    expect((await carol.post(`/api/v1/admin/replies/${r.id}/remove`, { reason: 'x' })).status).toBe(403);
    expect((await admin.post(`/api/v1/admin/replies/${r.id}/remove`, { reason: 'x' })).status).toBe(200);
    const twice = await admin.post(`/api/v1/admin/replies/${r.id}/remove`, { reason: 'x' });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('INVALID_STATE');
    expect((await admin.post('/api/v1/admin/replies/99999/remove', { reason: 'x' })).status).toBe(404);
  });

  test('the admin review pages list replies with a remove form that returns to the same page', async () => {
    const r = (await reply(bob, review.id, 'ความเห็นสำหรับแอดมิน')).body.data;
    const all = await admin.get('/admin/reviews');
    expect(all.text).toContain('ความเห็นสำหรับแอดมิน');
    expect(all.text).toContain(`/admin/replies/${r.id}/remove`);
    const api = await admin.get('/api/v1/admin/reviews');
    expect(api.body.data[0].replies.map((x) => x.id)).toEqual([r.id]);

    const tab = await admin.get(`/admin/places/${place.id}/reviews`);
    expect(tab.text).toContain('ความเห็นสำหรับแอดมิน');
    const res = await admin.postForm(`/admin/replies/${r.id}/remove`, { reason: 'สแปม', status: 'all', placeId: String(place.id) });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/admin/places/${place.id}/reviews`);
    expect((await admin.get(`/admin/places/${place.id}/reviews`)).text).toContain('นำความเห็นตอบกลับออกแล้ว');
  });
});

describe('the database', () => {
  test('a removed reply must record who and why; a blank body is refused', async () => {
    const r = (await reply(bob, review.id)).body.data;
    await expect(prisma.reviewReply.update({ where: { id: r.id }, data: { status: 'removed' } })).rejects.toThrow(/review_replies_removed_check/);
    await expect(prisma.reviewReply.create({ data: { reviewId: review.id, userId: bob.id, body: '   ' } })).rejects.toThrow(/review_replies_body_not_blank_check/);
  });
});
