// Admin review search ("ดูแลรีวิว"): words in the review, reviewer name,
// place name, star rating and sort order, on the page and the API.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let admin;
let cafe;
let noodle;

async function member(name) {
  const client = createClient(app);
  await client.register({ username: name, email: `${name}@example.com` });
  return client;
}

async function review(client, placeId, rating, comment) {
  const res = await client.post(`/api/v1/places/${placeId}/reviews`, { rating, comment });
  expect(res.status).toBe(201);
  return res.body.data;
}

const comments = (res) => res.body.data.map((item) => item.comment);

beforeEach(async () => {
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'ร้านอาหาร' } });
  const make = (name) => prisma.place.create({ data: { categoryId: category.id, name, description: 'd', address: 'ลาดกระบัง' } });
  cafe = await make('Cafe Amazon สาขาพระจอม');
  noodle = await make('ก๋วยเตี๋ยวเรือป้าแดง');
  admin = createClient(app);
  await admin.registerAdmin();
  const alice = await member('Alice');
  const bob = await member('bob_99');
  await review(alice, cafe.id, 5, 'กาแฟอร่อย บรรยากาศดี');
  await review(bob, cafe.id, 1, 'กาแฟจืด รอนานมาก');
  await review(alice, noodle.id, 3, 'เส้นเหนียว 100% แต่น้ำซุปดี');
});

afterAll(closeDatabase);

describe('GET /api/v1/admin/reviews search', () => {
  test('q finds words in the comment, ignoring case', async () => {
    expect(comments(await admin.get('/api/v1/admin/reviews?q=' + encodeURIComponent('กาแฟ'))).sort()).toEqual(['กาแฟจืด รอนานมาก', 'กาแฟอร่อย บรรยากาศดี']);
    expect(comments(await admin.get('/api/v1/admin/reviews?q=' + encodeURIComponent('ซุป')))).toEqual(['เส้นเหนียว 100% แต่น้ำซุปดี']);
  });

  test('% and _ are plain characters, not wildcards', async () => {
    expect(comments(await admin.get('/api/v1/admin/reviews?q=' + encodeURIComponent('100%')))).toHaveLength(1);
    expect((await admin.get('/api/v1/admin/reviews?q=' + encodeURIComponent('%'))).body.meta.total).toBe(1);
    expect((await admin.get('/api/v1/admin/reviews?user=_')).body.meta.total).toBe(1); // only bob_99
  });

  test('user matches part of the username, ignoring case', async () => {
    const res = await admin.get('/api/v1/admin/reviews?user=ALI');
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data.every((item) => item.user.username === 'Alice')).toBe(true);
  });

  test('place matches part of the place name', async () => {
    const res = await admin.get('/api/v1/admin/reviews?place=' + encodeURIComponent('amazon'));
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data.every((item) => item.place.id === cafe.id)).toBe(true);
  });

  test('rating is an exact star count; anything else is ignored', async () => {
    expect(comments(await admin.get('/api/v1/admin/reviews?rating=1'))).toEqual(['กาแฟจืด รอนานมาก']);
    for (const odd of ['0', '6', '2.5', 'abc']) expect((await admin.get(`/api/v1/admin/reviews?rating=${odd}`)).body.meta.total).toBe(3);
  });

  test('filters combine', async () => {
    const res = await admin.get('/api/v1/admin/reviews?user=alice&place=' + encodeURIComponent('ก๋วยเตี๋ยว') + '&rating=3');
    expect(comments(res)).toEqual(['เส้นเหนียว 100% แต่น้ำซุปดี']);
    expect((await admin.get('/api/v1/admin/reviews?user=bob&rating=5')).body.meta.total).toBe(0);
  });

  test('sort orders by date or by rating; unknown sorts fall back to newest', async () => {
    const ratings = async (sort) => (await admin.get(`/api/v1/admin/reviews?sort=${sort}`)).body.data.map((item) => item.rating);
    expect(await ratings('lowest')).toEqual([1, 3, 5]);
    expect(await ratings('highest')).toEqual([5, 3, 1]);
    expect(await ratings('oldest')).toEqual([5, 1, 3]);
    expect(await ratings('newest')).toEqual([3, 1, 5]);
    expect(await ratings('nonsense')).toEqual([3, 1, 5]);
  });

  test('members cannot search', async () => {
    const carol = await member('carol');
    expect((await carol.get('/api/v1/admin/reviews?q=x')).status).toBe(403);
  });
});

describe('the ดูแลรีวิว page', () => {
  test('shows the search form, keeps the values and lists only matches', async () => {
    const res = await admin.get('/admin/reviews?q=' + encodeURIComponent('กาแฟ') + '&rating=1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="q"');
    expect(res.text).toContain('value="กาแฟ"');
    expect(res.text).toContain('<option value="1" selected');
    expect(res.text).toContain('กาแฟจืด รอนานมาก');
    expect(res.text).not.toContain('กาแฟอร่อย บรรยากาศดี');
    expect(res.text).toContain('1 รีวิว ที่ตรงกับการค้นหา');
    expect(res.text).toContain('ล้างการค้นหา');
  });

  test('no match says so', async () => {
    const res = await admin.get('/admin/reviews?q=zzzz');
    expect(res.text).toContain('ไม่พบรีวิวที่ตรงกับการค้นหา');
  });

  test('status tabs keep the search', async () => {
    const res = await admin.get('/admin/reviews?user=alice');
    expect(res.text).toContain('href="/admin/reviews?status=active&amp;user=alice"');
  });

  test("a place's reviews tab has no place-name field and ignores ?place=", async () => {
    const res = await admin.get(`/admin/places/${cafe.id}/reviews?place=` + encodeURIComponent('ก๋วยเตี๋ยว'));
    expect(res.text).not.toContain('name="place"');
    expect(res.text).toContain('กาแฟจืด รอนานมาก');
  });

  test('removing a review returns to the same search', async () => {
    const target = (await admin.get('/api/v1/admin/reviews?rating=1')).body.data[0];
    const res = await admin.postForm(`/admin/reviews/${target.id}/remove`, { reason: 'ไม่เหมาะสม', status: 'all', page: '1', q: 'กาแฟ', rating: '1' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/reviews?q=%E0%B8%81%E0%B8%B2%E0%B9%81%E0%B8%9F&rating=1');
    expect((await prisma.review.findUnique({ where: { id: target.id } })).status).toBe('removed');
  });

  test('control characters in the search are dropped', async () => {
    const res = await admin.get('/api/v1/admin/reviews?q=%E0%B8%81%E0%B8%B2%01%E0%B9%81%E0%B8%9F');
    expect(res.body.meta.total).toBe(2);
  });
});
