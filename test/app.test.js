const request = require('supertest');
const { createApp } = require('../src/app');
const healthModel = require('../src/models/health');
const placeModel = require('../src/models/place');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');

const app = createApp();

beforeAll(resetDatabase);
afterEach(() => jest.restoreAllMocks());
afterAll(closeDatabase);

describe('GET /healthz', () => {
  test('returns 200 when the database answers', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  test('returns 503 when the database does not answer', async () => {
    jest.spyOn(healthModel, 'checkDatabase').mockRejectedValue(new Error('connection refused'));
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'unavailable' });
  });
});

describe('home page', () => {
  test('renders in Thai with counts from the database', async () => {
    const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
    await prisma.place.create({
      data: { categoryId: category.id, name: 'ร้านทดสอบ', description: 'รายละเอียด', address: 'ลาดกระบัง' },
    });
    await prisma.place.create({
      data: { categoryId: category.id, name: 'ร้านที่ซ่อน', description: 'รายละเอียด', address: 'ลาดกระบัง', status: 'unpublished' },
    });

    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<html lang="th">');
    expect(res.text).toContain('วันนี้ไปไหนดี');
    // one published place, one category; the unpublished place is not counted
    expect(res.text).toMatch(/<strong>1<\/strong> สถานที่ · <strong>1<\/strong> หมวดหมู่/);
  });
});

describe('errors', () => {
  test('an unknown page shows the 404 page', async () => {
    const res = await request(app).get('/no-such-page');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('ไม่พบหน้าที่คุณต้องการ');
  });

  test('an unknown API path answers 404 as JSON', async () => {
    const res = await request(app).get('/api/v1/no-such-thing');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String), details: null } });
  });

  test('a malformed JSON body answers 400, not 500', async () => {
    const res = await request(app).post('/api/v1/anything').set('Content-Type', 'application/json').send('{"broken"');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('a body over 64 KB answers 413', async () => {
    const res = await request(app)
      .post('/api/v1/anything')
      .send({ text: 'x'.repeat(70 * 1024) });
    expect(res.status).toBe(413);
  });

  test('an unexpected error shows a generic page and leaks nothing', async () => {
    jest.spyOn(placeModel, 'countPublished').mockRejectedValue(new Error('secret database detail'));
    const res = await request(app).get('/');
    expect(res.status).toBe(500);
    expect(res.text).toContain('เกิดข้อผิดพลาดในระบบ');
    expect(res.text).not.toContain('secret database detail');
    expect(res.text).not.toMatch(/at .*\.js:\d+/);
  });

  test('an unexpected error on the API answers 500 as JSON without details', async () => {
    jest.spyOn(placeModel, 'countPublished').mockRejectedValue(new Error('secret database detail'));
    const res = await request(app).get('/').set('Accept', 'application/json');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret database detail');
  });
});

describe('response headers', () => {
  test('every response has a request ID and basic security headers', async () => {
    const res = await request(app).get('/');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  test('site assets are served from public/', async () => {
    const res = await request(app).get('/css/site.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/css/);
  });
});
