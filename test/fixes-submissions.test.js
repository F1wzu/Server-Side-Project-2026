// Fixes: history keeps its photos, upload errors on the page forms re-render
// the form, and a huge version number is a 400.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const storage = require('../src/storage');
const { isUploadUnused } = require('../src/models/photoUsage');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');
const { createClient } = require('./support/client');

const app = createApp();
let category;
let alice;
let jpegs;
let big;

const fields = (overrides = {}) => {
  const base = { name: 'ร้านทดสอบรูป', categoryId: String(category.id), description: 'คำอธิบาย', address: 'ซอยฉลองกรุง 1', latitude: '13.7279', longitude: '100.7782' };
  for (let day = 0; day < 7; day += 1) base[`state${day}`] = 'closed';
  return { ...base, ...overrides };
};
const withFields = (req, values) => Object.entries(values).reduce((r, [key, value]) => r.field(key, value), req);
const attachAll = (req, buffers) => buffers.reduce((r, buffer, i) => r.attach('photos', buffer, { filename: `p${i}.jpg`, contentType: 'image/jpeg' }), req);
const exists = (p) => fs.existsSync(path.join(storage.UPLOAD_DIR, path.basename(p)));
const listUploads = () => (fs.existsSync(storage.UPLOAD_DIR) ? fs.readdirSync(storage.UPLOAD_DIR).sort() : []);

async function apiPost(buffers, overrides) {
  const token = await alice.csrfToken();
  return attachAll(withFields(alice.agent.post('/api/v1/submissions').set('X-CSRF-Token', token), fields(overrides)), buffers);
}
async function apiPatch(id, version, buffers) {
  const token = await alice.csrfToken();
  return attachAll(withFields(alice.agent.patch(`/api/v1/me/submissions/${id}`).set('X-CSRF-Token', token), fields({ version: String(version) })), buffers);
}
async function formPost(url, buffers, overrides) {
  const token = await alice.csrfToken();
  return attachAll(withFields(alice.agent.post(url), { _csrf: token, ...fields(overrides) }), buffers);
}
const returnToMember = (id) =>
  prisma.submission.update({ where: { id }, data: { status: 'changes_requested', reviewNote: 'แก้ไข', version: { increment: 1 } } });

beforeAll(async () => {
  jpegs = await Promise.all(
    ['#3a7d5c', '#c0392b', '#2980b9', '#8e44ad', '#f39c12', '#16a085'].map((background) =>
      sharp({ create: { width: 200, height: 150, channels: 3, background } }).jpeg().toBuffer()
    )
  );
  big = Buffer.alloc(6 * 1024 * 1024, 1);
});
beforeEach(async () => {
  await resetDatabase();
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  alice = createClient(app);
  await alice.register();
});
afterAll(async () => {
  fs.rmSync(storage.UPLOAD_DIR, { recursive: true, force: true });
  await closeDatabase();
});

describe('history keeps replaced photos', () => {
  test('a file only a snapshot mentions is not unused, and survives a photo replacement', async () => {
    const created = (await apiPost(jpegs.slice(0, 2))).body.data;
    const old = [created.imagePath, ...created.extraImagePaths];
    const returned = await returnToMember(created.id);
    const res = await apiPatch(created.id, returned.version, jpegs.slice(3, 5));
    expect(res.status).toBe(200);
    old.forEach((p) => expect(exists(p)).toBe(true));
    // No live row uses them any more, but the history does.
    const row = await prisma.submission.findUnique({ where: { id: created.id } });
    expect([row.imagePath, ...row.extraImagePaths]).not.toContain(old[0]);
    expect(await isUploadUnused(prisma, old[0])).toBe(false);
    expect(await isUploadUnused(prisma, old[1])).toBe(false);
    expect(await isUploadUnused(prisma, '/uploads/00000000-0000-0000-0000-000000000000.webp')).toBe(true);
    const page = await alice.get(`/me/submissions/${created.id}`);
    expect(page.status).toBe(200);
    old.forEach((p) => expect(page.text).toContain(p));
  });
});

describe('upload errors on the page forms', () => {
  test('create: a 6 MB photo re-renders the form with the typed name and stores nothing', async () => {
    const before = listUploads();
    const res = await formPost('/submissions', [big], { name: 'ชื่อที่พิมพ์ไว้' });
    expect([400, 413]).toContain(res.status);
    expect(res.status).toBe(413);
    expect(res.text).toContain('ชื่อที่พิมพ์ไว้');
    expect(res.text).toContain('รูปต้องมีขนาดไม่เกิน 5 MB');
    expect(res.text).toContain('name="photos"');
    expect(await prisma.submission.count()).toBe(0);
    expect(listUploads()).toEqual(before);
  });

  test('create: 6 photos re-render the form with the Thai message', async () => {
    const res = await formPost('/submissions', jpegs, { name: 'ชื่อที่พิมพ์ไว้' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('ชื่อที่พิมพ์ไว้');
    expect(res.text).toContain('แนบรูปได้ไม่เกิน 5 รูป');
    expect(await prisma.submission.count()).toBe(0);
  });

  test('edit: a 6 MB photo re-renders the edit form and changes nothing', async () => {
    const created = (await apiPost(jpegs.slice(0, 2))).body.data;
    const returned = await returnToMember(created.id);
    const before = listUploads();
    const res = await formPost(`/me/submissions/${created.id}`, [big], { name: 'ชื่อใหม่ที่พิมพ์', version: String(returned.version) });
    expect(res.status).toBe(413);
    expect(res.text).toContain('ชื่อใหม่ที่พิมพ์');
    expect(res.text).toContain('รูปต้องมีขนาดไม่เกิน 5 MB');
    expect(listUploads()).toEqual(before);
    const row = await prisma.submission.findUnique({ where: { id: created.id } });
    expect(row.name).toBe('ร้านทดสอบรูป');
    expect(row.version).toBe(returned.version);
  });

  test('the API still answers JSON errors', async () => {
    const tooBig = await apiPost([big]);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.error.code).toBe('FILE_TOO_LARGE');
    const tooMany = await apiPost(jpegs);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('huge version numbers', () => {
  test('PATCH and resubmit answer 400, not 500', async () => {
    const created = (await apiPost(jpegs.slice(0, 1))).body.data;
    await returnToMember(created.id);
    const patch = await apiPatch(created.id, 3000000000, []);
    expect(patch.status).toBe(400);
    const token = await alice.csrfToken();
    const resubmit = await alice.agent.post(`/api/v1/me/submissions/${created.id}/resubmit`).set('X-CSRF-Token', token).send({ version: 3000000000 });
    expect(resubmit.status).toBe(400);
  });
});
