// /admin/featured: the home page's "ทีมงานชวนไป" picks managed as one list
// (add, move, make the large card, remove) instead of order numbers per place.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let admin;
let member;
let places;

const picks = async () =>
  (await prisma.place.findMany({ where: { featuredOrder: { not: null } }, orderBy: { featuredOrder: 'asc' }, select: { name: true, featuredOrder: true } })).map(
    (place) => `${place.featuredOrder}:${place.name}`
  );
// The starting picks, with the gapped numbers set before this page existed
// (10, 20, 30); any change through the page renumbers them 1, 2, 3.
const UNTOUCHED = ['10:ก', '20:ข', '30:ค'];
const id = (name) => places.find((place) => place.name === name).id;

beforeEach(async () => {
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  places = [];
  for (const [index, name] of ['ก', 'ข', 'ค', 'ง', 'จ', 'ฉ'].entries()) {
    places.push(
      await prisma.place.create({ data: { categoryId: category.id, name, description: 'd', address: 'ลาดกระบัง', featuredOrder: index < 3 ? (index + 1) * 10 : null } })
    );
  }
  places.push(await prisma.place.create({ data: { categoryId: category.id, name: 'ซ่อน', description: 'd', address: 'ลาดกระบัง', status: 'unpublished' } }));
  admin = createClient(app);
  await admin.registerAdmin();
  member = createClient(app);
  await member.register({ username: 'สมาชิก', email: 'member@example.com' });
});

afterAll(closeDatabase);

describe('page', () => {
  test('shows the picks in order, the empty slots, and only addable places in the list', async () => {
    const res = await admin.get('/admin/featured');
    expect(res.status).toBe(200);
    expect(res.text).toContain('การ์ดใหญ่');
    expect(res.text.indexOf('>ก<')).toBeLessThan(res.text.indexOf('>ข<'));
    expect(res.text.match(/class="featured-item is-empty"/g)).toHaveLength(2);
    // The add list: one "add" form per published place that is not picked yet.
    const addable = (name) => res.text.includes(`name="placeId" value="${id(name)}"`);
    expect(addable('ง')).toBe(true);
    expect(addable('ก')).toBe(false);
    expect(addable('ซ่อน')).toBe(false);
    expect(res.text).toContain('data-featured-search');
    expect(res.text).toContain('3 สถานที่ที่เพิ่มได้');
  });

  test('add puts the place at the end and renumbers 1, 2, 3 ...', async () => {
    const res = await admin.postForm('/admin/featured', { placeId: String(id('ง')) });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/admin/featured');
    expect(await picks()).toEqual(['1:ก', '2:ข', '3:ค', '4:ง']);
  });

  test('move up / down / first, and remove', async () => {
    await admin.postForm(`/admin/featured/${id('ค')}/move`, { direction: 'up' });
    expect(await picks()).toEqual(['1:ก', '2:ค', '3:ข']);
    await admin.postForm(`/admin/featured/${id('ก')}/move`, { direction: 'down' });
    expect(await picks()).toEqual(['1:ค', '2:ก', '3:ข']);
    await admin.postForm(`/admin/featured/${id('ข')}/move`, { direction: 'first' });
    expect(await picks()).toEqual(['1:ข', '2:ค', '3:ก']);
    await admin.postForm(`/admin/featured/${id('ค')}/remove`, {});
    expect(await picks()).toEqual(['1:ข', '2:ก']);
    // Moving past the ends changes nothing.
    await admin.postForm(`/admin/featured/${id('ข')}/move`, { direction: 'up' });
    expect(await picks()).toEqual(['1:ข', '2:ก']);
  });

  test('the list is full at 5; a hidden place cannot be added', async () => {
    for (const name of ['ง', 'จ']) await admin.postForm('/admin/featured', { placeId: String(id(name)) });
    expect(await picks()).toHaveLength(5);
    expect((await admin.get('/admin/featured')).text).toContain('ครบ 5 แห่งแล้ว');
    await admin.postForm('/admin/featured', { placeId: String(id('ฉ')) });
    expect(await picks()).toHaveLength(5);
    expect((await admin.get('/admin/featured')).text).toContain('เลือกได้ไม่เกิน 5 แห่ง');

    await admin.postForm(`/admin/featured/${id('จ')}/remove`, {});
    await admin.postForm('/admin/featured', { placeId: String(id('ซ่อน')) });
    expect(await picks()).toHaveLength(4);
    expect((await admin.get('/admin/featured')).text).toContain('ถูกซ่อนอยู่');
  });

  test('the home page follows the new order and shows admins a link here', async () => {
    await admin.postForm(`/admin/featured/${id('ค')}/move`, { direction: 'first' });
    const home = await admin.get('/');
    expect(home.text.indexOf('>ค<')).toBeLessThan(home.text.indexOf('>ก<'));
    expect(home.text).toContain('href="/admin/featured"');
    expect((await member.get('/')).text).not.toContain('href="/admin/featured"');
  });

  test('members and guests cannot use it', async () => {
    expect((await member.get('/admin/featured')).status).toBe(403);
    expect((await member.postForm('/admin/featured', { placeId: String(id('ง')) })).status).toBe(403);
    expect(await picks()).toEqual(UNTOUCHED);
  });
});

describe('API', () => {
  test('GET lists the picks; PUT sets the whole list in order', async () => {
    const list = await admin.get('/api/v1/admin/featured');
    expect(list.body.data.map((place) => place.name)).toEqual(['ก', 'ข', 'ค']);
    expect(list.body.meta.limit).toBe(5);

    const res = await admin.put('/api/v1/admin/featured', { placeIds: [id('จ'), id('ก')] });
    expect(res.status).toBe(200);
    expect(res.body.data.map((place) => place.name)).toEqual(['จ', 'ก']);
    expect(await picks()).toEqual(['1:จ', '2:ก']);
  });

  test.each([
    ['not a list', { placeIds: 'x' }, 400],
    ['a repeated place', { placeIds: [1, 1] }, 400],
    ['too many', { placeIds: null }, 400],
  ])('refuses %s', async (label, body, status) => {
    if (body.placeIds === null) body.placeIds = places.slice(0, 6).map((place) => place.id);
    if (Array.isArray(body.placeIds) && body.placeIds[0] === 1) body.placeIds = [id('ก'), id('ก')];
    expect((await admin.put('/api/v1/admin/featured', body)).status).toBe(status);
    expect(await picks()).toEqual(UNTOUCHED);
  });

  test('an unknown place is 404', async () => {
    expect((await admin.put('/api/v1/admin/featured', { placeIds: [999999] })).status).toBe(404);
  });
});
