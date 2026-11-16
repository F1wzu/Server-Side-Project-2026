// Admin moderation of members: list, detail, suspend and unsuspend, and what a
// suspended member can still do.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let category;
let place;
let admin;
let alice;
let bob;

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

const suspend = (client, id, body = { reason: 'เขียนรีวิวสแปม' }) => client.post(`/api/v1/admin/users/${id}/suspend`, body);
const unsuspend = (client, id, body = {}) => client.post(`/api/v1/admin/users/${id}/unsuspend`, body);
const userRow = (id) => prisma.user.findUnique({ where: { id } });

beforeEach(async () => {
  await resetDatabase();
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  place = await prisma.place.create({
    data: { categoryId: category.id, name: 'ร้านทดสอบ', description: 'รายละเอียด', address: 'ลาดกระบัง' },
  });
  admin = createClient(app);
  await admin.registerAdmin();
  alice = await member('alice');
  bob = await member('bob');
});

afterAll(closeDatabase);

// ---------------------------------------------------------------- access

describe('access control', () => {
  const routes = [
    ['get', '/api/v1/admin/users'],
    ['get', '/api/v1/admin/users/1'],
    ['post', '/api/v1/admin/users/1/suspend', { reason: 'xxx' }],
    ['post', '/api/v1/admin/users/1/unsuspend', {}],
  ];
  const pages = [
    ['get', '/admin/users'],
    ['get', '/admin/users/1'],
    ['post', '/admin/users/1/suspend', { reason: 'xxx' }],
    ['post', '/admin/users/1/unsuspend', {}],
  ];

  async function send(client, [method, path, body]) {
    if (method === 'get') return client.get(path);
    if (path.startsWith('/admin/')) return client.postForm(path, body);
    return client.post(path, body);
  }

  test('a visitor gets 401 from the API and a redirect to the login page from pages', async () => {
    const visitor = createClient(app);
    for (const route of routes) expect((await send(visitor, route)).status).toBe(401);
    for (const route of pages) {
      const res = await send(visitor, route);
      expect([302, 303]).toContain(res.status);
      expect(res.headers.location).toMatch(/^\/login/);
    }
  });

  test('a member gets 403 on every route', async () => {
    for (const route of routes) expect((await send(alice, route)).status).toBe(403);
    for (const route of pages) expect((await send(alice, route)).status).toBe(403);
  });
});

// ------------------------------------------------------------------ list

describe('member list', () => {
  test('lists members newest first with counts and no suspension', async () => {
    const created = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'อร่อย' });
    expect(created.status).toBe(201);

    const res = await admin.get('/api/v1/admin/users');
    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 3 });
    expect(res.body.data.map((row) => row.username)).toEqual(['bob', 'alice', 'ผู้ดูแล']);
    const aliceRow = res.body.data.find((row) => row.username === 'alice');
    expect(aliceRow).toEqual({
      id: alice.id,
      username: 'alice',
      email: 'alice@example.com',
      role: 'member',
      createdAt: expect.any(String),
      suspension: null,
      reviews: 1,
      removed: 0,
      submissions: 0,
    });
    expect(aliceRow).not.toHaveProperty('passwordHash');
  });

  test('counts reviews and replies an admin removed', async () => {
    const created = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 1, comment: 'แย่' });
    const reply = await bob.post(`/api/v1/reviews/${created.body.data.id}/replies`, { body: 'ตอบ' });
    expect(reply.status).toBe(201);
    expect((await admin.post(`/api/v1/admin/replies/${reply.body.data.id}/remove`, { reason: 'ไม่สุภาพ' })).status).toBe(200);
    expect((await admin.post(`/api/v1/admin/reviews/${created.body.data.id}/remove`, { reason: 'ไม่สุภาพ' })).status).toBe(200);

    const rows = (await admin.get('/api/v1/admin/users')).body.data;
    expect(rows.find((row) => row.id === alice.id)).toMatchObject({ reviews: 0, removed: 1 });
    expect(rows.find((row) => row.id === bob.id)).toMatchObject({ removed: 1 });
  });

  test('q matches part of the username or the email, ignoring case', async () => {
    const byName = await admin.get('/api/v1/admin/users?q=ALI');
    expect(byName.body.data.map((row) => row.username)).toEqual(['alice']);
    const byEmail = await admin.get('/api/v1/admin/users?q=bob@EXAMPLE');
    expect(byEmail.body.data.map((row) => row.username)).toEqual(['bob']);
    // % is not a wildcard
    expect((await admin.get('/api/v1/admin/users?q=%25')).body.meta.total).toBe(0);
  });

  test('status filters suspended and active members; an unknown status is ignored', async () => {
    expect((await suspend(admin, alice.id)).status).toBe(200);

    const suspended = await admin.get('/api/v1/admin/users?status=suspended');
    expect(suspended.body.data.map((row) => row.username)).toEqual(['alice']);
    expect(suspended.body.data[0].suspension).toMatchObject({ reason: 'เขียนรีวิวสแปม', until: null });
    expect(suspended.body.data[0].suspension.at).toEqual(expect.any(String));

    const active = await admin.get('/api/v1/admin/users?status=active');
    expect(active.body.data.map((row) => row.username)).toEqual(['bob', 'ผู้ดูแล']);

    expect((await admin.get('/api/v1/admin/users?status=nonsense')).body.meta.total).toBe(3);
  });

  test('paginates 20 per page', async () => {
    await prisma.user.createMany({
      data: Array.from({ length: 22 }, (unused, i) => ({ username: `member${i}`, email: `m${i}@example.com`, passwordHash: 'x' })),
    });
    const first = await admin.get('/api/v1/admin/users');
    expect(first.body.data).toHaveLength(20);
    expect(first.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 25 });
    const second = await admin.get('/api/v1/admin/users?page=2');
    expect(second.body.data).toHaveLength(5);
    expect(second.body.meta.page).toBe(2);
    expect((await admin.get('/api/v1/admin/users?page=abc')).body.meta.page).toBe(1);
  });

  test('deleted accounts are not listed and have no detail page', async () => {
    const gone = await member('carol');
    const res = await gone.agent
      .delete('/api/v1/me')
      .set('X-CSRF-Token', await gone.csrfToken())
      .send({ password: 'password123' });
    expect(res.status).toBe(204);
    expect(await prisma.user.count({ where: { id: gone.id } })).toBe(1); // the row is still there

    const list = await admin.get('/api/v1/admin/users');
    expect(list.body.meta.total).toBe(3);
    expect(list.body.data.map((row) => row.id)).not.toContain(gone.id);
    expect((await admin.get(`/api/v1/admin/users/${gone.id}`)).status).toBe(404);
    expect((await suspend(admin, gone.id)).status).toBe(404);
    expect((await unsuspend(admin, gone.id)).status).toBe(404);
  });
});

// ---------------------------------------------------------------- detail

describe('the placeholder email of deleted accounts', () => {
  test('cannot be registered, so nobody can pose as a deleted account or block a deletion', async () => {
    const squatter = createClient(app);
    const res = await squatter.register({ username: 'ผู้ใช้ที่ลบบัญชี', email: 'deleted-2@deleted.invalid' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('email');
    expect((await squatter.register({ username: 'ผู้ใช้ที่ลบบัญชี', email: 'Deleted-99@DELETED.invalid' })).status).toBe(400);
    expect(await prisma.user.count({ where: { email: { endsWith: '@deleted.invalid' } } })).toBe(0);
  });
});

describe('one member', () => {
  test('shows the member with the moderation history, newest first', async () => {
    await suspend(admin, alice.id, { reason: 'ครั้งแรก', days: 3 });
    await unsuspend(admin, alice.id, { note: 'ขอโทษแล้ว' });
    await suspend(admin, alice.id, { reason: 'ครั้งสอง' });

    const res = await admin.get(`/api/v1/admin/users/${alice.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: alice.id, username: 'alice', suspension: { reason: 'ครั้งสอง', until: null } });
    expect(res.body.data.events.map((event) => event.action)).toEqual(['suspended', 'unsuspended', 'suspended']);
    expect(res.body.data.events[0]).toMatchObject({ note: 'ครั้งสอง', until: null, actor: { id: admin.id, username: 'ผู้ดูแล' } });
    expect(res.body.data.events[1].note).toBe('ขอโทษแล้ว');
    expect(res.body.data.events[2].until).toEqual(expect.any(String));
  });

  test('answers 404 for an unknown or malformed id', async () => {
    expect((await admin.get('/api/v1/admin/users/99999')).status).toBe(404);
    expect((await admin.get('/api/v1/admin/users/abc')).status).toBe(404);
    expect((await admin.get('/admin/users/99999')).status).toBe(404);
  });
});

// --------------------------------------------------------------- suspend

describe('suspend', () => {
  test('sets the columns and writes an event (until lifted)', async () => {
    const res = await suspend(admin, alice.id, { reason: '  เขียนรีวิวสแปม  ' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: alice.id, suspension: { reason: 'เขียนรีวิวสแปม', until: null } });

    const row = await userRow(alice.id);
    expect(row.suspendedAt).toBeInstanceOf(Date);
    expect(row.suspendedUntil).toBeNull();
    expect(row.suspendedReason).toBe('เขียนรีวิวสแปม');
    const events = await prisma.userModerationEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: alice.id, actorId: admin.id, action: 'suspended', note: 'เขียนรีวิวสแปม', until: null });
  });

  test('days sets the end date; a form sends it as text', async () => {
    const before = Date.now();
    const res = await suspend(admin, alice.id, { reason: 'พักก่อน', days: 7 });
    expect(res.status).toBe(200);
    const until = new Date(res.body.data.suspension.until).getTime();
    expect(until).toBeGreaterThan(before + 7 * 86400000 - 1000);
    expect(until).toBeLessThan(Date.now() + 7 * 86400000 + 1000);
    expect((await prisma.userModerationEvent.findFirst()).until.getTime()).toBe(until);

    const form = await admin.postForm(`/admin/users/${bob.id}/suspend`, { reason: 'ฟอร์ม', days: '3' });
    expect(form.status).toBe(303);
    expect(form.headers.location).toBe(`/admin/users/${bob.id}`);
    const bobRow = await userRow(bob.id);
    expect(bobRow.suspendedUntil.getTime()).toBeGreaterThan(Date.now() + 2 * 86400000);

    // an empty duration means until lifted
    const carol = await member('carol');
    await admin.postForm(`/admin/users/${carol.id}/suspend`, { reason: 'ไม่กำหนด', days: '' });
    const carolRow = await userRow(carol.id);
    expect(carolRow.suspendedAt).not.toBeNull();
    expect(carolRow.suspendedUntil).toBeNull();
  });

  test.each([
    ['a missing reason', {}],
    ['a short reason', { reason: 'ab' }],
    ['an invisible reason', { reason: '   ​  ' }],
    ['a reason over 500 characters', { reason: 'ก'.repeat(501) }],
    ['days of 0', { reason: 'เหตุผล', days: 0 }],
    ['days over 365', { reason: 'เหตุผล', days: 366 }],
    ['fractional days', { reason: 'เหตุผล', days: 1.5 }],
    ['days that are not a number', { reason: 'เหตุผล', days: 'abc' }],
  ])('rejects %s with 400', async (unused, body) => {
    const res = await suspend(admin, alice.id, body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect((await userRow(alice.id)).suspendedAt).toBeNull();
    expect(await prisma.userModerationEvent.count()).toBe(0);
  });

  test('a form with a bad reason flashes the error and goes back to the member', async () => {
    const res = await admin.postForm(`/admin/users/${alice.id}/suspend`, { reason: 'ab', days: '' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/admin/users/${alice.id}`);
    expect((await admin.get(`/admin/users/${alice.id}`)).text).toContain('เหตุผลต้องมีอย่างน้อย 3 ตัวอักษร');
  });

  test('refuses an admin account and the admin themself with 409', async () => {
    const other = createClient(app);
    const registered = await other.registerAdmin({ username: 'admin2', email: 'admin2@example.com' });
    for (const id of [registered.body.data.id, admin.id]) {
      const res = await suspend(admin, id);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE');
      expect((await userRow(id)).suspendedAt).toBeNull();
    }
  });

  test('refuses a member who is suspended now with 409', async () => {
    expect((await suspend(admin, alice.id)).status).toBe(200);
    const again = await suspend(admin, alice.id, { reason: 'อีกครั้ง' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
    expect(await prisma.userModerationEvent.count()).toBe(1);
  });

  test('an expired suspension counts as not suspended, and can be replaced', async () => {
    await prisma.user.update({
      where: { id: alice.id },
      data: {
        suspendedAt: new Date(Date.now() - 3 * 86400000),
        suspendedUntil: new Date(Date.now() - 86400000),
        suspendedReason: 'หมดอายุแล้ว',
      },
    });
    expect((await admin.get('/api/v1/admin/users?status=suspended')).body.meta.total).toBe(0);
    expect((await admin.get('/api/v1/admin/users?status=active')).body.data.map((row) => row.id)).toContain(alice.id);
    expect((await admin.get(`/api/v1/admin/users/${alice.id}`)).body.data.suspension).toBeNull();
    expect((await unsuspend(admin, alice.id)).status).toBe(409);

    // she can write, then a new suspension overwrites the old columns
    expect((await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 5, comment: 'ดี' })).status).toBe(201);
    const res = await suspend(admin, alice.id, { reason: 'ครั้งใหม่' });
    expect(res.status).toBe(200);
    expect(res.body.data.suspension).toMatchObject({ reason: 'ครั้งใหม่', until: null });
    expect((await userRow(alice.id)).suspendedReason).toBe('ครั้งใหม่');
  });

  test('the database refuses a half-set or backwards suspension', async () => {
    const at = new Date();
    const bad = [
      { suspendedAt: at },
      { suspendedReason: 'x' },
      { suspendedUntil: new Date(at.getTime() + 1000) },
      { suspendedAt: at, suspendedReason: 'x', suspendedUntil: new Date(at.getTime() - 1000) },
    ];
    for (const data of bad) await expect(prisma.user.update({ where: { id: alice.id }, data })).rejects.toThrow(/users_suspension_/);
  });
});

// ------------------------------------------------------------- unsuspend

describe('unsuspend', () => {
  test('clears the columns, writes an event and lets the member write again', async () => {
    await suspend(admin, alice.id);
    expect((await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 5 })).status).toBe(403);

    const res = await unsuspend(admin, alice.id, { note: 'ตกลงกันแล้ว' });
    expect(res.status).toBe(200);
    expect(res.body.data.suspension).toBeNull();
    const row = await userRow(alice.id);
    expect([row.suspendedAt, row.suspendedUntil, row.suspendedReason]).toEqual([null, null, null]);
    const events = await prisma.userModerationEvent.findMany({ orderBy: { id: 'asc' } });
    expect(events.map((event) => event.action)).toEqual(['suspended', 'unsuspended']);
    expect(events[1]).toMatchObject({ actorId: admin.id, note: 'ตกลงกันแล้ว', until: null });

    expect((await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 5 })).status).toBe(201);
  });

  test('the note is optional and limited to 500 characters', async () => {
    await suspend(admin, alice.id);
    expect((await unsuspend(admin, alice.id, { note: 'ก'.repeat(501) })).status).toBe(400);
    expect((await unsuspend(admin, alice.id)).status).toBe(200);
    expect((await prisma.userModerationEvent.findMany({ orderBy: { id: 'desc' } }))[0].note).toBeNull();
  });

  test('answers 409 when the member is not suspended', async () => {
    const res = await unsuspend(admin, alice.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
    expect(await prisma.userModerationEvent.count()).toBe(0);
  });

  test('answers 404 for an unknown member', async () => {
    expect((await unsuspend(admin, 99999)).status).toBe(404);
  });

  test('the form flashes a message and goes back to the member', async () => {
    await suspend(admin, alice.id);
    const res = await admin.postForm(`/admin/users/${alice.id}/unsuspend`, { note: '' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/admin/users/${alice.id}`);
    expect((await admin.get(`/admin/users/${alice.id}`)).text).toContain('ยกเลิกการระงับแล้ว');
    expect((await userRow(alice.id)).suspendedAt).toBeNull();
  });
});

// ------------------------------------------------- a suspended member

describe('a suspended member', () => {
  beforeEach(async () => {
    await suspend(admin, alice.id, { reason: 'เขียนรีวิวสแปม', days: 7 });
  });

  test('can still read pages and the API', async () => {
    expect((await alice.get('/places')).status).toBe(200);
    expect((await alice.get(`/places/${place.id}`)).status).toBe(200);
    expect((await alice.get('/me')).status).toBe(200);
    const me = await alice.get('/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.data.suspension).toMatchObject({ reason: 'เขียนรีวิวสแปม' });
    expect(me.body.data).not.toHaveProperty('suspendedAt');
    expect(me.body.data).not.toHaveProperty('suspendedReason');
  });

  test('can log in again', async () => {
    const fresh = createClient(app);
    const res = await fresh.login('alice@example.com');
    expect(res.status).toBe(200);
    expect((await fresh.get('/me')).status).toBe(200);
  });

  test('cannot write: 403 ACCOUNT_SUSPENDED with the reason and end date', async () => {
    const res = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 5, comment: 'ดี' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_SUSPENDED');
    expect(res.body.error.message).toContain('เขียนรีวิวสแปม');
    expect(res.body.error.message).toMatch(/ถึงวันที่/);
    expect(await prisma.review.count()).toBe(0);

    for (const [method, path] of [
      ['put', `/api/v1/me/favorites/${place.id}`],
      ['patch', '/api/v1/me'],
    ]) {
      const other = await alice[method](path, { username: 'newname' });
      expect(other.status).toBe(403);
      expect(other.body.error.code).toBe('ACCOUNT_SUSPENDED');
    }
  });

  test('an open-ended suspension says so in the message', async () => {
    await unsuspend(admin, alice.id);
    await suspend(admin, alice.id, { reason: 'ไม่มีกำหนด' });
    const res = await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 5 });
    expect(res.body.error.message).toContain('จนกว่าผู้ดูแลจะยกเลิก');
  });

  test('a form post shows the message on the error page', async () => {
    const res = await alice.postForm(`/places/${place.id}/reviews`, { rating: '5', comment: 'ดี' });
    expect(res.status).toBe(403);
    expect(res.text).toContain('เขียนรีวิวสแปม');
  });

  test('an expired suspension no longer blocks writing', async () => {
    await prisma.user.update({ where: { id: alice.id }, data: { suspendedAt: new Date(Date.now() - 2000), suspendedUntil: new Date(Date.now() - 1000) } });
    expect((await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 5 })).status).toBe(201);
    expect((await alice.get('/places')).text).not.toContain('บัญชีของคุณถูกระงับ');
  });

  test('sees the banner with the reason on every page', async () => {
    for (const path of ['/', '/places', `/places/${place.id}`, '/me']) {
      const res = await alice.get(path);
      expect(res.text).toContain('บัญชีของคุณถูกระงับการใช้งาน');
      expect(res.text).toContain('เขียนรีวิวสแปม');
    }
    expect((await bob.get('/places')).text).not.toContain('บัญชีของคุณถูกระงับ');
  });

  test('may still change the password, delete the account and log out', async () => {
    const password = await alice.put('/api/v1/me/password', { currentPassword: 'password123', newPassword: 'newpassword456' });
    expect(password.status).toBe(204);
    // the password change ends this session; log in again with the new one
    const again = createClient(app);
    expect((await again.login('alice@example.com', 'newpassword456')).status).toBe(200);

    const logout = await again.post('/api/v1/auth/logout');
    expect(logout.status).toBe(204);
  });

  test('may log out and delete the account from the pages', async () => {
    const out = await alice.postForm('/logout');
    expect(out.status).toBe(303);
    expect((await alice.get('/me')).status).toBe(302);

    const gone = createClient(app);
    await gone.login('alice@example.com');
    const del = await gone.postForm('/me/delete', { password: 'password123' });
    expect([200, 302, 303]).toContain(del.status);
    expect((await userRow(alice.id)).username).toBe('ผู้ใช้ที่ลบบัญชี');
  });
});

// ----------------------------------------------------------------- pages

describe('admin pages', () => {
  test('the list page renders members, the search box and status tabs', async () => {
    await suspend(admin, alice.id);
    const res = await admin.get('/admin/users');
    expect(res.status).toBe(200);
    expect(res.text).toContain('สมาชิก');
    expect(res.text).toContain('alice@example.com');
    expect(res.text).toContain('ถูกระงับ');
    expect(res.text).toContain('name="q"');
    expect(res.text).toContain(`/admin/users/${alice.id}`);

    const filtered = await admin.get('/admin/users?status=suspended&q=ali');
    expect(filtered.status).toBe(200);
    expect(filtered.text).toContain('alice@example.com');
    expect(filtered.text).not.toContain('bob@example.com');
    expect((await admin.get('/admin/users?q=zzzz')).text).toContain('ไม่พบสมาชิก');
  });

  test('the member page shows the suspend form, then the unsuspend form and history', async () => {
    const before = await admin.get(`/admin/users/${alice.id}`);
    expect(before.status).toBe(200);
    expect(before.text).toContain('alice');
    expect(before.text).toContain(`/admin/users/${alice.id}/suspend`);
    expect(before.text).toContain('จนกว่าจะยกเลิก');
    expect(before.text).not.toContain(`/admin/users/${alice.id}/unsuspend`);

    await suspend(admin, alice.id, { reason: 'เหตุผลทดสอบ', days: 3 });
    const after = await admin.get(`/admin/users/${alice.id}`);
    expect(after.text).toContain(`/admin/users/${alice.id}/unsuspend`);
    expect(after.text).not.toContain(`/admin/users/${alice.id}/suspend"`);
    expect(after.text).toContain('เหตุผลทดสอบ');
    expect(after.text).toContain('ประวัติการระงับ');
  });

  test('an admin account has no suspend form', async () => {
    const res = await admin.get(`/admin/users/${admin.id}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(`/admin/users/${admin.id}/suspend`);
  });

  test('the admin menu links to members and the dashboard counts suspended ones', async () => {
    await suspend(admin, alice.id);
    const res = await admin.get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/admin/users"');
    expect(res.text).toContain('สมาชิกที่ถูกระงับ');
  });
});
