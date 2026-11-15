// About and privacy pages, link previews (Open Graph), robots.txt,
// sitemap.xml, and the privacy-policy consent at sign-up.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();
let category;

beforeEach(async () => {
  await resetDatabase();
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
});

afterAll(closeDatabase);

const place = (data = {}) =>
  prisma.place.create({ data: { categoryId: category.id, name: 'ร้านกาแฟ & ขนม', description: 'กาแฟดี\n\nบรรยากาศเงียบ', address: 'ลาดกระบัง', ...data } });

describe('about and privacy', () => {
  test('both pages load and are linked from every page footer', async () => {
    const client = createClient(app);
    const about = await client.get('/about');
    expect(about.status).toBe(200);
    expect(about.text).toContain('Server-Side Web Development');
    const privacy = await client.get('/privacy');
    expect(privacy.status).toBe(200);
    expect(privacy.text).toContain('PDPA');
    expect(privacy.text).toContain('ฉบับที่ 1');
    const home = await client.get('/');
    expect(home.text).toContain('href="/about"');
    expect(home.text).toContain('href="/privacy"');
  });
});

describe('link previews', () => {
  test('every page has a title, description and canonical address', async () => {
    const res = await createClient(app).get('/places');
    expect(res.text).toMatch(/<meta property="og:title" content="[^"]+">/);
    expect(res.text).toContain('<meta property="og:type" content="website">');
    expect(res.text).toMatch(/<link rel="canonical" href="http:\/\/127\.0\.0\.1:\d+\/places">/);
    expect(res.text).toContain('<meta name="twitter:card" content="summary">');
  });

  test("a place shares its own description and real photo", async () => {
    const withPhoto = await place({ imagePath: '/uploads/00000000-0000-4000-8000-000000000000.webp' });
    const res = await createClient(app).get(`/places/${withPhoto.id}`);
    expect(res.text).toContain('<meta property="og:title" content="ร้านกาแฟ &amp; ขนม">');
    expect(res.text).toContain('<meta property="og:description" content="กาแฟดี บรรยากาศเงียบ">');
    expect(res.text).toContain('<meta property="og:type" content="article">');
    expect(res.text).toMatch(/<meta property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/uploads\/00000000-0000-4000-8000-000000000000\.webp">/);
  });

  test('an illustration (SVG) is not offered as a preview image', async () => {
    const drawn = await place({ imagePath: '/images/places/cafe.svg' });
    const res = await createClient(app).get(`/places/${drawn.id}`);
    expect(res.text).not.toContain('og:image');
  });
});

describe('robots.txt and sitemap.xml', () => {
  test('robots.txt keeps crawlers out of private areas and points to the sitemap', async () => {
    const res = await createClient(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('Disallow: /admin');
    expect(res.text).toContain('Disallow: /api/');
    expect(res.text).toMatch(/Sitemap: http:\/\/127\.0\.0\.1:\d+\/sitemap\.xml/);
  });

  test('the sitemap lists the public pages and published places only', async () => {
    const shown = await place();
    const hidden = await place({ name: 'ซ่อน', status: 'unpublished' });
    const res = await createClient(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.text).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(res.text).toMatch(new RegExp(`/places/${shown.id}</loc><lastmod>\\d{4}-\\d{2}-\\d{2}</lastmod>`));
    expect(res.text).not.toContain(`/places/${hidden.id}<`);
    expect(res.text).toContain('/privacy</loc>');
  });
});

describe('privacy policy consent at sign-up', () => {
  const account = { username: 'สมใจ', email: 'somjai@example.com', password: 'password123' };

  test('the API refuses a sign-up without consent', async () => {
    const client = createClient(app);
    const res = await client.post('/api/v1/auth/register', account);
    expect(res.status).toBe(400);
    expect(res.body.error.details.find((detail) => detail.field === 'acceptPolicy').message).toMatch(/นโยบายความเป็นส่วนตัว/);
    expect((await client.post('/api/v1/auth/register', { ...account, acceptPolicy: false })).status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  test('the form shows the checkbox, keeps other values and marks the error', async () => {
    const client = createClient(app);
    expect((await client.get('/register')).text).toContain('name="acceptPolicy"');
    const res = await client.postForm('/register', account);
    expect(res.status).toBe(400);
    expect(res.text).toContain('value="somjai@example.com"');
    expect(res.text).toContain('id="acceptPolicy-error"');
  });

  test('a ticked box registers', async () => {
    const res = await createClient(app).postForm('/register', { ...account, acceptPolicy: 'on' });
    expect(res.status).toBe(303);
    const user = await prisma.user.findFirst();
    expect(user.policyVersion).toBe('1');
    expect(Date.now() - user.policyAcceptedAt.getTime()).toBeLessThan(60_000);
  });

  test('the database keeps the time and version together', async () => {
    const user = await prisma.user.create({ data: { username: 'abc', email: 'abc@example.com', passwordHash: 'x' } });
    await expect(prisma.user.update({ where: { id: user.id }, data: { policyVersion: '1' } })).rejects.toThrow();
  });
});
