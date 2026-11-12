const request = require('supertest');
const { createApp } = require('../src/app');
const helpers = require('../src/views/helpers');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let cafe;
let market;
let latte;
let hidden;

beforeAll(async () => {
  await resetDatabase();
  cafe = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  market = await prisma.category.create({ data: { name: 'ตลาดและชุมชน' } });
  await prisma.category.create({ data: { name: 'ที่พัก' } }); // no places

  const base = { description: 'รายละเอียดของสถานที่', address: 'ถนนฉลองกรุง ลาดกระบัง' };
  latte = await prisma.place.create({
    data: {
      ...base,
      categoryId: cafe.id,
      name: 'ร้านลาเต้',
      imagePath: '/images/places/cafe.svg',
      latitude: 13.7271,
      longitude: 100.7784,
      featuredOrder: 1,
      hours: {
        create: Array.from({ length: 7 }, (unused, weekday) =>
          weekday === 0
            ? { weekday, state: 'closed' }
            : { weekday, state: 'open', opensAt: new Date('1970-01-01T08:30:00Z'), closesAt: new Date('1970-01-01T19:30:00Z') }
        ),
      },
    },
  });
  await prisma.place.create({ data: { ...base, categoryId: cafe.id, name: 'ร้านมอคค่า' } });
  await prisma.place.create({ data: { ...base, categoryId: market.id, name: 'ตลาดเช้า', description: 'ของสด 100% ทุกวัน' } });
  hidden = await prisma.place.create({ data: { ...base, categoryId: cafe.id, name: 'ร้านที่ซ่อนอยู่', status: 'unpublished', featuredOrder: 2 } });
});

afterAll(closeDatabase);

describe('home page', () => {
  test('shows categories that have places, and the featured places', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<strong>3<\/strong> สถานที่ · <strong>2<\/strong> หมวดหมู่/);
    expect(res.text).toContain(`href="/places?categoryId=${cafe.id}"`);
    expect(res.text).not.toContain('ที่พัก</span>'); // an empty category has no tile
    expect(res.text).toContain('ร้านลาเต้');
    expect(res.text).not.toContain('ร้านที่ซ่อนอยู่'); // unpublished, even though it is featured
  });
});

describe('place list', () => {
  test('lists published places only', async () => {
    const res = await request(app).get('/places');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/พบ <strong>3<\/strong> สถานที่/);
    expect(res.text).toContain('ร้านมอคค่า');
    expect(res.text).not.toContain('ร้านที่ซ่อนอยู่');
  });

  test('filters by category and by text', async () => {
    const byCategory = await request(app).get(`/places?categoryId=${market.id}`);
    expect(byCategory.text).toMatch(/พบ <strong>1<\/strong> สถานที่/);
    expect(byCategory.text).toContain('ตลาดเช้า');

    const byText = await request(app).get(`/places?q=${encodeURIComponent('ลาเต้')}`);
    expect(byText.text).toMatch(/พบ <strong>1<\/strong> สถานที่/);
    expect(byText.text).toContain('value="ลาเต้"');
  });

  test('searching for % or _ does not match everything', async () => {
    const percent = await request(app).get('/places?q=%25');
    expect(percent.text).toMatch(/พบ <strong>1<\/strong> สถานที่/); // only "100%"
    const underscore = await request(app).get('/places?q=_');
    expect(underscore.text).toMatch(/พบ <strong>0<\/strong> สถานที่/);
    expect(underscore.text).toContain('ยังไม่พบสถานที่ที่ตรงกัน');
  });

  test('a word hidden inside "เขตลาดกระบัง" does not match every address', async () => {
    await prisma.place.updateMany({ data: { address: 'ถนนฉลองกรุง แขวงลาดกระบัง เขตลาดกระบัง กรุงเทพมหานคร 10520' } });
    const market = await request(app).get(`/places?q=${encodeURIComponent('ตลาด')}`);
    expect(market.text).toMatch(/พบ <strong>1<\/strong> สถานที่/); // only the market, by name and category
    const road = await request(app).get(`/places?q=${encodeURIComponent('ฉลองกรุง')}`);
    expect(road.text).toMatch(/พบ <strong>3<\/strong> สถานที่/); // a road name still searches addresses
  });

  test('odd filter values are ignored instead of causing an error', async () => {
    for (const query of ['categoryId=abc', 'categoryId=-1', 'categoryId=99999999999', 'sort=password', 'q[]=x', `q=${'x'.repeat(500)}`]) {
      const res = await request(app).get(`/places?${query}`);
      expect(res.status).toBe(200);
    }
  });

  test('search text is escaped in the page', async () => {
    const res = await request(app).get(`/places?q=${encodeURIComponent('<script>alert(1)</script>')}`);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});

describe('place page', () => {
  test('shows the details, the week of opening hours and a directions link', async () => {
    const res = await request(app).get(`/places/${latte.id}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<h1>ร้านลาเต้</h1>');
    expect(res.text).toContain('ถนนฉลองกรุง');
    expect(res.text).toContain('08:30–19:30');
    expect(res.text).toMatch(/อาทิตย์[\s\S]*?<dd class="closed">ปิด/);
    expect(res.text).toContain('https://www.google.com/maps/dir/?api=1&amp;destination=13.7271,100.7784');
    expect(res.text).toContain('ร้านมอคค่า'); // another place in the same category
  });

  test('a place without a pin gets a search link and unknown hours, never "closed"', async () => {
    const place = await prisma.place.findFirst({ where: { name: 'ร้านมอคค่า' } });
    await prisma.placeHours.createMany({ data: Array.from({ length: 7 }, (unused, weekday) => ({ placeId: place.id, weekday })) });
    const res = await request(app).get(`/places/${place.id}`);
    expect(res.text).toContain('https://www.google.com/maps/search/?api=1&amp;query=');
    expect(res.text).toContain('สถานที่นี้ยังไม่มีหมุดบนแผนที่');
    expect(res.text).toContain('ยังไม่ระบุ');
    expect(res.text).not.toContain('<dd class="closed">');
  });

  test('an unpublished or unknown place is a 404', async () => {
    for (const id of [hidden.id, 999999, 'abc', '1e3', '0']) {
      const res = await request(app).get(`/places/${id}`);
      expect(res.status).toBe(404);
    }
  });

  test('"random" goes to a published place, optionally within a category', async () => {
    const publishedIds = [latte.id, latte.id + 1, latte.id + 2];
    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).get('/places/random');
      expect(res.status).toBe(302);
      expect(publishedIds.map((id) => `/places/${id}`)).toContain(res.headers.location);
    }
    const inMarket = await request(app).get(`/places/random?categoryId=${market.id}`);
    expect(inMarket.headers.location).toBe(`/places/${latte.id + 2}`);
  });
});

describe('pages that are in the menu but not built yet', () => {
  test('member pages still require a login', async () => {
    for (const path of ['/me/favorites', '/me/reviews', '/me/submissions', '/submissions/new']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`/login?next=${encodeURIComponent(path)}`);
    }
    const client = createClient(app);
    await client.register();
    expect((await client.get('/me/favorites')).status).toBe(200);
  });
});

describe('layout', () => {
  test('the header marks the current page and shows the member menu after login', async () => {
    const visitor = await request(app).get('/places');
    expect(visitor.text).toContain('<a href="/places" aria-current="page">สำรวจ</a>');
    expect(visitor.text).toContain('เข้าสู่ระบบ');
    expect(visitor.text).not.toContain('คำขอของฉัน');

    const client = createClient(app);
    await client.register({ email: 'menu@example.com' });
    const member = await client.get('/');
    expect(member.text).toContain('คำขอของฉัน');
    expect(member.text).toContain('แนะนำสถานที่');
  });

  test('fonts are served from this site', async () => {
    const res = await request(app).get('/fonts/text/ibm-plex-sans-thai-looped-thai-400-normal.woff2');
    expect(res.status).toBe(200);
    expect((await request(app).get('/fonts/text/missing.woff2')).status).toBe(404);
  });
});

describe('view helpers', () => {
  test('an unknown icon or category falls back instead of failing', () => {
    expect(helpers.icon('no-such-icon')).toContain('<svg');
    expect(helpers.categoryKind({ name: 'หมวดใหม่' })).toBe('other');
    expect(helpers.categoryIcon(undefined)).toBe('pin');
  });

  test('a place with no reviews shows no number', () => {
    expect(helpers.rating(null)).toBe('ยังไม่มีคะแนน');
    expect(helpers.rating('4.5')).toBe('4.50');
  });
});
