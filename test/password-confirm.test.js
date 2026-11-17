// Typing the password twice (sign-up and password change) and the show/hide
// button on password fields. There is no password reset, so a typo in a new
// password must be caught before it is saved.
const { createApp } = require('../src/app');
const { resetRateLimits } = require('../src/middleware/rateLimit');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();
const account = { username: 'สมใจ', email: 'somjai@example.com', password: 'password123' };

// A raw form post: the client's postForm helper repeats the password by
// itself, and these tests need to control the confirm field exactly.
// The token is fetched first: the agent attaches the session cookie at the
// moment a request is created.
const rawForm = async (client, path, fields) => {
  const token = await client.csrfToken();
  return client.agent
    .post(path)
    .type('form')
    .send({ _csrf: token, ...fields });
};

beforeEach(async () => {
  await resetDatabase();
  resetRateLimits();
});
afterAll(closeDatabase);

describe('sign-up form asks for the password twice', () => {
  test('a form without the confirm field is refused and the error is on that field', async () => {
    const res = await rawForm(createClient(app), '/register', { ...account, acceptPolicy: 'on' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="confirmPassword-error"');
    expect(res.text).toContain('กรุณายืนยันรหัสผ่านอีกครั้ง');
    expect(res.text).toMatch(/id="confirmPassword"[^>]*aria-invalid="true"/);
    expect(await prisma.user.count()).toBe(0);
  });

  test('an empty confirm field is refused the same way', async () => {
    const res = await rawForm(createClient(app), '/register', { ...account, acceptPolicy: 'on', confirmPassword: '' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="confirmPassword-error"');
  });

  test('two different passwords are refused; name and email are kept, passwords are not', async () => {
    const res = await rawForm(createClient(app), '/register', { ...account, acceptPolicy: 'on', confirmPassword: 'password124' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="confirmPassword-error"');
    expect(res.text).toContain('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    expect(res.text).toContain('value="สมใจ"');
    expect(res.text).toContain('value="somjai@example.com"');
    expect(res.text).not.toContain('password123');
    expect(res.text).not.toContain('password124');
    expect(await prisma.user.count()).toBe(0);
  });

  test('a mismatch is reported together with other errors, not on a second submit', async () => {
    const res = await rawForm(createClient(app), '/register', { ...account, confirmPassword: 'password124' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="acceptPolicy-error"');
    expect(res.text).toContain('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
  });

  test('matching passwords create the account, and that password logs in', async () => {
    const res = await rawForm(createClient(app), '/register', { ...account, acceptPolicy: 'on', confirmPassword: 'password123' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/me');
    expect((await createClient(app).login(account.email, 'password123')).status).toBe(200);
  });
});

describe('sign-up through the API', () => {
  test('still works without the confirm field', async () => {
    const res = await createClient(app).post('/api/v1/auth/register', { ...account, acceptPolicy: true });
    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('confirmPassword');
  });

  test('works with a matching confirm field', async () => {
    const res = await createClient(app).post('/api/v1/auth/register', { ...account, acceptPolicy: true, confirmPassword: 'password123' });
    expect(res.status).toBe(201);
  });

  test.each(['password124', '', 12345678])('a confirm field that does not match (%p) answers 400 on that field', async (confirmPassword) => {
    const res = await createClient(app).post('/api/v1/auth/register', { ...account, acceptPolicy: true, confirmPassword });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((detail) => detail.field)).toContain('confirmPassword');
    expect(await prisma.user.count()).toBe(0);
  });

  test('a mismatch is listed alongside a short password and a bad email', async () => {
    const res = await createClient(app).post('/api/v1/auth/register', { ...account, email: 'nope', password: 'short', acceptPolicy: true, confirmPassword: 'other' });
    expect(res.status).toBe(400);
    const fields = res.body.error.details.map((detail) => detail.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'password', 'confirmPassword']));
  });
});

describe('changing the password', () => {
  const change = { currentPassword: 'password123', newPassword: 'new-password-456' };

  test('the form without the confirm field is refused and the old password still works', async () => {
    const client = createClient(app);
    await client.register();
    const res = await rawForm(client, '/me/password', change);
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="confirmNewPassword-error"');
    expect(res.text).toContain('กรุณายืนยันรหัสผ่านอีกครั้ง');
    expect((await createClient(app).login()).status).toBe(200);
  });

  test('the form with two different new passwords is refused without echoing them', async () => {
    const client = createClient(app);
    await client.register();
    const res = await rawForm(client, '/me/password', { ...change, confirmNewPassword: 'new-password-457' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="confirmNewPassword-error"');
    expect(res.text).toContain('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    expect(res.text).not.toContain('new-password-456');
    expect(res.text).not.toContain('new-password-457');
    expect((await createClient(app).login()).status).toBe(200);
  });

  test('a mistyped confirm field is not counted as a wrong-password guess', async () => {
    const client = createClient(app);
    await client.register();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await rawForm(client, '/me/password', { ...change, confirmNewPassword: 'typo-typo-typo' })).status).toBe(400);
    }
    expect((await rawForm(client, '/me/password', { ...change, confirmNewPassword: change.newPassword })).status).toBe(303);
  });

  test('the form with matching new passwords changes the password', async () => {
    const client = createClient(app);
    await client.register();
    const res = await rawForm(client, '/me/password', { ...change, confirmNewPassword: change.newPassword });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/me');
    expect((await createClient(app).login('somchai@example.com', 'new-password-456')).status).toBe(200);
  });

  test('the API still works without the confirm field', async () => {
    const client = createClient(app);
    await client.register();
    expect((await client.put('/api/v1/me/password', change)).status).toBe(204);
  });

  test('the API refuses a confirm field that does not match', async () => {
    const client = createClient(app);
    await client.register();
    const res = await client.put('/api/v1/me/password', { ...change, confirmNewPassword: 'new-password-457' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((detail) => detail.field)).toContain('confirmNewPassword');
    expect((await createClient(app).login()).status).toBe(200);

    expect((await client.put('/api/v1/me/password', { ...change, confirmNewPassword: change.newPassword })).status).toBe(204);
  });
});

describe('show/hide button on password fields', () => {
  // The button as the server sends it: hidden until the script runs, a real
  // non-submitting button, named in Thai, tied to its input.
  const toggleFor = (name) =>
    `<button type="button" class="password-toggle" data-password-toggle aria-controls="${name}" aria-pressed="false" aria-label="แสดงรหัสผ่าน" hidden>`;
  const count = (text, part) => text.split(part).length - 1;

  test('login has one, and loads the script', async () => {
    const { text } = await createClient(app).get('/login');
    expect(text).toContain(toggleFor('password'));
    expect(count(text, 'data-password-toggle')).toBe(1);
    expect(text).toMatch(/<script src="\/js\/password\.js\?v=[0-9a-f]{10}" defer><\/script>/);
    expect(text).toMatch(/id="password"[^>]*autocomplete="current-password"/);
  });

  test('register has one per password field', async () => {
    const { text } = await createClient(app).get('/register');
    expect(text).toContain(toggleFor('password'));
    expect(text).toContain(toggleFor('confirmPassword'));
    expect(count(text, 'data-password-toggle')).toBe(2);
    expect(text).toMatch(/id="confirmPassword"[^>]*autocomplete="new-password"/);
    expect(text).toMatch(/<script src="\/js\/password\.js\?v=[0-9a-f]{10}" defer><\/script>/);
  });

  test('the account page has one per password field; other fields have none', async () => {
    const client = createClient(app);
    await client.register();
    const { text } = await client.get('/me');
    for (const name of ['currentPassword', 'newPassword', 'confirmNewPassword', 'sessionsPassword', 'password']) expect(text).toContain(toggleFor(name));
    expect(count(text, 'data-password-toggle')).toBe(5);
    expect(text).not.toContain('aria-controls="username"');
    expect(text).toMatch(/<script src="\/js\/password\.js\?v=[0-9a-f]{10}" defer><\/script>/);
  });

  test('the script is served and names both states in Thai', async () => {
    const res = await createClient(app).get('/js/password.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('แสดงรหัสผ่าน');
    expect(res.text).toContain('ซ่อนรหัสผ่าน');
  });
});
