// Admin shortcuts on the public place page: the admin bar, "ดูสมาชิก" links,
// and removing a review or reply without leaving the page.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let admin;
let place;
let reviewer;
let replier;
let review;
let reply;

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

const placeUrl = () => `/places/${place.id}`;

beforeEach(async () => {
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  place = await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านกาแฟริมคลอง', description: 'd', address: 'ลาดกระบัง' } });
  admin = createClient(app);
  await admin.registerAdmin();
  reviewer = await member('reviewer');
  replier = await member('replier');
  review = (await reviewer.post(`/api/v1/places/${place.id}/reviews`, { rating: 1, comment: 'รีวิวที่ต้องนำออก' })).body.data;
  reply = (await replier.post(`/api/v1/reviews/${review.id}/replies`, { body: 'ความเห็นที่ต้องนำออก' })).body.data;
});
afterAll(closeDatabase);

describe('what each viewer sees', () => {
  test('an admin gets the bar, member links and remove forms; members and visitors get none', async () => {
    const page = await admin.get(placeUrl());
    expect(page.status).toBe(200);
    expect(page.text).toContain('class="place-admin-bar"');
    for (const tab of ['edit', 'photos', 'reviews', 'reports']) expect(page.text).toContain(`href="/admin/places/${place.id}/${tab}"`);
    expect(page.text).toContain(`href="/admin/users/${reviewer.id}"`);
    expect(page.text).toContain(`href="/admin/users/${replier.id}"`);
    expect(page.text).toContain(`action="/admin/reviews/${review.id}/remove"`);
    expect(page.text).toContain(`action="/admin/replies/${reply.id}/remove"`);
    // The admin acts directly, so the member report buttons are not shown to them.
    expect(page.text).not.toContain('รายงานรีวิวนี้');
    expect(page.text).not.toContain(`/replies/${reply.id}/reports"`);

    for (const viewer of [reviewer, replier, createClient(app)]) {
      const text = (await viewer.get(placeUrl())).text;
      expect(text).not.toContain('place-admin-bar');
      expect(text).not.toContain('/admin/users/');
      expect(text).not.toContain('/admin/reviews/');
      expect(text).not.toContain('/admin/replies/');
    }
  });

  test('open report counts show on the bar, the review and the reply', async () => {
    let page = await admin.get(placeUrl());
    expect(page.text).not.toContain('ถูกรายงาน');
    expect(page.text).not.toContain('รอตรวจ');

    const other = await member('other');
    await other.post(`/api/v1/places/${place.id}/reports`, { reason: 'closed' });
    await other.post(`/api/v1/reviews/${review.id}/reports`, { reason: 'spam' });
    await other.post(`/api/v1/replies/${reply.id}/reports`, { reason: 'offensive' });
    await reviewer.post(`/api/v1/replies/${reply.id}/reports`, { reason: 'spam' });

    page = await admin.get(placeUrl());
    expect(page.text).toContain('1 รอตรวจ');
    expect(page.text).toContain('ถูกรายงาน 1 ครั้ง');
    expect(page.text).toContain('ถูกรายงาน 2 ครั้ง');
    expect(page.text).toContain(`href="/admin/places/${place.id}/reviews?status=reported"`);
  });

  test('an admin gets no remove tools on their own review', async () => {
    const own = (await admin.post(`/api/v1/places/${place.id}/reviews`, { rating: 5, comment: 'รีวิวของผู้ดูแล' })).body.data;
    const page = await admin.get(placeUrl());
    expect(page.text).not.toContain(`/admin/reviews/${own.id}/remove`);
    expect(page.text).toContain(`/admin/reviews/${review.id}/remove`);
  });
});

describe('removing from the place page', () => {
  test('a review: removed with the reason, rating recalculated, back on the place page', async () => {
    const res = await admin.postForm(`/admin/reviews/${review.id}/remove`, { reason: 'สแปม', next: `/places/${place.id}#review-${review.id}` });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/places/${place.id}#reviews`);
    const row = await prisma.review.findUnique({ where: { id: review.id } });
    expect(row).toMatchObject({ status: 'removed', removedReason: 'สแปม', removedById: admin.id });
    expect((await prisma.place.findUnique({ where: { id: place.id } })).ratingCount).toBe(0);
    const page = await admin.get(placeUrl());
    expect(page.text).toContain('นำรีวิวออกแล้ว');
    expect(page.text).not.toContain('รีวิวที่ต้องนำออก');
  });

  test('a reply: removed, its reports resolved, back on the review it was under', async () => {
    await reviewer.post(`/api/v1/replies/${reply.id}/reports`, { reason: 'spam' });
    const next = `/places/${place.id}?reviewsPage=2#review-${review.id}`;
    const res = await admin.postForm(`/admin/replies/${reply.id}/remove`, { reason: 'ไม่สุภาพ', next });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(next);
    expect((await prisma.reviewReply.findUnique({ where: { id: reply.id } })).status).toBe('removed');
    expect((await prisma.replyReport.findFirst()).status).toBe('resolved');
    expect((await admin.get(placeUrl())).text).not.toContain('ความเห็นที่ต้องนำออก');
  });

  test('a missing reason keeps the item and shows the error on the place page', async () => {
    const res = await admin.postForm(`/admin/reviews/${review.id}/remove`, { reason: '  ', next: `/places/${place.id}#review-${review.id}` });
    expect(res.headers.location).toBe(`/places/${place.id}#reviews`);
    expect((await prisma.review.findUnique({ where: { id: review.id } })).status).toBe('active');
  });

  test('an unsafe or malformed next falls back to the admin list', async () => {
    for (const next of ['https://evil.example/', '//evil.example', `/places/${place.id}/../admin`, '/admin/users']) {
      const res = await admin.postForm(`/admin/replies/${reply.id}/remove`, { reason: 'x', next });
      expect(res.headers.location).toBe('/admin/reviews');
    }
  });

  test('members still cannot use the admin remove routes', async () => {
    const res = await reviewer.postForm(`/admin/replies/${reply.id}/remove`, { reason: 'x', next: placeUrl() });
    expect(res.status).toBe(403);
    expect((await prisma.reviewReply.findUnique({ where: { id: reply.id } })).status).toBe('active');
  });
});
