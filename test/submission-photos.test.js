// Several photos on a submission: up to 5, the first is the cover, the rest
// become the gallery when an admin approves it.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const storage = require('../src/storage');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();
const UUID_PATH = /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

let category;
let alice;
let admin;
let jpegs;

const fields = (overrides = {}) => {
  const base = {
    name: 'ร้านหลายรูป',
    categoryId: String(category.id),
    description: 'มีรูปหลายรูป',
    address: 'ซอยฉลองกรุง 1',
    latitude: '13.7279',
    longitude: '100.7782',
  };
  for (let day = 0; day < 7; day += 1) base[`state${day}`] = 'closed';
  return { ...base, ...overrides };
};
const withFields = (req, values) => Object.entries(values).reduce((r, [key, value]) => r.field(key, value), req);
const attachAll = (req, buffers, name = 'photos') =>
  buffers.reduce((r, buffer, i) => r.attach(name, buffer, { filename: `p${i}.jpg`, contentType: 'image/jpeg' }), req);

async function apiPost(buffers, overrides, name) {
  const token = await alice.csrfToken();
  return attachAll(withFields(alice.agent.post('/api/v1/submissions').set('X-CSRF-Token', token), fields(overrides)), buffers, name);
}
async function apiPatch(id, version, buffers) {
  const token = await alice.csrfToken();
  return attachAll(withFields(alice.agent.patch(`/api/v1/me/submissions/${id}`).set('X-CSRF-Token', token), fields({ version: String(version) })), buffers);
}
async function formPost(url, buffers, overrides) {
  const token = await alice.csrfToken();
  return attachAll(withFields(alice.agent.post(url), { _csrf: token, ...fields(overrides) }), buffers);
}

const listUploads = () => (fs.existsSync(storage.UPLOAD_DIR) ? fs.readdirSync(storage.UPLOAD_DIR).sort() : []);
const exists = (publicPath) => fs.existsSync(path.join(storage.UPLOAD_DIR, path.basename(publicPath)));

// The admin sends the submission back (the tests play that step through Prisma).
const returnToMember = (id) =>
  prisma.submission.update({ where: { id }, data: { status: 'changes_requested', reviewNote: 'แก้ไข', version: { increment: 1 } } });

beforeAll(async () => {
  jpegs = await Promise.all(
    ['#3a7d5c', '#c0392b', '#2980b9', '#8e44ad', '#f39c12', '#16a085'].map((background) =>
      sharp({ create: { width: 200, height: 150, channels: 3, background } }).jpeg().toBuffer()
    )
  );
});
beforeEach(async () => {
  await resetDatabase();
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  alice = createClient(app);
  await alice.register();
  admin = createClient(app);
  await admin.registerAdmin({ username: 'admin1', email: 'admin1@example.com' });
});
afterAll(async () => {
  fs.rmSync(storage.UPLOAD_DIR, { recursive: true, force: true });
  await closeDatabase();
});

describe('creating with several photos', () => {
  test('API: 3 photos give a cover plus 2 extras, in order, all stored as uuid webp', async () => {
    const res = await apiPost(jpegs.slice(0, 3));
    expect(res.status).toBe(201);
    const { imagePath, extraImagePaths } = res.body.data;
    expect(imagePath).toMatch(UUID_PATH);
    expect(extraImagePaths).toHaveLength(2);
    extraImagePaths.forEach((p) => expect(p).toMatch(UUID_PATH));
    expect(new Set([imagePath, ...extraImagePaths]).size).toBe(3);
    [imagePath, ...extraImagePaths].forEach((p) => expect(exists(p)).toBe(true));
    const row = await prisma.submission.findUnique({ where: { id: res.body.data.id } });
    expect(row.imagePath).toBe(imagePath);
    expect(row.extraImagePaths).toEqual(extraImagePaths);
    const event = await prisma.submissionEvent.findFirst({ where: { submissionId: row.id } });
    expect(event.snapshot.extraImagePaths).toEqual(extraImagePaths);
  });

  test('page form: 3 photos work the same and redirect to the submission', async () => {
    const res = await formPost('/submissions', jpegs.slice(0, 3));
    expect(res.status).toBe(303);
    const row = await prisma.submission.findFirst();
    expect(row.imagePath).toMatch(UUID_PATH);
    expect(row.extraImagePaths).toHaveLength(2);
  });

  test('the old single `photo` field still works', async () => {
    const res = await apiPost(jpegs.slice(0, 1), {}, 'photo');
    expect(res.status).toBe(201);
    expect(res.body.data.imagePath).toMatch(UUID_PATH);
    expect(res.body.data.extraImagePaths).toEqual([]);
  });

  test('JSON without photos still works', async () => {
    const res = await alice.post('/api/v1/submissions', {
      name: 'ไม่มีรูป',
      categoryId: category.id,
      description: 'x',
      address: 'y',
      latitude: 13.7279,
      longitude: 100.7782,
      hours: Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'closed' })),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.imagePath).toBeNull();
    expect(res.body.data.extraImagePaths).toEqual([]);
  });

  test('6 photos: 400 and nothing stored', async () => {
    const before = listUploads();
    const res = await apiPost(jpegs);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('แนบรูปได้ไม่เกิน 5 รูป');
    expect(listUploads()).toEqual(before);
    expect(await prisma.submission.count()).toBe(0);
  });

  test('one bad file in the batch: 415 and nothing stored', async () => {
    const before = listUploads();
    const token = await alice.csrfToken();
    let req = withFields(alice.agent.post('/api/v1/submissions').set('X-CSRF-Token', token), fields());
    req = attachAll(req, jpegs.slice(0, 2));
    req = req.attach('photos', Buffer.from('ไม่ใช่รูป'), { filename: 'bad.jpg', contentType: 'image/jpeg' });
    const res = await req;
    expect(res.status).toBe(415);
    expect(res.body.error.message).toContain('รูปที่ 3');
    expect(listUploads()).toEqual(before);
    expect(await prisma.submission.count()).toBe(0);
  });
});

describe('editing a returned submission', () => {
  test('new photos replace all the old ones; the old files stay for the history', async () => {
    const created = (await apiPost(jpegs.slice(0, 3))).body.data;
    const old = [created.imagePath, ...created.extraImagePaths];
    const returned = await returnToMember(created.id);
    const res = await apiPatch(created.id, returned.version, jpegs.slice(3, 5));
    expect(res.status).toBe(200);
    const fresh = [res.body.data.imagePath, ...res.body.data.extraImagePaths];
    expect(fresh).toHaveLength(2);
    old.forEach((p) => expect(exists(p)).toBe(true));
    fresh.forEach((p) => expect(exists(p)).toBe(true));
    expect(fresh.some((p) => old.includes(p))).toBe(false);
  });

  test('editing without photos keeps them (API and page form)', async () => {
    const created = (await apiPost(jpegs.slice(0, 3))).body.data;
    const old = [created.imagePath, ...created.extraImagePaths];
    const returned = await returnToMember(created.id);
    const res = await apiPatch(created.id, returned.version, []);
    expect(res.status).toBe(200);
    expect([res.body.data.imagePath, ...res.body.data.extraImagePaths]).toEqual(old);
    const form = await formPost(`/me/submissions/${created.id}`, [], { version: String(res.body.data.version) });
    expect(form.status).toBe(303);
    const row = await prisma.submission.findUnique({ where: { id: created.id } });
    expect([row.imagePath, ...row.extraImagePaths]).toEqual(old);
    old.forEach((p) => expect(exists(p)).toBe(true));
  });

  test('the edit form shows the current photos and the replace note', async () => {
    const created = (await apiPost(jpegs.slice(0, 3))).body.data;
    await returnToMember(created.id);
    const page = await alice.get(`/me/submissions/${created.id}/edit`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('name="photos"');
    expect(page.text).toContain(' multiple');
    expect(page.text).toContain('ถ้าเลือกรูปใหม่ รูปเดิมทั้งหมดจะถูกแทนที่');
    expect(page.text).toContain(created.extraImagePaths[1]);
    expect(page.text).toContain('แนบได้สูงสุด 5 รูป รูปแรกจะเป็นรูปหลัก');
  });
});

describe('editing with photoOrder (the photo picker)', () => {
  async function patchWithOrder(id, version, buffers, photoOrder) {
    const token = await alice.csrfToken();
    const req = withFields(alice.agent.patch(`/api/v1/me/submissions/${id}`).set('X-CSRF-Token', token), fields({ version: String(version), photoOrder }));
    return attachAll(req, buffers);
  }

  test('keeps, drops and reorders current photos and places new ones', async () => {
    const created = (await apiPost(jpegs.slice(0, 3))).body.data;
    const old = [created.imagePath, ...created.extraImagePaths];
    const returned = await returnToMember(created.id);
    const res = await patchWithOrder(created.id, returned.version, jpegs.slice(3, 5), 'new:1,keep:2,new:0,keep:0');
    expect(res.status).toBe(200);
    const after = [res.body.data.imagePath, ...res.body.data.extraImagePaths];
    expect(after).toHaveLength(4);
    expect(after[0]).toMatch(UUID_PATH);
    expect(old).not.toContain(after[0]);
    expect(after[1]).toBe(old[2]);
    expect(old).not.toContain(after[2]);
    expect(after[3]).toBe(old[0]);
    // old[1] was dropped but stays: the "submitted" history still shows it.
    expect(exists(old[1])).toBe(true);
  });

  test('a dropped photo stays on disk while the history still shows it', async () => {
    const created = (await apiPost([])).body.data;
    let returned = await returnToMember(created.id);
    const first = await patchWithOrder(created.id, returned.version, jpegs.slice(0, 1), 'new:0');
    const onlyHere = first.body.data.imagePath;
    expect(onlyHere).toMatch(UUID_PATH);
    // The "edited" event's snapshot uses it, so it is still kept after dropping.
    const second = await patchWithOrder(created.id, first.body.data.version, [], '');
    expect(second.status).toBe(200);
    expect(second.body.data.imagePath).toBeNull();
    expect(second.body.data.extraImagePaths).toEqual([]);
    expect(exists(onlyHere)).toBe(true);
    returned = await prisma.submission.findUnique({ where: { id: created.id } });
    expect(returned.imagePath).toBeNull();
  });

  test('an empty photoOrder removes every photo; without photoOrder nothing changes', async () => {
    const created = (await apiPost(jpegs.slice(0, 2))).body.data;
    const returned = await returnToMember(created.id);
    const res = await patchWithOrder(created.id, returned.version, [], '');
    expect(res.status).toBe(200);
    expect(res.body.data.imagePath).toBeNull();
    expect(res.body.data.extraImagePaths).toEqual([]);
  });

  test.each([
    ['a broken token', 'keep:0,oops'],
    ['an index that does not exist', 'keep:7'],
    ['a photo listed twice', 'keep:0,keep:0'],
    ['a new file left out', 'keep:0'],
  ])('refuses %s with 400 and stores nothing', async (label, order) => {
    const created = (await apiPost(jpegs.slice(0, 2))).body.data;
    const returned = await returnToMember(created.id);
    const before = listUploads();
    const res = await patchWithOrder(created.id, returned.version, jpegs.slice(2, 3), order);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(listUploads()).toEqual(before);
  });

  test('refuses more than 5 photos in total', async () => {
    const created = (await apiPost(jpegs.slice(0, 4))).body.data;
    const returned = await returnToMember(created.id);
    const res = await patchWithOrder(created.id, returned.version, jpegs.slice(4, 6), 'keep:0,keep:1,keep:2,keep:3,new:0,new:1');
    expect(res.status).toBe(400);
  });

  test('page form: photoOrder reorders and the error shows on the form', async () => {
    const created = (await apiPost(jpegs.slice(0, 3))).body.data;
    const old = [created.imagePath, ...created.extraImagePaths];
    const returned = await returnToMember(created.id);
    const ok = await formPost(`/me/submissions/${created.id}`, [], { version: String(returned.version), photoOrder: 'keep:2,keep:1' });
    expect(ok.status).toBe(303);
    const row = await prisma.submission.findUnique({ where: { id: created.id } });
    expect([row.imagePath, ...row.extraImagePaths]).toEqual([old[2], old[1]]);
    const bad = await formPost(`/me/submissions/${created.id}`, [], { version: String(row.version), photoOrder: 'keep:9' });
    expect(bad.status).toBe(400);
    expect(bad.text).toContain('ลำดับรูปไม่ถูกต้อง');
  });
});

describe('approval and display', () => {
  test('approval creates place_photos in order; the public gallery is [cover, ...extras]; files are kept', async () => {
    const created = (await apiPost(jpegs.slice(0, 4))).body.data;
    const res = await admin.post(`/api/v1/admin/submissions/${created.id}/approve`, { version: created.version });
    expect(res.status).toBe(201);
    const { placeId } = res.body.data;
    const place = await prisma.place.findUnique({ where: { id: placeId } });
    expect(place.imagePath).toBe(created.imagePath);
    const rows = await prisma.placePhoto.findMany({ where: { placeId }, orderBy: { position: 'asc' } });
    expect(rows.map((r) => r.imagePath)).toEqual(created.extraImagePaths);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    const pub = await alice.get(`/api/v1/places/${placeId}`);
    expect(pub.body.data.gallery).toEqual([created.imagePath, ...created.extraImagePaths]);
    [created.imagePath, ...created.extraImagePaths].forEach((p) => expect(exists(p)).toBe(true));
  });

  test('member and admin pages show all photos with alt text; no style= or on*=', async () => {
    const created = (await apiPost(jpegs.slice(0, 3))).body.data;
    const all = [created.imagePath, ...created.extraImagePaths];
    for (const page of [await alice.get(`/me/submissions/${created.id}`), await admin.get(`/admin/submissions/${created.id}`)]) {
      expect(page.status).toBe(200);
      all.forEach((p) => expect(page.text).toContain(`src="${p}"`));
      expect(page.text).toContain('alt="รูปหลักที่แนบมากับคำขอ"');
      expect(page.text).toContain('alt="รูปที่ 3 ที่แนบมากับคำขอ"');
      expect(page.text).not.toMatch(/\sstyle=/);
      expect(page.text).not.toMatch(/\son[a-z]+=/);
    }
    const form = await alice.get('/submissions/new');
    expect(form.text).not.toMatch(/\sstyle=/);
    expect(form.text).not.toMatch(/\son[a-z]+=/);
  });

  test('the admin place form keeps its single photo input', async () => {
    const page = await admin.get('/admin/places/new');
    expect(page.status).toBe(200);
    expect(page.text).toContain('name="photo"');
    expect(page.text).not.toContain('name="photos"');
  });
});
