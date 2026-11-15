// "ทีมงานชวนไป" on the home page shows at most five featured places, in the
// admin's order (one large card and four small ones).
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
  const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  for (let order = 1; order <= 6; order += 1) {
    await prisma.place.create({
      data: { categoryId: category.id, name: `แนะนำ ${order}`, description: 'd', address: 'ลาดกระบัง', featuredOrder: order },
    });
  }
});

afterAll(closeDatabase);

test('the API returns the first five featured places in order', async () => {
  const res = await createClient(app).get('/api/v1/recommendations');
  expect(res.body.data.featured.map((place) => place.name)).toEqual(['แนะนำ 1', 'แนะนำ 2', 'แนะนำ 3', 'แนะนำ 4', 'แนะนำ 5']);
});

test('the home page shows five, not the sixth', async () => {
  const html = (await createClient(app).get('/')).text;
  expect(html).toContain('แนะนำ 5');
  expect(html).not.toContain('แนะนำ 6');
});
