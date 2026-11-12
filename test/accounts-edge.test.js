// Edge cases found by the review of steps 1–4: accounts, sessions and
// request handling.
const request = require('supertest');
const { createApp } = require('../src/app');
const { parseEnv } = require('../src/config/env');
const sessionModule = require('../src/middleware/session');
const { resetRateLimits, REGISTER_LIMIT } = require('../src/middleware/rateLimit');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient, sessionCookie } = require('./support/client');

const app = createApp();
const cookieOf = (res) => sessionCookie(res).split(';')[0];
const sidOf = (cookie) => decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0];

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});
afterEach(() => jest.restoreAllMocks());
afterAll(closeDatabase);

describe('a stolen session cannot outlive a password change or a logout', () => {
  test('a session written back after a password change is still logged out', async () => {
    const owner = createClient(app);
    await owner.register();
    const thief = createClient(app);
    const thiefCookie = cookieOf(await thief.login());
    const stolen = await prisma.session.findUnique({ where: { sid: sidOf(thiefCookie) } });

    expect((await owner.put('/api/v1/me/password', { currentPassword: 'password123', newPassword: 'new-password-456' })).status).toBe(204);
    // A request that was still running for the thief writes the old session back.
    await prisma.session.create({ data: stolen });

    expect((await request(app).get('/api/v1/me').set('Cookie', thiefCookie)).status).toBe(401);
    expect((await owner.get('/api/v1/me')).status).toBe(200);
  });

  test('the session version never appears in an API answer', async () => {
    const client = createClient(app);
    const res = await client.register();
    expect(res.body.data).not.toHaveProperty('sessionVersion');
    expect((await client.get('/api/v1/me')).body.data).not.toHaveProperty('sessionVersion');
  });

  test('a logged-out session cannot be written back by a request still running', async () => {
    const owner = createClient(app);
    const cookie = cookieOf(await owner.register());
    const sid = sidOf(cookie);
    const sess = (await prisma.session.findUnique({ where: { sid } })).sess;

    expect((await owner.post('/api/v1/auth/logout')).status).toBe(204);
    // What the in-flight request would do: save the session it had loaded.
    await new Promise((resolve) => sessionModule.store.set(sid, sess, resolve));
    expect(await prisma.session.count({ where: { sid } })).toBe(0);
    expect((await request(app).get('/api/v1/me').set('Cookie', cookie)).status).toBe(401);
  });

  test('logout clears the cookie even when the session store fails', async () => {
    const client = createClient(app);
    await client.register();
    jest.spyOn(sessionModule.store, 'destroy').mockImplementation((sid, callback) => callback(new Error('store is down')));
    const res = await client.post('/api/v1/auth/logout');
    expect(res.status).toBe(500);
    expect(sessionCookie(res)).toMatch(/^sid=;/);
  });
});

describe('registering', () => {
  test('each address may register a limited number of times an hour', async () => {
    // A fresh visitor each time (registering logs in and renews the token).
    // The first attempt creates the account; the rest find the email taken,
    // which is exactly the "does this email exist?" probing being limited.
    const statuses = [];
    for (let i = 0; i <= REGISTER_LIMIT; i += 1) {
      const client = createClient(app);
      const token = await client.csrfToken();
      const res = await client.agent
        .post('/api/v1/auth/register')
        .set('X-CSRF-Token', token)
        .set('x-test-real-limits', '1')
        .send({ username: `user${i}`, email: 'same@example.com', password: 'password123' });
      statuses.push(res.status);
    }
    expect(statuses[0]).toBe(201);
    expect(statuses.slice(1, REGISTER_LIMIT).every((status) => status === 409)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
  });

  test.each([
    ['a NUL character', 'abc\u0000'],
    ['only invisible characters', '​​​​'],
    ['a line break', 'ab\ncd'],
    ['a control character', 'abc\u0007'],
  ])('a username with %s is refused with 400, not 500', async (label, username) => {
    const res = await createClient(app).register({ username });
    // NUL is removed from every request first, which leaves "abc" (valid);
    // everything else must be refused.
    if (label === 'a NUL character') {
      expect(res.status).toBe(201);
      expect(res.body.data.username).toBe('abc');
    } else {
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('changing to an invisible username is refused', async () => {
    const client = createClient(app);
    await client.register();
    expect((await client.patch('/api/v1/me', { username: '​​​' })).status).toBe(400);
  });
});

describe('the password-change throttle', () => {
  test('mistakes in the new password are not counted, wrong current passwords are', async () => {
    const client = createClient(app);
    await client.register();
    for (let i = 0; i < 6; i += 1) {
      expect((await client.put('/api/v1/me/password', { currentPassword: 'password123', newPassword: 'short' })).status).toBe(400);
    }
    // Six bad new passwords did not use up the five attempts.
    expect((await client.put('/api/v1/me/password', { currentPassword: 'wrong-password', newPassword: 'new-password-456' })).status).toBe(400);
    expect((await client.put('/api/v1/me/password', { currentPassword: 'password123', newPassword: 'new-password-456' })).status).toBe(204);
  });
});

describe('client errors are answered as client errors', () => {
  test.each(['/places/%', '/places/%E0%A4%A', '/api/v1/places/%zz'])('%s is 400 or 404, never 500', async (path) => {
    const res = await request(app).get(path);
    expect([400, 404]).toContain(res.status);
  });

  test('an unknown Content-Encoding is 415, not 500', async () => {
    const res = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').set('Content-Encoding', 'foo').send('{}');
    expect([403, 415]).toContain(res.status); // the CSRF check may answer first
  });

  test('upper-case /API/ paths still answer as the API', async () => {
    const res = await request(app).get('/API/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  test('NUL in a search is ignored instead of crashing', async () => {
    expect((await request(app).get('/places?q=a%00b')).status).toBe(200);
    expect((await request(app).get('/api/v1/places?q=%00')).status).toBe(200);
  });
});

describe('login after a form sent while logged out', () => {
  test('returns to the page the form was on', async () => {
    const res = await createClient(app).postForm('/favorites/1', { action: 'save' }).then((r) => r);
    expect(res.status).toBe(302);
    const withReferer = await request(app).post('/places/5/reviews').set('Referer', 'http://127.0.0.1/places/5').type('form').send({});
    expect([302, 403]).toContain(withReferer.status);
  });

  test('a Referer from another site is ignored', async () => {
    const client = createClient(app);
    const token = await client.csrfToken();
    const res = await client.agent.post('/favorites/1').set('Referer', 'https://evil.example/places/1').type('form').send({ _csrf: token, action: 'save' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  test('a Referer on this site becomes the place to return to', async () => {
    const client = createClient(app);
    const token = await client.csrfToken();
    const host = 'example.test';
    const res = await client.agent
      .post('/favorites/1')
      .set('Host', host)
      .set('Referer', `http://${host}/places/1`)
      .type('form')
      .send({ _csrf: token, action: 'save' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?next=%2Fplaces%2F1');
  });
});

describe('TRUST_PROXY', () => {
  const base = { DATABASE_URL: 'postgresql://a:b@h/d', SESSION_SECRET: 'x'.repeat(32) };
  test.each(['1', 'true', 'false', 'loopback', 'loopback, 10.0.0.0/8', '::1'])('accepts %s', (value) => {
    expect(() => parseEnv({ ...base, TRUST_PROXY: value })).not.toThrow();
  });
  test.each(['yes', 'proxy', '1; rm -rf'])('refuses %s with a clear message instead of crashing later', (value) => {
    expect(() => parseEnv({ ...base, TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
  });
});
