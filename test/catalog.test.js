// Step 3: open now, pagination, the map, phone and link, and the public API.
const request = require('supertest');
const { createApp } = require('../src/app');
const placeModel = require('../src/models/place');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');

const app = createApp();
const api = (path) => request(app).get(`/api/v1${path}`);

const time = (hhmm) => new Date(`1970-01-01T${hhmm}:00Z`);
const closedWeek = () => Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'closed' }));
// A moment given as Bangkok wall-clock time. 2026-11-15 is a Sunday (weekday 0).
const at = (weekday, hhmm) => new Date(`2026-11-${15 + weekday}T${hhmm}:00+07:00`);

let cafe;
let market;
let empty;
let allDay;
let shut;
let overnight;
let hidden;
let topRated;

beforeAll(async () => {
  await resetDatabase();
  cafe = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  market = await prisma.category.create({ data: { name: 'ตลาดและชุมชน' } });
  empty = await prisma.category.create({ data: { name: 'ที่พัก' } });
  const base = { description: 'รายละเอียดของสถานที่', address: 'ถนนฉลองกรุง' };

  // Open around the clock, with a pin, a phone number and a link.
  allDay = await prisma.place.create({
    data: {
      ...base,
      categoryId: cafe.id,
      name: 'ก เปิดทั้งวัน',
      latitude: 13.7271,
      longitude: 100.7784,
      phone: '02-123-4567',
      websiteUrl: 'https://example.com/cafe',
      featuredOrder: 2,
      hours: { create: Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'open', opensAt: time('00:00'), closesAt: time('00:00'), closesNextDay: true })) },
    },
  });
  shut = await prisma.place.create({
    data: { ...base, categoryId: cafe.id, name: 'ข ปิดทุกวัน', latitude: 13.7281, longitude: 100.7784, featuredOrder: 1, hours: { create: closedWeek() } },
  });
  // Friday 18:00 to Saturday 02:00, closed on every other day.
  overnight = await prisma.place.create({
    data: {
      ...base,
      categoryId: market.id,
      name: 'ค ข้ามคืนวันศุกร์',
      latitude: 13.9,
      longitude: 100.9, // far away
      hours: { create: closedWeek().map((day) => (day.weekday === 5 ? { weekday: 5, state: 'open', opensAt: time('18:00'), closesAt: time('02:00'), closesNextDay: true } : day)) },
    },
  });
  topRated = await prisma.place.create({ data: { ...base, categoryId: market.id, name: 'ง คะแนนสูง', ratingAvg: 4.5, ratingCount: 5 } });
  await prisma.place.create({ data: { ...base, categoryId: market.id, name: 'จ รีวิวน้อย', ratingAvg: 5, ratingCount: 2 } });
  hidden = await prisma.place.create({ data: { ...base, categoryId: cafe.id, name: 'ซ่อนอยู่', status: 'unpublished', latitude: 13.7272, longitude: 100.7785, ratingAvg: 5, ratingCount: 9, featuredOrder: 3 } });
  // Nine more with unknown hours: 14 published places in total, so the list has two pages.
  await prisma.place.createMany({ data: Array.from({ length: 9 }, (unused, i) => ({ ...base, categoryId: cafe.id, name: `ฮ ร้านที่ ${i + 1}` })) });
});

afterAll(closeDatabase);

describe('open now', () => {
  test('the list filter keeps only places that are open at this moment', async () => {
    const res = await api('/places?openNow=true');
    expect(res.status).toBe(200);
    expect(res.body.data.map((place) => place.name)).toContain('ก เปิดทั้งวัน');
    expect(res.body.data.map((place) => place.name)).not.toContain('ข ปิดทุกวัน');
    // places with unknown hours are never claimed to be open
    expect(res.body.data.every((place) => place.openStatus.state === 'open')).toBe(true);
  });

  test('each place reports open, closed or unknown', async () => {
    const { body } = await api('/places?pageSize=50');
    const state = (name) => body.data.find((place) => place.name === name).openStatus.state;
    expect(state('ก เปิดทั้งวัน')).toBe('open');
    expect(state('ข ปิดทุกวัน')).toBe('closed');
    expect(state('ง คะแนนสูง')).toBe('unknown');
  });

  test.each([
    ['Friday 17:59, before it opens', at(5, '17:59'), false],
    ['Friday 18:00, opening time', at(5, '18:00'), true],
    ['Friday 23:30', at(5, '23:30'), true],
    ['Saturday 01:59, after midnight', at(6, '01:59'), true],
    ['Saturday 02:00, closing time', at(6, '02:00'), false],
    ['Saturday 19:00, a closed day', at(6, '19:00'), false],
    ['Thursday 01:00, no overnight row before it', at(4, '01:00'), false],
  ])('a place that closes after midnight: %s', async (label, now, expected) => {
    const { data } = await placeModel.list({ openNow: true, pageSize: 50 }, now);
    expect(data.some((place) => place.id === overnight.id)).toBe(expected);
    // The database filter and the badge always agree.
    const all = await placeModel.list({ pageSize: 50 }, now);
    const openByBadge = all.data.filter((place) => place.openStatus.state === 'open').map((place) => place.id).sort();
    expect(data.map((place) => place.id).sort()).toEqual(openByBadge);
  });

  test('the page shows the badge and the filter', async () => {
    const res = await request(app).get('/places?openNow=true');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ที่เปิดอยู่ตอนนี้');
    expect(res.text).toContain('ก เปิดทั้งวัน');
    expect(res.text).toMatch(/open-badge is-open/);
    expect(res.text).toMatch(/name="openNow" value="true" checked/);
  });

  test('the home page shows what is open now', async () => {
    const res = await request(app).get('/');
    expect(res.text).toContain('id="open-heading"');
    expect(res.text).toContain('ก เปิดทั้งวัน');
  });
});

describe('pagination', () => {
  test('the API returns 12 per page by default, with the totals', async () => {
    const first = await api('/places');
    expect(first.body.meta).toEqual({ page: 1, pageSize: 12, total: 14 });
    expect(first.body.data).toHaveLength(12);

    const second = await api('/places?page=2');
    expect(second.body.data).toHaveLength(2);
    const ids = [...first.body.data, ...second.body.data].map((place) => place.id);
    expect(new Set(ids).size).toBe(14); // no place twice, none missing
  });

  test('a page past the end is an empty list, not an error', async () => {
    const res = await api('/places?page=9999');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(14);
  });

  test.each(['page=0', 'page=-1', 'page=abc', 'page=1.5', 'pageSize=0', 'pageSize=1000', 'sort=password', 'categoryId=abc', 'openNow=yes', `q=${'x'.repeat(101)}`])(
    'the API refuses %s with 400',
    async (query) => {
      const res = await api(`/places?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.length).toBeGreaterThan(0);
    }
  );

  test.each(['page=0', 'page=9999', 'page=abc', 'pageSize=1000', 'pageSize=0', 'sort=password', 'categoryId=abc', 'openNow=yes'])(
    'the page handles %s without an error page',
    async (query) => {
      const res = await request(app).get(`/places?${query}`);
      expect(res.status).toBe(200);
      expect(res.text).toMatch(/พบ <strong>14<\/strong> สถานที่/);
    }
  );

  test('the page shows page links that keep the current search', async () => {
    const first = await request(app).get(`/places?categoryId=${cafe.id}&sort=newest&pageSize=5`);
    expect(first.text).toContain('หน้า 1 จาก 3');
    expect(first.text).toContain(`href="/places?categoryId=${cafe.id}&amp;sort=newest&amp;page=2"`);
    expect(first.text).not.toContain('rel="prev"');

    const last = await request(app).get('/places?page=9999');
    expect(last.text).toContain('หน้า 2 จาก 2'); // shows the last page instead of nothing
    expect(last.text).not.toContain('rel="next"');
  });
});

describe('public API', () => {
  test('categories come with the number of published places', async () => {
    const res = await api('/categories');
    expect(res.status).toBe(200);
    const count = (id) => res.body.data.find((category) => category.id === id).placeCount;
    expect(count(cafe.id)).toBe(11); // the unpublished one is not counted
    expect(count(market.id)).toBe(3);
    expect(count(empty.id)).toBe(0);
  });

  test('a place has plain numbers, its category, and no internal fields', async () => {
    const { body } = await api(`/places/${allDay.id}`);
    expect(body.data).toMatchObject({
      id: allDay.id,
      name: 'ก เปิดทั้งวัน',
      latitude: 13.7271,
      longitude: 100.7784,
      phone: '02-123-4567',
      websiteUrl: 'https://example.com/cafe',
      ratingAvg: null,
      ratingCount: 0,
      category: { id: cafe.id, name: 'คาเฟ่' },
      openStatus: { state: 'open' },
    });
    expect(body.data.hours).toHaveLength(7);
    expect(body.data.hours[0]).toEqual({ weekday: 0, state: 'open', opensAt: '00:00', closesAt: '00:00', closesNextDay: true });
    for (const internal of ['status', 'createdById', 'featuredOrder', 'updatedAt']) expect(body.data).not.toHaveProperty(internal);
  });

  test('an unpublished or unknown place is 404 everywhere', async () => {
    for (const path of [`/places/${hidden.id}`, `/places/${hidden.id}/related`, '/places/999999', '/places/abc', '/places/1e3', '/places/0']) {
      const res = await api(path);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    }
  });

  test('no list ever contains an unpublished place', async () => {
    const lists = await Promise.all([api('/places?pageSize=50'), api('/places/map'), api('/recommendations'), api(`/places/${allDay.id}/related`), api('/places?q=ซ่อน')]);
    for (const res of lists) expect(JSON.stringify(res.body)).not.toContain('ซ่อนอยู่');
  });

  test('sorting by rating puts rated places first and unrated ones last', async () => {
    const { body } = await api('/places?sort=rating&pageSize=50');
    expect(body.data.slice(0, 2).map((place) => place.name)).toEqual(['จ รีวิวน้อย', 'ง คะแนนสูง']);
    expect(body.data.at(-1).ratingAvg).toBeNull();
  });

  test('the map lists only places that have a pin', async () => {
    const { body } = await api('/places/map');
    expect(body.data.map((place) => place.id).sort()).toEqual([allDay.id, shut.id, overnight.id].sort());
    expect(Object.keys(body.data[0]).sort()).toEqual(['category', 'id', 'latitude', 'longitude', 'name', 'openStatus']);
  });

  test('random returns one published place, and 404 when nothing matches', async () => {
    const res = await api(`/places/random?categoryId=${market.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.category.id).toBe(market.id);
    expect((await api(`/places/random?categoryId=${empty.id}`)).status).toBe(404);
    expect((await api('/places/random?categoryId=abc')).status).toBe(400);
  });

  test('related places: same category, and nearby ones nearest first', async () => {
    const { body } = await api(`/places/${allDay.id}/related`);
    expect(body.data.sameCategory.length).toBe(3);
    expect(body.data.sameCategory.every((place) => place.category.id === cafe.id && place.id !== allDay.id)).toBe(true);
    // 'ข ปิดทุกวัน' is about 110 m north; the far-away place is left out.
    expect(body.data.nearby.map((place) => place.id)).toEqual([shut.id]);
    expect(body.data.nearby[0].distanceKm).toBeGreaterThan(0.1);
    expect(body.data.nearby[0].distanceKm).toBeLessThan(0.12);
  });

  test('a place without a pin has no nearby list', async () => {
    const { body } = await api(`/places/${topRated.id}/related`);
    expect(body.data.nearby).toEqual([]);
  });

  test('recommendations: featured in the admin\'s order, top rated needs three reviews', async () => {
    const { body } = await api('/recommendations');
    expect(body.data.featured.map((place) => place.id)).toEqual([shut.id, allDay.id]);
    expect(body.data.highlyRated.map((place) => place.name)).toEqual(['ง คะแนนสูง']); // 'จ รีวิวน้อย' has only 2 reviews
    expect(body.data.rules).toEqual({ minimumReviews: 3 });
  });
});

describe('place page', () => {
  test('shows the phone number, the link, the small map and nearby places', async () => {
    const res = await request(app).get(`/places/${allDay.id}`);
    expect(res.text).toContain('href="tel:021234567"');
    expect(res.text).toMatch(/href="https:\/\/example\.com\/cafe" target="_blank" rel="noopener noreferrer nofollow"/);
    expect(res.text).toContain('data-map-mini data-lat="13.7271" data-lng="100.7784"');
    expect(res.text).toContain('/vendor/leaflet/leaflet.js');
    expect(res.text).toContain('id="nearby-heading"');
    expect(res.text).toMatch(/ห่าง 100 ม\./);
    expect(res.text).toMatch(/open-badge is-open/);
  });

  test('a place without a pin loads no map', async () => {
    const res = await request(app).get(`/places/${topRated.id}`);
    expect(res.text).not.toContain('data-map-mini');
    expect(res.text).not.toContain('leaflet');
    expect(res.text).not.toContain('contact-list');
  });

  test('a link must be a web address', async () => {
    const data = { categoryId: cafe.id, name: 'ลิงก์ไม่ดี', description: 'x', address: 'x' };
    for (const websiteUrl of ['javascript:alert(1)', 'example.com', 'ftp://example.com', 'https://exa mple.com']) {
      await expect(prisma.place.create({ data: { ...data, websiteUrl } })).rejects.toThrow(/places_website_url_check/);
    }
  });
});

describe('map page', () => {
  test('lists the pinned places and loads the map from this site', async () => {
    const res = await request(app).get('/map');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/แสดง <strong>3<\/strong> จาก 14 สถานที่/);
    expect(res.text).toContain('data-endpoint="/api/v1/places/map"');
    expect(res.text).toContain('<script src="/vendor/leaflet/leaflet.js" defer></script>');
    expect(res.text).toContain('ค ข้ามคืนวันศุกร์');
    expect(res.text).not.toContain('ซ่อนอยู่');
    expect(res.text).not.toContain('ง คะแนนสูง'); // no pin
  });

  test('the map library and script are served', async () => {
    for (const path of ['/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css', '/js/map.js']) {
      expect((await request(app).get(path)).status).toBe(200);
    }
  });

  test('only OpenStreetMap is allowed as an outside image source', async () => {
    const res = await request(app).get('/map');
    const policy = res.headers['content-security-policy'];
    expect(policy).toMatch(/img-src 'self' data: https:\/\/tile\.openstreetmap\.org(;|$)/);
    expect(policy).toMatch(/script-src 'self'(;|$)/);
  });
});
