// The three "delete" gaps: a member deletes an undecided submission (or
// withdraws it to a draft, which keeps everything), an
// admin permanently deletes a place (only when nobody reviewed it), and a
// member deletes their own account.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const storage = require('../src/storage');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();

let category;
let admin;
let alice;
let bob;
let jpeg;

async function member(name) {
  const client = createClient(app);
  const res = await client.register({ username: name, email: `${name}@example.com` });
  client.id = res.body.data.id;
  return client;
}

async function del(client, url, body = {}) {
  const token = await client.csrfToken();
  return client.agent.delete(url).set('X-CSRF-Token', token).send(body);
}

const week = () => Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'unknown' }));
const content = (name = 'ร้านทดสอบลบ') => ({ name, categoryId: category.id, description: 'd', address: 'ลาดกระบัง', latitude: 13.7299, longitude: 100.7782, hours: week() });

async function submit(client, name) {
  const res = await client.post('/api/v1/submissions', content(name));
  expect(res.status).toBe(201);
  return res.body.data;
}

// A submission with one photo, through the real multipart endpoint.
async function submitWithPhoto(client) {
  const token = await client.csrfToken();
  let req = client.agent.post('/api/v1/submissions').set('X-CSRF-Token', token);
  const values = { name: 'ร้านมีรูป', categoryId: String(category.id), description: 'd', address: 'ลาดกระบัง', latitude: '13.7299', longitude: '100.7782' };
  for (let day = 0; day < 7; day += 1) values[`state${day}`] = 'closed';
  for (const [key, value] of Object.entries(values)) req = req.field(key, value);
  const res = await req.attach('photos', jpeg, { filename: 'p.jpg', contentType: 'image/jpeg' });
  expect(res.status).toBe(201);
  return res.body.data;
}

const fileExists = (publicPath) => fs.existsSync(path.join(storage.UPLOAD_DIR, path.basename(publicPath)));

async function approve(submission) {
  const res = await admin.post(`/api/v1/admin/submissions/${submission.id}/approve`, { version: submission.version });
  expect(res.status).toBe(201);
  return (await prisma.submission.findUnique({ where: { id: submission.id } })).placeId;
}

beforeAll(async () => {
  jpeg = await sharp({ create: { width: 120, height: 90, channels: 3, background: '#3a7d5c' } }).jpeg().toBuffer();
});

beforeEach(async () => {
  await resetDatabase();
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  admin = createClient(app);
  await admin.registerAdmin();
  alice = await member('alice');
  bob = await member('bobby');
});

afterAll(closeDatabase);

// ---------------------------------------------------------------- withdraw

describe('a member deletes a submission', () => {
  test('a pending one is deleted with its history', async () => {
    const submission = await submit(alice);
    expect((await del(alice, `/api/v1/me/submissions/${submission.id}`, { version: submission.version })).status).toBe(204);
    expect(await prisma.submission.findUnique({ where: { id: submission.id } })).toBeNull();
    expect(await prisma.submissionEvent.count({ where: { submissionId: submission.id } })).toBe(0);
  });

  test('a returned one can be deleted too', async () => {
    const submission = await submit(alice);
    await prisma.submission.update({ where: { id: submission.id }, data: { status: 'changes_requested', reviewNote: 'แก้', version: 2 } });
    expect((await del(alice, `/api/v1/me/submissions/${submission.id}`, { version: 2 })).status).toBe(204);
  });

  test('its photo file is deleted', async () => {
    const submission = await submitWithPhoto(alice);
    expect(fileExists(submission.imagePath)).toBe(true);
    await del(alice, `/api/v1/me/submissions/${submission.id}`, { version: submission.version });
    expect(fileExists(submission.imagePath)).toBe(false);
  });

  test('an approved one cannot be deleted', async () => {
    const submission = await submit(alice);
    await approve(submission);
    const res = await del(alice, `/api/v1/me/submissions/${submission.id}`, { version: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  test('an old version is refused, someone else\'s is not found', async () => {
    const submission = await submit(alice);
    expect((await del(alice, `/api/v1/me/submissions/${submission.id}`, { version: 9 })).body.error.code).toBe('STALE_VERSION');
    expect((await del(bob, `/api/v1/me/submissions/${submission.id}`, { version: 1 })).status).toBe(404);
    expect((await del(alice, `/api/v1/me/submissions/${submission.id}`, {})).status).toBe(400);
    expect(await prisma.submission.count()).toBe(1);
  });

  test('the page form deletes and returns to "my submissions"', async () => {
    const submission = await submit(alice);
    const page = await alice.get(`/me/submissions/${submission.id}`);
    expect(page.text).toContain('ลบคำขอนี้');
    const res = await alice.postForm(`/me/submissions/${submission.id}/delete`, { version: String(submission.version) });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/me/submissions');
    expect((await alice.get('/me/submissions')).text).toContain('ลบคำขอแล้ว');
    expect(await prisma.submission.count()).toBe(0);
  });
});

describe('a member withdraws a submission to a draft', () => {
  test('withdrawing keeps everything: text, photo, history; admins no longer see it', async () => {
    const submission = await submitWithPhoto(alice);
    const res = await alice.post(`/api/v1/me/submissions/${submission.id}/withdraw`, { version: submission.version });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'draft', version: 2, name: 'ร้านมีรูป', imagePath: submission.imagePath });
    expect(fileExists(submission.imagePath)).toBe(true);
    const events = await prisma.submissionEvent.findMany({ where: { submissionId: submission.id }, orderBy: { id: 'asc' } });
    expect(events.map((event) => event.action)).toEqual(['submitted', 'withdrawn']);

    expect((await admin.get('/api/v1/admin/submissions?status=all')).body.data).toHaveLength(0);
    expect((await admin.get(`/api/v1/admin/submissions/${submission.id}`)).status).toBe(404);
    const approve = await admin.post(`/api/v1/admin/submissions/${submission.id}/approve`, { version: 2 });
    expect(approve.status).not.toBe(201);
    expect(await prisma.place.count()).toBe(0);
  });

  test('a draft can be edited, then sent again and approved', async () => {
    const submission = await submit(alice);
    await alice.post(`/api/v1/me/submissions/${submission.id}/withdraw`, { version: 1 });
    const edit = await alice.patch(`/api/v1/me/submissions/${submission.id}`, { ...content('ชื่อที่แก้แล้ว'), version: 2 });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({ status: 'draft', name: 'ชื่อที่แก้แล้ว', version: 3 });
    const sent = await alice.post(`/api/v1/me/submissions/${submission.id}/resubmit`, { version: 3 });
    expect(sent.body.data).toMatchObject({ status: 'pending', version: 4 });
    expect(await approve({ id: submission.id, version: 4 })).toEqual(expect.any(Number));
  });

  test('only a pending one can be withdrawn; old versions and other members are refused', async () => {
    const submission = await submit(alice);
    expect((await alice.post(`/api/v1/me/submissions/${submission.id}/withdraw`, { version: 9 })).body.error.code).toBe('STALE_VERSION');
    expect((await bob.post(`/api/v1/me/submissions/${submission.id}/withdraw`, { version: 1 })).status).toBe(404);
    await alice.post(`/api/v1/me/submissions/${submission.id}/withdraw`, { version: 1 });
    const again = await alice.post(`/api/v1/me/submissions/${submission.id}/withdraw`, { version: 2 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_STATE');
  });

  test('a draft can still be deleted for good', async () => {
    const submission = await submit(alice);
    await alice.post(`/api/v1/me/submissions/${submission.id}/withdraw`, { version: 1 });
    expect((await del(alice, `/api/v1/me/submissions/${submission.id}`, { version: 2 })).status).toBe(204);
    expect(await prisma.submission.count()).toBe(0);
  });

  test('the page: withdraw button, then the draft page offers edit and send', async () => {
    const submission = await submit(alice);
    const url = `/me/submissions/${submission.id}`;
    expect((await alice.get(url)).text).toContain('ถอนกลับมาแก้ไข');
    const res = await alice.postForm(`${url}/withdraw`, { version: '1' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(url);
    const page = await alice.get(url);
    expect(page.text).toContain('ถอนคำขอกลับมาเป็นฉบับร่างแล้ว');
    expect(page.text).toContain('ฉบับร่าง');
    expect(page.text).toContain(`href="${url}/edit"`);
    expect(page.text).toContain(`action="${url}/resubmit"`);
    expect((await alice.get(`${url}/edit`)).status).toBe(200);
    expect(await prisma.submission.count()).toBe(1);
  });
});

// ---------------------------------------------------------------- delete place

describe('an admin permanently deletes a place', () => {
  const makePlace = () => prisma.place.create({ data: { categoryId: category.id, name: 'ที่ทดสอบ', description: 'd', address: 'ลาดกระบัง' } });

  test('a place nobody reviewed is deleted with its hours, saves and reports', async () => {
    const place = await makePlace();
    await prisma.placeHours.createMany({ data: week().map((day) => ({ placeId: place.id, ...day })) });
    expect((await alice.put(`/api/v1/me/favorites/${place.id}`)).status).toBeLessThan(300);
    expect((await alice.post(`/api/v1/places/${place.id}/reports`, { reason: 'closed' })).status).toBe(201);
    expect((await del(admin, `/api/v1/admin/places/${place.id}`)).status).toBe(204);
    expect(await prisma.place.findUnique({ where: { id: place.id } })).toBeNull();
    expect(await prisma.favorite.count()).toBe(0);
    expect(await prisma.placeReport.count()).toBe(0);
    expect(await prisma.placeHours.count()).toBe(0);
  });

  test('a place with any review is refused (use hide instead)', async () => {
    const place = await makePlace();
    await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'ดี' });
    const review = await prisma.review.findFirst();
    await prisma.review.update({ where: { id: review.id }, data: { status: 'deleted' } }); // even a deleted one
    const res = await del(admin, `/api/v1/admin/places/${place.id}`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/ซ่อนจากหน้าสาธารณะ/);
    expect(await prisma.place.count()).toBe(1);
  });

  test('a place made from a submission takes that submission and its photo with it', async () => {
    const submission = await submitWithPhoto(alice);
    const placeId = await approve(submission);
    expect(fileExists(submission.imagePath)).toBe(true);
    expect((await del(admin, `/api/v1/admin/places/${placeId}`)).status).toBe(204);
    expect(await prisma.submission.count()).toBe(0);
    expect(fileExists(submission.imagePath)).toBe(false);
  });

  test('members cannot; unknown places are 404', async () => {
    const place = await makePlace();
    expect((await del(alice, `/api/v1/admin/places/${place.id}`)).status).toBe(403);
    expect((await del(admin, '/api/v1/admin/places/999999')).status).toBe(404);
  });

  test('the edit page offers it as a second option and the form works', async () => {
    const place = await makePlace();
    const page = await admin.get(`/admin/places/${place.id}/edit`);
    expect(page.text).toContain('ลบสถานที่นี้ถาวร');
    const res = await admin.postForm(`/admin/places/${place.id}/delete`);
    expect(res.headers.location).toBe('/admin/places');
    expect(await prisma.place.count()).toBe(0);
  });

  test('a refused page delete goes back to the edit page with the reason', async () => {
    const place = await makePlace();
    await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 4, comment: 'ดี' });
    const res = await admin.postForm(`/admin/places/${place.id}/delete`);
    expect(res.headers.location).toBe(`/admin/places/${place.id}/edit`);
    expect((await admin.get(res.headers.location)).text).toContain('ลบถาวรไม่ได้');
  });
});

// ---------------------------------------------------------------- delete account

describe('a member deletes their account', () => {
  test('reviews and replies go, ratings are recalculated, saves and undecided submissions are deleted', async () => {
    const place = await prisma.place.create({ data: { categoryId: category.id, name: 'ร้านคะแนน', description: 'd', address: 'ลาดกระบัง' } });
    await alice.post(`/api/v1/places/${place.id}/reviews`, { rating: 1, comment: 'แย่' });
    await bob.post(`/api/v1/places/${place.id}/reviews`, { rating: 5, comment: 'ดีมาก' });
    const bobReview = await prisma.review.findFirst({ where: { userId: bob.id } });
    await alice.post(`/api/v1/reviews/${bobReview.id}/replies`, { body: 'ไม่เห็นด้วย' });
    await alice.put(`/api/v1/me/favorites/${place.id}`);
    const pending = await submitWithPhoto(alice);
    const approved = await submit(alice, 'ร้านที่อนุมัติแล้ว');
    const approvedPlaceId = await approve(approved);

    expect((await del(alice, '/api/v1/me', { password: 'password123' })).status).toBe(204);

    const row = await prisma.place.findUnique({ where: { id: place.id } });
    expect(row.ratingCount).toBe(1);
    expect(Number(row.ratingAvg)).toBe(5);
    expect(await prisma.review.count({ where: { userId: alice.id, status: 'active' } })).toBe(0);
    expect(await prisma.reviewReply.count({ where: { userId: alice.id, status: 'active' } })).toBe(0);
    expect(await prisma.favorite.count({ where: { userId: alice.id } })).toBe(0);
    expect(await prisma.submission.findUnique({ where: { id: pending.id } })).toBeNull();
    expect(fileExists(pending.imagePath)).toBe(false);
    // The place her approved submission created stays.
    expect(await prisma.place.findUnique({ where: { id: approvedPlaceId } })).not.toBeNull();

    const user = await prisma.user.findUnique({ where: { id: alice.id } });
    expect(user.username).toBe('ผู้ใช้ที่ลบบัญชี');
    expect(user.email).not.toContain('alice');
  });

  test('the session ends, the old password no longer works, and the email can register again', async () => {
    await del(alice, '/api/v1/me', { password: 'password123' });
    expect((await alice.get('/api/v1/me')).status).toBe(401);
    expect((await createClient(app).login('alice@example.com', 'password123')).status).toBe(401);
    expect((await createClient(app).register({ username: 'alice2', email: 'alice@example.com' })).status).toBe(201);
  });

  test('other devices are logged out too', async () => {
    const otherDevice = createClient(app);
    expect((await otherDevice.login('alice@example.com', 'password123')).status).toBe(200);
    await del(alice, '/api/v1/me', { password: 'password123' });
    expect((await otherDevice.get('/api/v1/me')).status).toBe(401);
  });

  test('a wrong or missing password is refused and nothing changes', async () => {
    const wrong = await del(alice, '/api/v1/me', { password: 'not-it' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details[0].field).toBe('password');
    expect((await del(alice, '/api/v1/me', {})).status).toBe(400);
    expect((await alice.get('/api/v1/me')).status).toBe(200);
  });

  test('admins cannot delete their account from the site', async () => {
    const res = await del(admin, '/api/v1/me', { password: 'password123' });
    expect(res.status).toBe(409);
    expect((await admin.get('/me')).text).not.toContain('ลบบัญชีของฉัน');
  });

  test('the page form deletes, logs out and says goodbye', async () => {
    expect((await alice.get('/me')).text).toContain('ลบบัญชีของฉัน');
    const res = await alice.postForm('/me/delete', { password: 'password123' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/');
    const home = await alice.get('/');
    expect(home.text).toContain('ลบบัญชีแล้ว');
    expect((await alice.get('/me')).status).toBe(302);
  });

  test('a wrong password on the page form shows the error in the open section', async () => {
    const res = await alice.postForm('/me/delete', { password: 'nope' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('รหัสผ่านไม่ถูกต้อง');
    expect(res.text).toMatch(/<details class="danger-zone" open>/);
  });
});
