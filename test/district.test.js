// Pins must lie inside Lat Krabang's real border (OpenStreetMap outline),
// not just inside a rectangle around it.
const { createApp } = require('../src/app');
const { isInsideDistrict, LAT_KRABANG, BOUNDARY } = require('../src/utils/district');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

// Inside the old rectangle (13.66–13.84, 100.68–100.92) but outside the district.
const OUTSIDE = [
  { latitude: 13.67, longitude: 100.7, where: 'Bang Phli, south-west of the district' },
  { latitude: 13.78, longitude: 100.84, where: 'north-east, past the border' },
];
const KMITL = { latitude: 13.7299, longitude: 100.7782 };

describe('isInsideDistrict', () => {
  test('KMITL and the seeded pins are inside', () => {
    expect(isInsideDistrict(KMITL.latitude, KMITL.longitude)).toBe(true);
    const seed = require('../prisma/data/places.json');
    const places = Array.isArray(seed) ? seed : seed.places;
    for (const place of places.filter((p) => p.latitude !== null && p.latitude !== undefined)) {
      expect(isInsideDistrict(place.latitude, place.longitude)).toBe(true);
    }
  });

  test('points inside the old rectangle but outside the border are refused', () => {
    for (const point of OUTSIDE) expect(isInsideDistrict(point.latitude, point.longitude)).toBe(false);
  });

  test('odd input is never inside', () => {
    for (const [lat, lng] of [[NaN, 100.78], [13.73, Infinity], [null, null], [0, 0]]) expect(isInsideDistrict(lat, lng)).toBe(false);
  });

  test('the outline is closed and the rectangle is derived from it', () => {
    expect(BOUNDARY[0]).toEqual(BOUNDARY[BOUNDARY.length - 1]);
    expect(LAT_KRABANG.minLat).toBeGreaterThan(13.68);
    expect(LAT_KRABANG.maxLng).toBeLessThan(100.88);
  });
});

describe('the rule is applied everywhere a pin is set', () => {
  let category;
  let member;
  let admin;
  const week = () => Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'unknown' }));
  const content = (pin) => ({ name: 'ร้านทดสอบเขต', categoryId: category.id, description: 'ทดสอบ', address: 'ลาดกระบัง', hours: week(), ...pin });

  beforeEach(async () => {
    await resetDatabase();
    category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
    member = createClient(app);
    await member.register({ username: 'member', email: 'member@example.com' });
    admin = createClient(app);
    await admin.registerAdmin();
  });

  afterAll(closeDatabase);

  const outsideMessage = (res) => res.body.error.details.find((detail) => detail.field === 'latitude')?.message;

  test('member submissions', async () => {
    for (const point of OUTSIDE) {
      const res = await member.post('/api/v1/submissions', content(point));
      expect(res.status).toBe(400);
      expect(outsideMessage(res)).toMatch(/นอกเขตลาดกระบัง/);
    }
    expect((await member.post('/api/v1/submissions', content(KMITL))).status).toBe(201);
  });

  test('admin places (a pin is optional, but if given it must be inside)', async () => {
    const outside = await admin.post('/api/v1/admin/places', content(OUTSIDE[0]));
    expect(outside.status).toBe(400);
    expect(outsideMessage(outside)).toMatch(/นอกเขตลาดกระบัง/);
    expect((await admin.post('/api/v1/admin/places', content(KMITL))).status).toBe(201);
    expect((await admin.post('/api/v1/admin/places', content({ latitude: null, longitude: null }))).status).toBe(201);
  });

  test('an admin moving the pin while approving', async () => {
    const submission = (await member.post('/api/v1/submissions', content(KMITL))).body.data;
    const moved = await admin.post(`/api/v1/admin/submissions/${submission.id}/approve`, { version: submission.version, ...OUTSIDE[1] });
    expect(moved.status).toBe(400);
    expect((await prisma.submission.findUnique({ where: { id: submission.id } })).status).toBe('pending');
  });
});
