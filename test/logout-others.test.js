// "Log out other devices" on the account page: asks for the password, keeps
// this browser logged in, and ends every other session of the account.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let phone;
let laptop;
let stranger;

beforeEach(async () => {
  await resetDatabase();
  phone = createClient(app);
  await phone.register();
  laptop = createClient(app);
  expect((await laptop.login()).status).toBe(200);
  stranger = createClient(app);
  await stranger.register({ username: 'คนอื่น', email: 'other@example.com' });
});

afterAll(closeDatabase);

const loggedIn = async (client) => (await client.get('/api/v1/me')).status === 200;

describe('API: POST /api/v1/me/logout-others', () => {
  test('keeps this device, logs out the other one, leaves other accounts alone', async () => {
    const res = await phone.post('/api/v1/me/logout-others', { password: 'password123' });
    expect(res.status).toBe(204);
    expect(await loggedIn(phone)).toBe(true);
    expect(await loggedIn(laptop)).toBe(false);
    expect(await loggedIn(stranger)).toBe(true);
    // The other device can simply log in again.
    expect((await laptop.login()).status).toBe(200);
    expect(await loggedIn(laptop)).toBe(true);
  });

  test('a wrong or missing password changes nothing', async () => {
    const wrong = await phone.post('/api/v1/me/logout-others', { password: 'not-it' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details[0].field).toBe('password');
    expect((await phone.post('/api/v1/me/logout-others', {})).status).toBe(400);
    expect(await loggedIn(phone)).toBe(true);
    expect(await loggedIn(laptop)).toBe(true);
  });

  test('needs a logged-in member', async () => {
    const guest = createClient(app);
    expect((await guest.post('/api/v1/me/logout-others', { password: 'password123' })).status).toBe(401);
  });
});

describe('page: POST /me/logout-others', () => {
  test('the account page offers it behind a button', async () => {
    const page = await phone.get('/me');
    expect(page.text).toContain('อุปกรณ์ที่เข้าสู่ระบบ');
    expect(page.text).toContain('action="/me/logout-others"');
    expect(page.text).toMatch(/<details class="settings-reveal">\s*<summary[^>]*>ออกจากระบบอุปกรณ์อื่น/);
    // Two password boxes on the page (this one and "delete account") keep different ids.
    expect(page.text).toContain('id="sessionsPassword"');
    expect(page.text.match(/id="password"/g)).toHaveLength(1);
  });

  test('success: back to the account page with a message, the other device is out', async () => {
    const res = await phone.postForm('/me/logout-others', { password: 'password123' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/me');
    expect((await phone.get('/me')).text).toContain('ออกจากระบบอุปกรณ์อื่นทั้งหมดแล้ว');
    expect(await loggedIn(laptop)).toBe(false);
  });

  test('a wrong password shows the error with the section already open', async () => {
    const res = await phone.postForm('/me/logout-others', { password: 'not-it' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('รหัสผ่านไม่ถูกต้อง');
    expect(res.text).toMatch(/<details class="settings-reveal" open>\s*<summary[^>]*>ออกจากระบบอุปกรณ์อื่น/);
    expect(await loggedIn(laptop)).toBe(true);
    const user = await prisma.user.findFirst({ where: { email: 'somchai@example.com' } });
    expect(user.sessionVersion).toBe(1);
  });
});
