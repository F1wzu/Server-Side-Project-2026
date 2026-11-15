// Review fixes: the random pick follows the search text, the card heart keeps one
// accessible name, the gallery drops a stand-in cover once real photos exist, the
// saved-places list shows the last page when asked for one past the end, and the
// random API answers 404 when the picked place has gone.
const request = require('supertest');
const { createApp } = require('../src/app');
const placeModel = require('../src/models/place');
const favoriteModel = require('../src/models/favorite');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();
const api = (path) => request(app).get(`/api/v1${path}`);

// The heart form of one place on a page, as text.
const heartFor = (html, placeId) => {
  const forms = html.split('<form class="card-save"').slice(1).map((part) => part.slice(0, part.indexOf('</form>')));
  return forms.find((form) => form.includes(`data-place="${placeId}"`)) ?? null;
};

beforeEach(() => resetDatabase());
afterEach(() => jest.restoreAllMocks());
afterAll(closeDatabase);

describe('random pick follows the search text', () => {
  let cafe;
  let market;

  beforeEach(async () => {
    const cat = await prisma.category.create({ data: { name: 'คาเฟ่' } });
    const base = { categoryId: cat.id, address: 'ถนนฉลองกรุง', description: 'สถานที่ทดสอบ' };
    cafe = await prisma.place.create({ data: { ...base, name: 'ร้านกาแฟหอมกรุ่น' } });
    market = await prisma.place.create({ data: { ...base, name: 'ตลาดเช้าริมคลอง' } });
  });

  test('only matching places are picked, every time', async () => {
    const q = encodeURIComponent('กาแฟหอม');
    for (let i = 0; i < 5; i += 1) {
      const res = await api(`/places/random?q=${q}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(cafe.id);
      expect(res.body.data.id).not.toBe(market.id);
    }
  });

  test('the page redirect to a random place also uses the search text', async () => {
    const res = await request(app).get(`/places/random?q=${encodeURIComponent('กาแฟหอม')}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/places/${cafe.id}`);
  });

  test('a search with no match is a 404 from the API', async () => {
    const res = await api(`/places/random?q=${encodeURIComponent('ไม่มีสถานที่แบบนี้เลย')}`);
    expect(res.status).toBe(404);
  });

  test('the "สุ่มจากรายการนี้" link on a search keeps the search text', async () => {
    const res = await createClient(app).get(`/places?q=${encodeURIComponent('กาแฟหอม')}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`/places/random?q=${encodeURIComponent('กาแฟหอม')}`);
  });

  test('a place unpublished between the pick and the read is a 404, not an empty success', async () => {
    jest.spyOn(placeModel, 'findPublishedById').mockResolvedValueOnce(null);
    const res = await api('/places/random');
    expect(res.status).toBe(404);
    expect(res.body.data).toBeUndefined();
  });
});

describe('card heart label', () => {
  test('the accessible name is the same whether the place is saved or not', async () => {
    const cat = await prisma.category.create({ data: { name: 'คาเฟ่' } });
    const base = { categoryId: cat.id, address: 'ถนนฉลองกรุง', description: 'รายละเอียด' };
    const saved = await prisma.place.create({ data: { ...base, name: 'ร้านที่บันทึกแล้ว' } });
    const unsaved = await prisma.place.create({ data: { ...base, name: 'ร้านที่ยังไม่บันทึก' } });
    const alice = createClient(app);
    await alice.register({ username: 'alice', email: 'alice@example.com' });
    await alice.put(`/api/v1/me/favorites/${saved.id}`);

    const res = await alice.get('/places');
    const savedHeart = heartFor(res.text, saved.id);
    const unsavedHeart = heartFor(res.text, unsaved.id);
    expect(savedHeart).toContain('aria-pressed="true"');
    expect(unsavedHeart).toContain('aria-pressed="false"');
    expect(savedHeart).toContain(`aria-label="บันทึก ${saved.name}"`);
    expect(unsavedHeart).toContain(`aria-label="บันทึก ${unsaved.name}"`);
    expect(savedHeart).not.toContain('เลิกบันทึก');
    expect(savedHeart).not.toContain('data-name=');
  });
});

describe('gallery and the stand-in cover', () => {
  const illustration = '/images/places/cafe.svg';

  async function placeWith(imagePath, photoPaths) {
    const cat = await prisma.category.create({ data: { name: 'คาเฟ่' } });
    return prisma.place.create({
      data: {
        name: 'ร้านทดสอบรูป',
        description: 'รายละเอียด',
        address: 'ถนนฉลองกรุง',
        categoryId: cat.id,
        imagePath,
        photos: { create: photoPaths.map((path, index) => ({ imagePath: path, position: index + 1 })) },
      },
    });
  }

  test('an illustration cover is left out once real photos exist', async () => {
    const place = await placeWith(illustration, ['/uploads/a.jpg', '/uploads/b.jpg']);
    const found = await placeModel.findPublishedById(place.id);
    expect(found.gallery).toEqual(['/uploads/a.jpg', '/uploads/b.jpg']);
  });

  test('an illustration cover is kept when there are no real photos', async () => {
    const place = await placeWith(illustration, []);
    const found = await placeModel.findPublishedById(place.id);
    expect(found.gallery).toEqual([illustration]);
  });

  test('a real cover photo stays first in front of the other photos', async () => {
    const place = await placeWith('/uploads/cover.jpg', ['/uploads/a.jpg']);
    const found = await placeModel.findPublishedById(place.id);
    expect(found.gallery).toEqual(['/uploads/cover.jpg', '/uploads/a.jpg']);
  });
});

describe('saved places past the last page', () => {
  test('/me/favorites?page=99 shows the last page instead of an empty one', async () => {
    const cat = await prisma.category.create({ data: { name: 'คาเฟ่' } });
    const alice = createClient(app);
    const res0 = await alice.register({ username: 'alice', email: 'alice@example.com' });
    const userId = res0.body.data.id;
    // 25 saved places: the first page holds 24, so the last page holds one place.
    // Saves are dated so that the oldest is "01", which sorts onto the last page.
    const places = [];
    for (let i = 1; i <= 25; i += 1) {
      places.push(await prisma.place.create({ data: { name: `สถานที่ ${String(i).padStart(2, '0')}`, description: 'รายละเอียด', address: 'ถนนฉลองกรุง', categoryId: cat.id } }));
    }
    await prisma.favorite.createMany({
      data: places.map((place, index) => ({ userId, placeId: place.id, createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000) })),
    });

    const past = await alice.get('/me/favorites?page=99');
    expect(past.status).toBe(200);
    expect(past.text).toContain('สถานที่ 01');
    expect(past.text).not.toContain('สถานที่ 25');

    // The model says the same thing: the page is the last one, not an empty one.
    const result = await placeModel.savedBy(userId, { page: 99, pageSize: 24 });
    expect(result.pagination.page).toBe(2);
    expect(result.data.map((place) => place.name)).toEqual(['สถานที่ 01']);
    expect(await favoriteModel.isSaved(userId, places[0].id)).toBe(true);
  });
});
