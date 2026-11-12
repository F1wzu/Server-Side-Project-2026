const request = require('supertest');
const { createApp } = require('../src/app');
const { cookieOptions } = require('../src/middleware/session');
const { resetRateLimits } = require('../src/middleware/rateLimit');
const safeRedirect = require('../src/utils/safeRedirect');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient, sessionCookie } = require('./support/client');

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});
afterAll(closeDatabase);

describe('register', () => {
  test('creates a member, stores a bcrypt hash and logs the user in', async () => {
    const client = createClient(app);
    const res = await client.register();

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ username: 'สมชาย', email: 'somchai@example.com', role: 'member' });

    const row = await prisma.user.findUnique({ where: { email: 'somchai@example.com' } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$\d\d\$.{53}$/);
    expect(row.passwordHash).not.toContain('password123');

    const me = await client.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('somchai@example.com');
  });

  test('always creates a member, even when the request sends role=admin', async () => {
    const client = createClient(app);
    const res = await client.register({ role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe('member');
    expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(0);

    const form = await createClient(app).postForm('/register', { username: 'another', email: 'another@example.com', password: 'password123', role: 'admin' });
    expect(form.status).toBe(303);
    expect(await prisma.user.count({ where: { role: 'admin' } })).toBe(0);
  });

  test('never returns the password hash', async () => {
    const client = createClient(app);
    const res = await client.register();
    const me = await client.get('/api/v1/me');
    for (const body of [res.body, me.body]) {
      expect(JSON.stringify(body)).not.toMatch(/password|\$2b\$/i);
    }
  });

  test('stores the email trimmed and in lowercase', async () => {
    const res = await createClient(app).register({ email: '  Somchai@Example.COM ' });
    expect(res.body.data.email).toBe('somchai@example.com');
  });

  test('refuses an email that is already registered', async () => {
    await createClient(app).register();
    const res = await createClient(app).register({ email: 'SOMCHAI@example.com' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
    expect(await prisma.user.count()).toBe(1);
  });

  test.each([
    ['a short username', { username: 'ab' }, 'username'],
    ['a long username', { username: 'x'.repeat(51) }, 'username'],
    ['a malformed email', { email: 'not-an-email' }, 'email'],
    ['a short password', { password: '1234567' }, 'password'],
    ['a password over 72 bytes', { password: 'ก'.repeat(25) }, 'password'],
    ['a missing password', { password: undefined }, 'password'],
  ])('refuses %s', async (label, overrides, field) => {
    const res = await createClient(app).register(overrides);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((detail) => detail.field)).toContain(field);
    expect(await prisma.user.count()).toBe(0);
  });

  test('the form shows the errors, keeps what was typed and never echoes the password', async () => {
    const res = await createClient(app).postForm('/register', { username: 'สมหญิง', email: 'bad', password: 'short-pw' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('รูปแบบอีเมลไม่ถูกต้อง');
    expect(res.text).toContain('value="สมหญิง"');
    expect(res.text).not.toContain('short-pw');
  });

  test('a successful form post redirects to the profile and shows a welcome once', async () => {
    const client = createClient(app);
    const res = await client.postForm('/register', { username: 'สมหญิง', email: 'somying@example.com', password: 'password123' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/me');

    const first = await client.get('/me');
    expect(first.text).toContain('ยินดีต้อนรับ สมหญิง');
    const second = await client.get('/me');
    expect(second.text).not.toContain('ยินดีต้อนรับ');
  });
});

describe('login', () => {
  beforeEach(() => createClient(app).register());

  test('logs in with the right email and password', async () => {
    const client = createClient(app);
    const res = await client.login();
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('somchai@example.com');
    expect((await client.get('/api/v1/me')).status).toBe(200);
  });

  test('a wrong email and a wrong password get exactly the same answer', async () => {
    const wrongPassword = await createClient(app).login('somchai@example.com', 'wrong-password');
    const wrongEmail = await createClient(app).login('nobody@example.com', 'password123');
    expect(wrongPassword.status).toBe(401);
    expect(wrongEmail.status).toBe(401);
    expect(wrongEmail.body).toEqual(wrongPassword.body);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');

    const formWrongPassword = await createClient(app).postForm('/login', { email: 'somchai@example.com', password: 'wrong-password' });
    const formWrongEmail = await createClient(app).postForm('/login', { email: 'nobody@example.com', password: 'password123' });
    expect(formWrongPassword.status).toBe(401);
    expect(formWrongEmail.status).toBe(401);
    expect(formWrongPassword.text).toContain('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    expect(formWrongEmail.text).toContain('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  });

  test('the session cookie is HttpOnly and SameSite=Lax, and lasts 7 days', async () => {
    const res = await createClient(app).login();
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).not.toMatch(/Secure/i); // plain HTTP while developing and testing
    expect(cookieOptions(false).maxAge).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test('the session cookie is Secure in production', () => {
    expect(cookieOptions(true)).toMatchObject({ secure: true, httpOnly: true, sameSite: 'lax' });
  });

  test('the session ID changes at login', async () => {
    const client = createClient(app);
    const before = sessionCookie(await client.get('/login')).split(';')[0];
    const after = sessionCookie(await client.login()).split(';')[0];
    expect(before).toMatch(/^sid=/);
    expect(after).toMatch(/^sid=/);
    expect(after).not.toBe(before);
  });

  test('the session stores only the user ID', async () => {
    const client = createClient(app);
    const { body } = await client.login();
    const sessions = await prisma.session.findMany();
    const mine = sessions.find((session) => session.sess.userId === body.data.id);
    expect(Object.keys(mine.sess).sort()).toEqual(['cookie', 'userId']);
  });

  test('the form redirects back to the page the visitor wanted', async () => {
    const res = await createClient(app).postForm('/login', { email: 'somchai@example.com', password: 'password123', next: '/me' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/me');
  });

  test('the form never redirects to another website', async () => {
    for (const next of ['https://evil.example', '//evil.example', '/\\evil.example']) {
      const res = await createClient(app).postForm('/login', { email: 'somchai@example.com', password: 'password123', next });
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/');
    }
    expect(safeRedirect('/places?page=2')).toBe('/places?page=2');
    expect(safeRedirect(undefined)).toBe('/');
  });

  test('five wrong logins are answered 401, the sixth is throttled with 429', async () => {
    const client = createClient(app);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await client.login('somchai@example.com', 'wrong-password')).status).toBe(401);
    }
    const sixth = await client.login('somchai@example.com', 'wrong-password');
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('RATE_LIMITED');

    // Even the right password is refused while throttled.
    expect((await client.login()).status).toBe(429);

    const form = await createClient(app).postForm('/login', { email: 'somchai@example.com', password: 'wrong-password' });
    expect(form.status).toBe(429);
    expect(form.text).toContain('พยายามเข้าสู่ระบบหลายครั้งเกินไป');
  });

  test('successful logins are not counted towards the limit', async () => {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      expect((await createClient(app).login()).status).toBe(200);
    }
  });

  test('throttling one account does not lock out another', async () => {
    await createClient(app).register({ email: 'other@example.com' });
    const client = createClient(app);
    for (let attempt = 1; attempt <= 6; attempt += 1) await client.login('somchai@example.com', 'wrong-password');
    expect((await client.login('other@example.com', 'password123')).status).toBe(200);
  });
});

describe('logout', () => {
  test('ends the session on the server and clears the cookie', async () => {
    const client = createClient(app);
    await client.register();
    expect(await prisma.session.count()).toBe(1);

    const res = await client.post('/api/v1/auth/logout');
    expect(res.status).toBe(204);
    expect(sessionCookie(res)).toMatch(/^sid=;/);
    expect(await prisma.session.count()).toBe(0);
    expect((await client.get('/api/v1/me')).status).toBe(401);
  });

  test('a stolen copy of the cookie stops working after logout', async () => {
    const client = createClient(app);
    const stolen = sessionCookie(await client.register()).split(';')[0];
    expect((await request(app).get('/api/v1/me').set('Cookie', stolen)).status).toBe(200);

    await client.post('/api/v1/auth/logout');
    expect((await request(app).get('/api/v1/me').set('Cookie', stolen)).status).toBe(401);
  });

  test('the logout button on the page works', async () => {
    const client = createClient(app);
    await client.register();
    const res = await client.postForm('/logout');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/');
    expect((await client.get('/me')).status).toBe(302);
  });

  test('logging out through the API needs a login', async () => {
    expect((await createClient(app).post('/api/v1/auth/logout')).status).toBe(401);
  });
});

describe('CSRF protection', () => {
  test('a POST without a token is refused with 403', async () => {
    const api = await request(app).post('/api/v1/auth/login').send({ email: 'somchai@example.com', password: 'password123' });
    expect(api.status).toBe(403);
    expect(api.body.error.code).toBe('FORBIDDEN');

    const form = await request(app).post('/register').type('form').send({ username: 'สมชาย', email: 'somchai@example.com', password: 'password123' });
    expect(form.status).toBe(403);
    expect(form.text).toContain('แบบฟอร์มหมดอายุ');
    expect(await prisma.user.count()).toBe(0);
  });

  test('a token from someone else\'s session is refused', async () => {
    const attackerToken = await createClient(app).csrfToken();
    const victim = createClient(app);
    await victim.register();
    const res = await victim.agent.post('/api/v1/auth/logout').set('X-CSRF-Token', attackerToken);
    expect(res.status).toBe(403);
    expect((await victim.get('/api/v1/me')).status).toBe(200);
  });

  test('a logged-in member cannot be logged out by a request without a token', async () => {
    const client = createClient(app);
    await client.register();
    expect((await client.agent.post('/logout')).status).toBe(403);
    expect((await client.get('/api/v1/me')).status).toBe(200);
  });

  test('forms carry the token, and GET requests need none', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/<input type="hidden" name="_csrf" value="[\w-]{20,}">/);
  });

  test('a plain page view does not create a session', async () => {
    const res = await request(app).get('/');
    expect(sessionCookie(res)).toBeUndefined();
    expect(await prisma.session.count()).toBe(0);
  });
});

describe('permissions', () => {
  test('a visitor opening a member page is sent to login, then back', async () => {
    const res = await request(app).get('/me');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?next=%2Fme');

    const login = await request(app).get(res.headers.location);
    expect(login.text).toContain('name="next" value="/me"');
  });

  test('a visitor calling a member API gets 401', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  test('a visitor opening an admin URL is sent to login', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?next=%2Fadmin');
  });

  test('a member opening an admin URL gets 403', async () => {
    const client = createClient(app);
    await client.register();
    const res = await client.get('/admin');
    expect(res.status).toBe(403);
    expect(res.text).toContain('คุณไม่มีสิทธิ์เข้าถึงส่วนนี้');
  });

  test('an admin can open the admin page', async () => {
    const client = createClient(app);
    const { body } = await client.register();
    await prisma.user.update({ where: { id: body.data.id }, data: { role: 'admin' } });
    const res = await client.get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ผู้ดูแลระบบ');
  });

  test('losing the admin role takes effect on the next request, without logging in again', async () => {
    const client = createClient(app);
    const { body } = await client.register();
    await prisma.user.update({ where: { id: body.data.id }, data: { role: 'admin' } });
    expect((await client.get('/admin')).status).toBe(200);

    await prisma.user.update({ where: { id: body.data.id }, data: { role: 'member' } });
    expect((await client.get('/admin')).status).toBe(403);
  });

  test('a session whose account was deleted is treated as a visitor', async () => {
    const client = createClient(app);
    const { body } = await client.register();
    await prisma.user.delete({ where: { id: body.data.id } });
    expect((await client.get('/api/v1/me')).status).toBe(401);
    expect((await client.get('/')).status).toBe(200);
  });

  test('someone logged in is sent away from the login and register pages', async () => {
    const client = createClient(app);
    await client.register();
    for (const path of ['/login', '/register']) {
      const res = await client.get(path);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/me');
    }
  });

  test('pages for a logged-in user are not cached, and show their name', async () => {
    const client = createClient(app);
    await client.register();
    const res = await client.get('/me');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('somchai@example.com');
    expect(res.text).toContain('ออกจากระบบ');
  });
});

describe('change username', () => {
  test('a member can change their own username', async () => {
    const client = createClient(app);
    await client.register();
    const res = await client.patch('/api/v1/me', { username: '  ชื่อใหม่  ' });
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('ชื่อใหม่');
    expect((await client.get('/api/v1/me')).body.data.username).toBe('ชื่อใหม่');
  });

  test('only the username can be changed this way', async () => {
    const client = createClient(app);
    const { body } = await client.register();
    const res = await client.patch('/api/v1/me', { username: 'ชื่อใหม่', role: 'admin', email: 'other@example.com' });
    expect(res.status).toBe(200);
    const row = await prisma.user.findUnique({ where: { id: body.data.id } });
    expect(row).toMatchObject({ role: 'member', email: 'somchai@example.com' });
  });

  test('refuses a username that is too short, and needs a login', async () => {
    const client = createClient(app);
    await client.register();
    const res = await client.patch('/api/v1/me', { username: 'ab' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('username');

    expect((await createClient(app).patch('/api/v1/me', { username: 'ชื่อใหม่' })).status).toBe(401);
  });

  test('the form on the profile page saves, or shows the error with what was typed', async () => {
    const client = createClient(app);
    await client.register();

    const bad = await client.postForm('/me', { username: 'ab' });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain('ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร');
    expect(bad.text).toContain('value="ab"');

    const good = await client.postForm('/me', { username: 'ชื่อใหม่' });
    expect(good.status).toBe(303);
    expect(good.headers.location).toBe('/me');
    const page = await client.get('/me');
    expect(page.text).toContain('บันทึกชื่อผู้ใช้แล้ว');
    expect(page.text).toContain('value="ชื่อใหม่"');
  });
});

describe('change password', () => {
  const change = { currentPassword: 'password123', newPassword: 'new-password-456' };

  test('with the right current password, the new one works and the old one stops working', async () => {
    const client = createClient(app);
    await client.register();
    const res = await client.put('/api/v1/me/password', change);
    expect(res.status).toBe(204);

    expect((await createClient(app).login('somchai@example.com', 'new-password-456')).status).toBe(200);
    expect((await createClient(app).login('somchai@example.com', 'password123')).status).toBe(401);

    const row = await prisma.user.findUnique({ where: { email: 'somchai@example.com' } });
    expect(row.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row.passwordHash).not.toContain('new-password-456');
  });

  test('a wrong current password changes nothing', async () => {
    const client = createClient(app);
    await client.register();
    const res = await client.put('/api/v1/me/password', { currentPassword: 'wrong-password', newPassword: 'new-password-456' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ field: 'currentPassword' });
    expect((await createClient(app).login()).status).toBe(200);
  });

  test.each([
    ['a short new password', { currentPassword: 'password123', newPassword: 'short' }, 'newPassword'],
    ['a new password equal to the current one', { currentPassword: 'password123', newPassword: 'password123' }, 'newPassword'],
    ['a missing current password', { newPassword: 'new-password-456' }, 'currentPassword'],
  ])('refuses %s', async (label, body, field) => {
    const client = createClient(app);
    await client.register();
    const res = await client.put('/api/v1/me/password', body);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((detail) => detail.field)).toContain(field);
    expect((await createClient(app).login()).status).toBe(200);
  });

  test('this browser stays logged in with a new session ID; every other session is ended', async () => {
    const here = createClient(app);
    const registered = await here.register();
    const before = sessionCookie(registered).split(';')[0];
    const otherDevice = createClient(app);
    await otherDevice.login();
    expect((await otherDevice.get('/api/v1/me')).status).toBe(200);

    const res = await here.put('/api/v1/me/password', change);
    expect(sessionCookie(res).split(';')[0]).not.toBe(before);

    expect((await here.get('/api/v1/me')).status).toBe(200);
    expect((await otherDevice.get('/api/v1/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/me').set('Cookie', before)).status).toBe(401);
  });

  test('other members stay logged in', async () => {
    const other = createClient(app);
    await other.register({ email: 'other@example.com' });
    const client = createClient(app);
    await client.register();
    await client.put('/api/v1/me/password', change);
    expect((await other.get('/api/v1/me')).status).toBe(200);
  });

  test('needs a login and a CSRF token', async () => {
    expect((await createClient(app).put('/api/v1/me/password', change)).status).toBe(401);

    const client = createClient(app);
    await client.register();
    expect((await client.agent.put('/api/v1/me/password').send(change)).status).toBe(403);
    expect((await createClient(app).login()).status).toBe(200);
  });

  test('five wrong current passwords are answered 400, the sixth is throttled with 429', async () => {
    const client = createClient(app);
    await client.register();
    const wrong = { currentPassword: 'wrong-password', newPassword: 'new-password-456' };
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await client.put('/api/v1/me/password', wrong)).status).toBe(400);
    }
    expect((await client.put('/api/v1/me/password', wrong)).status).toBe(429);
    expect((await client.put('/api/v1/me/password', change)).status).toBe(429);
  });

  test('the form on the profile page changes the password, or shows the error without echoing passwords', async () => {
    const client = createClient(app);
    await client.register();

    const bad = await client.postForm('/me/password', { currentPassword: 'wrong-password', newPassword: 'new-password-456' });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain('รหัสผ่านเดิมไม่ถูกต้อง');
    expect(bad.text).not.toContain('wrong-password');
    expect(bad.text).not.toContain('new-password-456');

    const good = await client.postForm('/me/password', change);
    expect(good.status).toBe(303);
    expect(good.headers.location).toBe('/me');
    expect((await client.get('/me')).text).toContain('เปลี่ยนรหัสผ่านแล้ว');
    expect((await createClient(app).login('somchai@example.com', 'new-password-456')).status).toBe(200);
  });
});
