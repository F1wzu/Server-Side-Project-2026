// Edge cases in browsing places found in review: searching addresses,
// over-long searches, loosely written numbers, one URL per place, "closes
// next day" on a normal day, and a stable "nearby" order.
const request = require('supertest');
const { createApp } = require('../src/app');
const placeModel = require('../src/models/place');
const { readSubmission } = require('../src/validation/submission');
const seedPlaces = require('../prisma/data/places.json');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');

const app = createApp();
const api = (path) => request(app).get(`/api/v1${path}`);
const found = (res) => Number(res.text.match(/พบ <strong>(\d+)<\/strong> สถานที่/)[1]);
const time = (hhmm) => new Date(`1970-01-01T${hhmm}:00Z`);

// The same words the model blanks out of addresses before searching them.
const stripDistrict = (address) => address.replace(/แขวงลาดกระบัง|เขตลาดกระบัง|กรุงเทพมหานคร|กรุงเทพฯ|10520/g, ' ');

const seedIdsByName = new Map();
let category;
let first;

beforeAll(async () => {
  await resetDatabase();
  // The real seed places, so the search is checked against real addresses.
  const categoryIds = new Map();
  for (const name of new Set(seedPlaces.map((place) => place.category))) {
    categoryIds.set(name, (await prisma.category.create({ data: { name } })).id);
  }
  for (const place of seedPlaces) {
    const row = await prisma.place.create({
      data: { categoryId: categoryIds.get(place.category), name: place.name, description: place.description, address: place.address, latitude: place.latitude, longitude: place.longitude },
    });
    seedIdsByName.set(place.name, row.id);
  }
  category = await prisma.category.findFirst({ orderBy: { id: 'asc' } });
  first = await prisma.place.findFirst({ orderBy: { id: 'asc' } });
});

afterAll(closeDatabase);

describe('searching addresses (real seed data)', () => {
  const searchIds = async (q) => (await placeModel.list({ q, pageSize: 50 })).data.map((place) => place.id).sort((a, b) => a - b);
  const expectedIds = (q) =>
    seedPlaces
      .filter((place) => [place.name, place.description, place.category, stripDistrict(place.address)].some((text) => text.includes(q)))
      .map((place) => seedIdsByName.get(place.name))
      .sort((a, b) => a - b);

  test('"ตลาด" does not match places only through "เขตลาดกระบัง"', async () => {
    const ids = await searchIds('ตลาด');
    expect(ids).toEqual(expectedIds('ตลาด'));
    expect(ids.length).toBeLessThan(seedPlaces.length);
    // A real market in the address ("บริเวณตลาดหัวตะเข้") is still found.
    expect(ids).toContain(seedIdsByName.get(seedPlaces.find((place) => place.address.includes('ตลาดหัวตะเข้')).name));
  });

  test.each(['ลาดกระบัง', 'แขวงลาดกระบัง', 'เขตลาดกระบัง', 'กรุงเทพมหานคร', 'กรุงเทพฯ', 'กรุงเทพ', '10520', ' ลาดกระบัง '])(
    'searching for the district itself (%s) returns every published place',
    async (q) => {
      const res = await request(app).get(`/places?q=${encodeURIComponent(q)}`);
      expect(found(res)).toBe(seedPlaces.length);
    }
  );

  test('a road name still matches by address', async () => {
    const ids = await searchIds('ฉลองกรุง');
    expect(ids).toEqual(expectedIds('ฉลองกรุง'));
    expect(ids.length).toBeGreaterThan(0);
    const byAddressOnly = seedPlaces.filter((place) => place.address.includes('ฉลองกรุง') && !place.name.includes('ฉลองกรุง') && !place.description.includes('ฉลองกรุง'));
    for (const place of byAddressOnly) expect(ids).toContain(seedIdsByName.get(place.name));
  });

  test('"%" and "_" stay literal in the address search', async () => {
    expect(await searchIds('%')).toEqual([]);
    expect(await searchIds('_')).toEqual([]);
  });

  test('a NUL character in the search is not an error', async () => {
    expect((await request(app).get('/places?q=%00')).status).toBe(200);
    expect((await api('/places?q=%00')).status).toBe(200);
  });
});

describe('over-long search on the page', () => {
  test('is cut to 100 characters instead of being dropped', async () => {
    const long = `ฉลองกรุง${'x'.repeat(100)}`;
    const res = await request(app).get(`/places?q=${encodeURIComponent(long)}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`value="${long.slice(0, 100)}"`);
    expect(found(res)).toBe(0); // the cut text is searched, not "everything"
  });

  test('the API still refuses it', async () => {
    const res = await api(`/places?q=${'x'.repeat(101)}`);
    expect(res.status).toBe(400);
  });
});

describe('numbers in the API query', () => {
  test.each(['page=0x1', 'page=%201', 'page=1.0', 'page=1e0', 'page=+1', 'pageSize=1e1', 'pageSize=0x10', 'categoryId=0x1', 'categoryId=01', 'categoryId=1.0', 'categoryId=%201', 'categoryId=2147483648', 'page=1&page=2'])(
    'refuses %s with 400',
    async (query) => {
      const res = await api(`/places?${query}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  );

  test('plain digits still work', async () => {
    const res = await api(`/places?page=2&pageSize=10&categoryId=${category.id}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 2, pageSize: 10 });
    expect((await api(`/places/random?categoryId=${category.id}`)).status).toBe(200);
    expect((await api('/places/random?categoryId=0x1')).status).toBe(400);
  });

  test('the page falls back to defaults for the same values', async () => {
    for (const query of ['page=0x1', 'pageSize=1e1', 'categoryId=0x1']) {
      const res = await request(app).get(`/places?${query}`);
      expect(res.status).toBe(200);
      expect(found(res)).toBe(seedPlaces.length);
    }
  });
});

describe('one URL per place', () => {
  test.each(['0{id}', '{id}.0', '+{id}', '{id}e0', '%20{id}'])('/places/%s is 404 on the page and in the API', async (pattern) => {
    const path = pattern.replace('{id}', first.id);
    expect((await request(app).get(`/places/${path}`)).status).toBe(404);
    expect((await api(`/places/${path}`)).status).toBe(404);
    expect((await api(`/places/${path}/related`)).status).toBe(404);
  });

  test('the plain id works', async () => {
    expect((await request(app).get(`/places/${first.id}`)).status).toBe(200);
    expect((await api(`/places/${first.id}`)).status).toBe(200);
  });
});

describe('"closes next day" must really cross midnight', () => {
  const body = (day) => ({
    name: 'ร้านทดสอบ',
    categoryId: '1',
    description: 'รายละเอียด',
    address: 'ถนนฉลองกรุง',
    latitude: '13.7279',
    longitude: '100.7782',
    hours: Array.from({ length: 7 }, (unused, weekday) => (weekday === 5 ? { weekday, state: 'open', ...day } : { weekday, state: 'closed' })),
  });
  const hoursIssues = (day) => readSubmission(body(day)).issues.filter((issue) => issue.path[0] === 'hours');

  test('10:00–20:00 with next day is refused with a clear message', () => {
    const issues = hoursIssues({ opensAt: '10:00', closesAt: '20:00', closesNextDay: true });
    expect(issues.map((issue) => issue.message)).toContain('เลือก "ปิดวันถัดไป" ได้เฉพาะเมื่อเวลาปิดเลยเที่ยงคืน');
  });

  test.each([
    ['18:00', '02:00'],
    ['00:00', '00:00'],
  ])('%s–%s with next day is accepted', (opensAt, closesAt) => {
    expect(hoursIssues({ opensAt, closesAt, closesNextDay: true })).toEqual([]);
  });

  test('the database refuses the same mistake', async () => {
    const row = (opens, closes) => ({ placeId: first.id, weekday: 5, state: 'open', opensAt: time(opens), closesAt: time(closes), closesNextDay: true });
    await expect(prisma.placeHours.create({ data: row('10:00', '20:00') })).rejects.toThrow(/place_hours_order_check/);
    for (const [opens, closes] of [
      ['18:00', '02:00'],
      ['00:00', '00:00'],
    ]) {
      await prisma.placeHours.create({ data: row(opens, closes) });
      await prisma.placeHours.deleteMany({ where: { placeId: first.id } });
    }
  });
});

describe('nearby places', () => {
  test('equal distances are ordered by name, then id', async () => {
    const pin = { latitude: 13.5, longitude: 100.5 }; // far from every seed place
    const make = (name) => prisma.place.create({ data: { categoryId: category.id, name, description: 'x', address: 'x', ...pin } });
    const centre = await make('ศูนย์กลาง');
    // Created in reverse order, so id order alone would give the wrong answer.
    const c = await make('ค ร้านเดียวกัน');
    const b2 = await make('ข ร้านเดียวกัน');
    const b1 = await make('ข ร้านเดียวกัน');
    const a = await make('ก ร้านเดียวกัน');
    const place = await placeModel.findPublishedById(centre.id);
    const { nearby } = await placeModel.related(place, 10);
    expect(nearby.map((other) => other.id)).toEqual([a.id, b1.id < b2.id ? b1.id : b2.id, b1.id < b2.id ? b2.id : b1.id, c.id]);
  });
});
