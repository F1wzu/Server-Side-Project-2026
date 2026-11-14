// The model behind `npm run admin:create` (scripts/create-admin.js). Admins
// cannot sign up through the site, so the demo depends on this working.
const { createApp } = require('../src/app');
const userModel = require('../src/models/user');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe('createOrPromoteAdmin', () => {
  test('creates a new admin who can log in and open /admin', async () => {
    expect(await userModel.emailExists('boss@example.com')).toBe(false);
    const { user, created } = await userModel.createOrPromoteAdmin({ username: 'ผู้ดูแล', email: 'boss@example.com', password: 'password123' });
    expect(created).toBe(true);
    expect(user).toMatchObject({ email: 'boss@example.com', role: 'admin' });
    expect(user.passwordHash).toBeUndefined(); // only public fields come back
    expect(await userModel.emailExists('boss@example.com')).toBe(true);

    const client = createClient(app);
    expect((await client.login('boss@example.com', 'password123')).status).toBe(200);
    expect((await client.get('/admin')).status).toBe(200);
  });

  test('promotes an existing member and keeps their password', async () => {
    const member = createClient(app);
    await member.register({ email: 'somchai@example.com' });
    const before = await prisma.user.findUnique({ where: { email: 'somchai@example.com' } });

    const { user, created } = await userModel.createOrPromoteAdmin({ email: 'somchai@example.com' });
    expect(created).toBe(false);
    expect(user.role).toBe('admin');
    const after = await prisma.user.findUnique({ where: { email: 'somchai@example.com' } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await prisma.user.count()).toBe(1);

    // The role is read from the database on every request, so the open session is an admin now.
    expect((await member.get('/admin')).status).toBe(200);
  });
});
