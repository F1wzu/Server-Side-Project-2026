// Admin: the activity history (/admin/activity), built from the timestamps the
// tables already keep.
const { createApp } = require('../src/app');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');
const { KIND_LABELS } = require('../src/controllers/activityController');

const app = createApp();

// Seven days of unknown opening hours (a submission must send all seven).
const WEEK = Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'unknown' }));

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

// Sends a request and insists on the status, so a broken setup fails loudly.
async function ok(promise, status) {
  const res = await promise;
  expect(res.status).toBe(status);
  return res.body.data;
}

const feed = async (query = '') => (await admin.get(`/api/v1/admin/activity${query}`)).body;
const kinds = (body) => body.data.map((entry) => entry.kind);

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

describe('access control', () => {
  test('a visitor is sent to log in and a member is refused', async () => {
    const visitor = createClient(app);
    expect((await visitor.get('/api/v1/admin/activity')).status).toBe(401);
    const page = await visitor.get('/admin/activity');
    expect([302, 303]).toContain(page.status);
    expect(page.headers.location).toMatch(/^\/login/);

    expect((await alice.get('/api/v1/admin/activity')).status).toBe(403);
    expect((await alice.get('/admin/activity')).status).toBe(403);
  });
});

describe('the feed', () => {
  test('starts with the sign-ups', async () => {
    const body = await feed();
    expect(kinds(body)).toEqual(['member_joined', 'member_joined', 'member_joined']);
    expect(body.data.map((entry) => entry.actor.username).sort()).toEqual(['alice', 'bob', 'ผู้ดูแล']);
    expect(body.meta).toEqual({ page: 1, pageSize: 50, total: 3 });
    // No private columns come along.
    expect(JSON.stringify(body)).not.toMatch(/password|email/i);
  });

  test('lists reviews, replies, reports and what the admin did about them', async () => {
    const review = await ok(alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'อร่อยมาก' }), 201);
    const reply = await ok(bob.post(`/api/v1/reviews/${review.id}/replies`, { body: 'ขอบคุณครับ' }), 201);
    await ok(bob.post(`/api/v1/reviews/${review.id}/reports`, { reason: 'spam', details: 'โฆษณา' }), 201);
    const report = await ok(bob.post(`/api/v1/places/${place.id}/reports`, { reason: 'closed', details: 'ปิดแล้ว' }), 201);
    await ok(admin.post(`/api/v1/admin/reports/${report.id}/resolve`, { status: 'dismissed' }), 200);
    await ok(admin.post(`/api/v1/admin/replies/${reply.id}/remove`, { reason: 'ไม่สุภาพ' }), 200);
    await ok(admin.post(`/api/v1/admin/reviews/${review.id}/remove`, { reason: 'สแปม' }), 200);

    const body = await feed();
    expect(kinds(body).sort()).toEqual(
      [
        'member_joined',
        'member_joined',
        'member_joined',
        'review_posted',
        'reply_posted',
        'review_reported',
        'place_reported',
        'place_report_dismissed',
        'reply_removed',
        'review_removed',
        // Removing the review closes its open report as resolved.
        'review_report_resolved',
      ].sort()
    );
    // Every kind the feed can produce has a Thai label for the page.
    for (const kind of kinds(body)) expect(KIND_LABELS[kind]).toBeDefined();

    const removed = body.data.find((entry) => entry.kind === 'review_removed');
    expect(removed).toMatchObject({
      group: 'reviews',
      actor: { id: admin.id, username: 'ผู้ดูแล' },
      subject: 'ร้านทดสอบ',
      note: 'สแปม',
      link: `/admin/places/${place.id}/reviews`,
    });
    const reported = body.data.find((entry) => entry.kind === 'place_reported');
    expect(reported).toMatchObject({ actor: { username: 'bob' }, note: 'ปิดแล้ว', link: `/admin/places/${place.id}/reports` });
  });

  test('lists each step of a submission and links to it', async () => {
    const submission = await ok(
      alice.post('/api/v1/submissions', { name: 'ร้านใหม่', categoryId: category.id, description: 'ร้านกาแฟเปิดใหม่ใกล้สถาบัน', address: 'ซอยเกกีงาม 1', latitude: 13.7271, longitude: 100.7784, hours: WEEK }),
      201
    );
    await ok(admin.post(`/api/v1/admin/submissions/${submission.id}/return`, { version: 1, reason: 'ขอที่อยู่เพิ่ม' }), 200);

    const body = await feed('?group=submissions');
    expect(kinds(body).sort()).toEqual(['submission_returned', 'submission_submitted']);
    const returned = body.data.find((entry) => entry.kind === 'submission_returned');
    expect(returned).toMatchObject({ actor: { username: 'ผู้ดูแล' }, subject: 'ร้านใหม่', note: 'ขอที่อยู่เพิ่ม', link: `/admin/submissions/${submission.id}` });
  });

  test('lists a suspension and its lifting, linked to the member', async () => {
    await ok(admin.post(`/api/v1/admin/users/${bob.id}/suspend`, { reason: 'โพสต์โฆษณาซ้ำ ๆ', days: 7 }), 200);
    await ok(admin.post(`/api/v1/admin/users/${bob.id}/unsuspend`, { note: 'ตักเตือนแล้ว' }), 200);

    const body = await feed('?group=members');
    expect(kinds(body).sort()).toEqual(['member_joined', 'member_joined', 'member_joined', 'member_suspended', 'member_unsuspended']);
    const suspended = body.data.find((entry) => entry.kind === 'member_suspended');
    expect(suspended).toMatchObject({
      group: 'members',
      actor: { id: admin.id, username: 'ผู้ดูแล' },
      subject: 'bob',
      note: 'โพสต์โฆษณาซ้ำ ๆ',
      link: `/admin/users/${bob.id}`,
    });
    expect(body.data.find((entry) => entry.kind === 'member_unsuspended').note).toBe('ตักเตือนแล้ว');
    for (const kind of kinds(body)) expect(KIND_LABELS[kind]).toBeDefined();

    const page = await admin.get('/admin/activity?group=members');
    expect(page.text).toContain('ระงับบัญชีสมาชิก');
    expect(page.text).toContain(`href="/admin/users/${bob.id}"`);
  });

  test('is newest first', async () => {
    await prisma.user.update({ where: { id: alice.id }, data: { createdAt: new Date(Date.now() - 3600_000) } });
    await ok(bob.post(`/api/v1/places/${place.id}/reviews`, { rating: 5, comment: 'ดีมาก' }), 201);

    const body = await feed();
    expect(body.data[0].kind).toBe('review_posted');
    expect(body.data.at(-1).actor.username).toBe('alice');
    const times = body.data.map((entry) => new Date(entry.at).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  test('filters by group and ignores an unknown group', async () => {
    await ok(alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'อร่อยมาก' }), 201);

    expect(kinds(await feed('?group=reviews'))).toEqual(['review_posted']);
    expect((await feed('?group=members')).meta.total).toBe(3);
    expect((await feed('?group=reports')).data).toEqual([]);
    expect((await feed('?group=nonsense')).meta.total).toBe(4);
    expect((await feed("?group=' OR 1=1 --")).meta.total).toBe(4);
  });

  test('pages 50 at a time, and a page past the end shows the last one', async () => {
    await prisma.user.createMany({
      data: Array.from({ length: 60 }, (unused, index) => ({ username: `member${index}`, email: `m${index}@example.com`, passwordHash: 'x' })),
    });

    const first = await feed();
    expect(first.meta).toEqual({ page: 1, pageSize: 50, total: 63 });
    expect(first.data).toHaveLength(50);
    const second = await feed('?page=2');
    expect(second.data).toHaveLength(13);
    expect((await feed('?page=99')).meta.page).toBe(2);
    expect((await feed('?page=abc')).meta.page).toBe(1);
    expect((await feed('?page=-1')).meta.page).toBe(1);
  });
});

describe('the page', () => {
  test('shows the entries with Thai labels, and a link in the admin menu', async () => {
    await ok(alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'อร่อยมาก' }), 201);

    const page = await admin.get('/admin/activity');
    expect(page.status).toBe(200);
    expect(page.text).toContain('บันทึกกิจกรรม');
    expect(page.text).toContain('เขียนรีวิว');
    expect(page.text).toContain('>สมัครสมาชิก</td>');
    expect(page.text).toContain(`href="/admin/places/${place.id}/reviews"`);
    expect(page.text).toContain('href="/admin/activity" aria-current="page"');
    expect(page.text).toContain('href="/admin/activity?group=reviews"');
    // The person who did it links to their member page.
    expect(page.text).toContain(`<a class="text-link" href="/admin/users/${alice.id}">alice</a>`);

    const filtered = await admin.get('/admin/activity?group=reviews');
    expect(filtered.text).toContain('เขียนรีวิว');
    expect(filtered.text).not.toContain('>สมัครสมาชิก</td>');
  });

  test('escapes what members wrote', async () => {
    await ok(bob.post(`/api/v1/places/${place.id}/reports`, { reason: 'other', details: '<script>alert(1)</script>' }), 201);
    const page = await admin.get('/admin/activity');
    expect(page.text).not.toContain('<script>alert(1)</script>');
    expect(page.text).toContain('&lt;script&gt;');
  });

  test('says so when a group is empty', async () => {
    const page = await admin.get('/admin/activity?group=reports');
    expect(page.status).toBe(200);
    expect(page.text).toContain('ยังไม่มีกิจกรรมในหมวดนี้');
  });
});
