// Admin gallery management: a place's cover (places.image_path) plus up to 9
// more photos (place_photos), kept in order with positions 0..n-1.
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
let photoBuffer;

// ---------- helpers ----------

const jpeg = (name = 'photo.jpg') => ({ buffer: photoBuffer, filename: name, contentType: 'image/jpeg' });
const notAnImage = () => ({ buffer: Buffer.from('this is not an image'), filename: 'x.jpg', contentType: 'image/jpeg' });

function attachAll(req, files) {
  return files.reduce((r, file) => r.attach('photos', file.buffer, { filename: file.filename, contentType: file.contentType }), req);
}

async function apiAdd(client, placeId, files) {
  const token = await client.csrfToken();
  return attachAll(client.agent.post(`/api/v1/admin/places/${placeId}/photos`).set('X-CSRF-Token', token), files);
}

// The _csrf field goes first: it must be parsed before a file can fail.
async function formAdd(client, placeId, files, withToken = true) {
  const token = await client.csrfToken();
  let req = client.agent.post(`/admin/places/${placeId}/photos`);
  if (withToken) req = req.field('_csrf', token);
  else req = req.field('x', 'y');
  return attachAll(req, files);
}

async function apiDelete(client, url) {
  const token = await client.csrfToken();
  return client.agent.delete(url).set('X-CSRF-Token', token);
}

const uploadPath = (publicPath) => path.join(storage.UPLOAD_DIR, path.basename(publicPath));
const uploadExists = (publicPath) => fs.existsSync(uploadPath(publicPath));
const listUploads = () => (fs.existsSync(storage.UPLOAD_DIR) ? fs.readdirSync(storage.UPLOAD_DIR).sort() : []);

const makePlace = (overrides = {}) =>
  prisma.place.create({ data: { categoryId: category.id, name: 'ร้านมีรูป', description: 'รายละเอียด', address: 'ลาดกระบัง', ...overrides } });

const dbPhotos = (placeId) => prisma.placePhoto.findMany({ where: { placeId }, orderBy: { position: 'asc' } });
const dbCover = async (placeId) => (await prisma.place.findUnique({ where: { id: placeId } })).imagePath;

// A place with a cover and `n` more photos, added through the API.
async function placeWithPhotos(n) {
  const place = await makePlace();
  // One request takes at most 9 files, so a full gallery needs two.
  let res;
  for (let left = n + 1; left > 0; left -= 9) {
    res = await apiAdd(admin, place.id, Array.from({ length: Math.min(left, 9) }, () => jpeg()));
    expect(res.status).toBe(201);
  }
  return { place, gallery: res.body.data };
}

beforeAll(async () => {
  photoBuffer = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3a7d5c' } }).jpeg().toBuffer();
});

beforeEach(async () => {
  await resetDatabase();
  fs.rmSync(storage.UPLOAD_DIR, { recursive: true, force: true }); // each test counts files from zero
  category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
  admin = createClient(app);
  await admin.registerAdmin();
  alice = createClient(app);
  await alice.register({ username: 'alice', email: 'alice@example.com' });
});

afterAll(async () => {
  fs.rmSync(storage.UPLOAD_DIR, { recursive: true, force: true });
  await closeDatabase();
});

// ---------- access ----------

describe('access', () => {
  test('a visitor is sent to login or gets 401', async () => {
    const visitor = createClient(app);
    const place = await makePlace();
    const page = await visitor.get(`/admin/places/${place.id}/photos`);
    expect(page.status).toBe(302);
    expect(page.headers.location).toMatch(/^\/login/);
    expect((await apiAdd(visitor, place.id, [jpeg()])).status).toBe(401);
    expect((await apiDelete(visitor, `/api/v1/admin/places/${place.id}/cover`)).status).toBe(401);
  });

  test('a member gets 403 and nothing is stored', async () => {
    const place = await makePlace();
    const before = listUploads();
    expect((await alice.get(`/admin/places/${place.id}/photos`)).status).toBe(403);
    expect((await apiAdd(alice, place.id, [jpeg()])).status).toBe(403);
    expect((await formAdd(alice, place.id, [jpeg()])).status).toBe(403);
    expect((await alice.postForm(`/admin/places/${place.id}/cover/delete`)).status).toBe(403);
    expect(listUploads()).toEqual(before);
    expect(await dbCover(place.id)).toBeNull();
  });
});

// ---------- adding ----------

describe('adding photos', () => {
  test('the first of several photos becomes the cover when there is none, the rest follow in order', async () => {
    const place = await makePlace();
    const res = await apiAdd(admin, place.id, [jpeg('a.jpg'), jpeg('b.jpg'), jpeg('c.jpg')]);
    expect(res.status).toBe(201);
    expect(res.body.data.cover).toMatch(/^\/uploads\//);
    expect(res.body.data.photos.map((p) => p.position)).toEqual([0, 1]);
    expect(await dbCover(place.id)).toBe(res.body.data.cover);
    expect((await dbPhotos(place.id)).map((p) => p.imagePath)).toEqual(res.body.data.photos.map((p) => p.imagePath));
    expect(listUploads()).toHaveLength(3);

    // More photos are appended after the existing ones; the cover stays.
    const more = await apiAdd(admin, place.id, [jpeg(), jpeg()]);
    expect(more.body.data.cover).toBe(res.body.data.cover);
    expect(more.body.data.photos.map((p) => p.position)).toEqual([0, 1, 2, 3]);
    expect(more.body.data.photos.slice(0, 2)).toEqual(res.body.data.photos);
  });

  test('the single-file field "photo" works too', async () => {
    const place = await makePlace();
    const token = await admin.csrfToken();
    const res = await admin.agent
      .post(`/api/v1/admin/places/${place.id}/photos`)
      .set('X-CSRF-Token', token)
      .attach('photo', photoBuffer, { filename: 'one.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(201);
    expect(res.body.data.cover).toMatch(/^\/uploads\//);
    expect(res.body.data.photos).toEqual([]);
  });

  test('no file is a validation error', async () => {
    const place = await makePlace();
    const token = await admin.csrfToken();
    const res = await admin.agent.post(`/api/v1/admin/places/${place.id}/photos`).set('X-CSRF-Token', token).field('x', 'y');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('a place holds at most 10 photos; a refused batch leaves no files behind', async () => {
    const { place } = await placeWithPhotos(7); // cover + 7 = 8
    const before = listUploads();
    expect(before).toHaveLength(8);

    const refused = await apiAdd(admin, place.id, [jpeg(), jpeg(), jpeg()]);
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('VALIDATION_ERROR');
    expect(refused.body.error.details[0]).toEqual({ field: 'photos', message: 'สถานที่หนึ่งแห่งมีรูปได้ไม่เกิน 10 รูป' });
    expect(listUploads()).toEqual(before);
    expect(await dbPhotos(place.id)).toHaveLength(7);

    const ok = await apiAdd(admin, place.id, [jpeg(), jpeg()]);
    expect(ok.status).toBe(201);
    expect(ok.body.data.photos).toHaveLength(9);
    const full = await apiAdd(admin, place.id, [jpeg()]);
    expect(full.status).toBe(400);
    expect(listUploads()).toHaveLength(10);
  });

  test('more than 9 files in one request is refused before anything is stored', async () => {
    const place = await makePlace();
    const before = listUploads();
    const res = await apiAdd(admin, place.id, Array.from({ length: 10 }, () => jpeg()));
    expect(res.status).toBe(400);
    expect(listUploads()).toEqual(before);
  });

  test('a bad file in the batch stores nothing', async () => {
    const place = await makePlace();
    const before = listUploads();
    const res = await apiAdd(admin, place.id, [jpeg(), notAnImage(), jpeg()]);
    expect(res.status).toBe(415);
    expect(res.body.error.message).toContain('รูปที่ 2');
    expect(listUploads()).toEqual(before);
    expect(await dbCover(place.id)).toBeNull();
    expect(await dbPhotos(place.id)).toHaveLength(0);
  });

  test('an unknown place is 404 and nothing is stored', async () => {
    const before = listUploads();
    expect((await apiAdd(admin, 999999, [jpeg()])).status).toBe(404);
    expect((await apiAdd(admin, 'abc', [jpeg()])).status).toBe(404);
    expect(listUploads()).toEqual(before);
  });
});

// ---------- changing ----------

describe('cover, order and removal', () => {
  test('makeCover swaps the cover with the chosen photo', async () => {
    const { place, gallery } = await placeWithPhotos(2);
    const [first, second] = gallery.photos;
    const res = await admin.post(`/api/v1/admin/places/${place.id}/photos/${second.id}/cover`);
    expect(res.status).toBe(200);
    expect(res.body.data.cover).toBe(second.imagePath);
    expect(res.body.data.photos.map((p) => [p.id, p.imagePath, p.position])).toEqual([
      [first.id, first.imagePath, 0],
      [second.id, gallery.cover, 1],
    ]);
    expect(listUploads()).toHaveLength(3); // nothing deleted
  });

  test('makeCover without a cover moves the photo up and compacts the rest', async () => {
    const { place, gallery } = await placeWithPhotos(2);
    await prisma.place.update({ where: { id: place.id }, data: { imagePath: null } });
    const [first, second] = gallery.photos;
    const res = await admin.post(`/api/v1/admin/places/${place.id}/photos/${first.id}/cover`);
    expect(res.status).toBe(200);
    expect(res.body.data.cover).toBe(first.imagePath);
    expect(res.body.data.photos.map((p) => [p.id, p.position])).toEqual([[second.id, 0]]);
  });

  test('a photo of another place is 404, an unknown or bad id too', async () => {
    const { gallery } = await placeWithPhotos(1);
    const other = await makePlace({ name: 'ร้านอื่น' });
    const foreign = gallery.photos[0];
    for (const [method, url] of [
      ['post', `/api/v1/admin/places/${other.id}/photos/${foreign.id}/cover`],
      ['post', `/api/v1/admin/places/${other.id}/photos/${foreign.id}/move`],
      ['delete', `/api/v1/admin/places/${other.id}/photos/${foreign.id}`],
      ['post', `/api/v1/admin/places/${other.id}/photos/999999/cover`],
      ['post', `/api/v1/admin/places/${other.id}/photos/01/cover`],
    ]) {
      const res = method === 'post' ? await admin.post(url, { direction: 'up' }) : await apiDelete(admin, url);
      expect(res.status).toBe(404);
    }
    expect((await admin.post('/api/v1/admin/places/999999/photos/1/cover')).status).toBe(404);
    expect(await prisma.placePhoto.count()).toBe(1);
  });

  test('move swaps with the neighbour; at the ends nothing changes', async () => {
    const { place, gallery } = await placeWithPhotos(3);
    const [a, b, c] = gallery.photos;
    const ids = (res) => res.body.data.photos.map((p) => p.id);
    const url = (photo) => `/api/v1/admin/places/${place.id}/photos/${photo.id}/move`;

    let res = await admin.post(url(c), { direction: 'up' });
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([a.id, c.id, b.id]);
    expect(res.body.data.photos.map((p) => p.position)).toEqual([0, 1, 2]);

    res = await admin.post(url(a), { direction: 'down' });
    expect(ids(res)).toEqual([c.id, a.id, b.id]);

    res = await admin.post(url(c), { direction: 'up' }); // already first
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([c.id, a.id, b.id]);
    res = await admin.post(url(b), { direction: 'down' }); // already last
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([c.id, a.id, b.id]);
    expect((await dbPhotos(place.id)).map((p) => p.position)).toEqual([0, 1, 2]);
  });

  test('a bad direction is 400', async () => {
    const { place, gallery } = await placeWithPhotos(1);
    const url = `/api/v1/admin/places/${place.id}/photos/${gallery.photos[0].id}/move`;
    for (const body of [{ direction: 'left' }, {}, { direction: 5 }]) {
      const res = await admin.post(url, body);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('remove deletes the row and the file, and compacts positions', async () => {
    const { place, gallery } = await placeWithPhotos(3);
    const [a, b, c] = gallery.photos;
    const res = await apiDelete(admin, `/api/v1/admin/places/${place.id}/photos/${a.id}`);
    expect(res.status).toBe(204);
    expect(uploadExists(a.imagePath)).toBe(false);
    expect(uploadExists(b.imagePath)).toBe(true);
    expect((await dbPhotos(place.id)).map((p) => [p.id, p.position])).toEqual([[b.id, 0], [c.id, 1]]);
    expect((await apiDelete(admin, `/api/v1/admin/places/${place.id}/photos/${a.id}`)).status).toBe(404);
  });

  test('removeCover promotes the first photo and deletes the old cover file', async () => {
    const { place, gallery } = await placeWithPhotos(2);
    const [a, b] = gallery.photos;
    const res = await apiDelete(admin, `/api/v1/admin/places/${place.id}/cover`);
    expect(res.status).toBe(200);
    expect(res.body.data.cover).toBe(a.imagePath);
    expect(res.body.data.photos.map((p) => [p.id, p.position])).toEqual([[b.id, 0]]);
    expect(uploadExists(gallery.cover)).toBe(false);
    expect(uploadExists(a.imagePath)).toBe(true);
    expect(await prisma.placePhoto.count({ where: { id: a.id } })).toBe(0);

    // Down to the last photo, then to none.
    await apiDelete(admin, `/api/v1/admin/places/${place.id}/cover`);
    const last = await apiDelete(admin, `/api/v1/admin/places/${place.id}/cover`);
    expect(last.body.data).toEqual({ cover: null, photos: [] });
    expect(listUploads()).toHaveLength(0);
    // No cover and no photos: nothing more to do, still 200.
    expect((await apiDelete(admin, `/api/v1/admin/places/${place.id}/cover`)).status).toBe(200);
  });
});

// ---------- shared and seed files ----------

describe('files used elsewhere are kept', () => {
  test('a photo shared with a submission is not deleted', async () => {
    const { place, gallery } = await placeWithPhotos(2);
    const [a, b] = gallery.photos;
    await prisma.submission.create({
      data: {
        userId: admin.id, categoryId: category.id, name: 'x', description: 'x', address: 'y',
        imagePath: gallery.cover, extraImagePaths: [a.imagePath], hours: Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'closed' })), status: 'approved', placeId: place.id,
      },
    });
    await apiDelete(admin, `/api/v1/admin/places/${place.id}/photos/${a.id}`);
    expect(uploadExists(a.imagePath)).toBe(true);
    await apiDelete(admin, `/api/v1/admin/places/${place.id}/cover`); // promotes b
    expect(uploadExists(gallery.cover)).toBe(true);
    await apiDelete(admin, `/api/v1/admin/places/${place.id}/cover`);
    expect(uploadExists(b.imagePath)).toBe(false); // used by nobody
  });

  test('seed illustrations are never reported for deletion', async () => {
    const place = await makePlace({ imagePath: '/images/places/cafe.svg' });
    const before = listUploads();
    const res = await apiDelete(admin, `/api/v1/admin/places/${place.id}/cover`);
    expect(res.status).toBe(200);
    expect(res.body.data.cover).toBeNull();
    expect(listUploads()).toEqual(before);

    // As a gallery photo too.
    const other = await makePlace({ name: 'อีกร้าน', imagePath: '/images/places/cafe.svg' });
    const row = await prisma.placePhoto.create({ data: { placeId: other.id, imagePath: '/images/places/market.svg', position: 0 } });
    expect((await apiDelete(admin, `/api/v1/admin/places/${other.id}/photos/${row.id}`)).status).toBe(204);
  });
});

// ---------- pages and display ----------

describe('the admin page', () => {
  test('shows the cover, the other photos and the forms, without inline style or handlers', async () => {
    const { place, gallery } = await placeWithPhotos(3);
    const res = await admin.get(`/admin/places/${place.id}/photos`);
    expect(res.status).toBe(200);
    const html = res.text;
    expect(html).toContain('รูปหลัก');
    expect(html).toContain('ลบรูปหลัก');
    expect(html).toContain('4 / 10 รูป');
    expect(html).toContain(`action="/admin/places/${place.id}/cover/delete"`);
    expect(html).toContain('name="photos"');
    expect(html).toContain('multiple');
    expect(html).toContain('accept="image/jpeg,image/png,image/webp"');
    expect(html).toContain('enctype="multipart/form-data"');
    for (const photo of gallery.photos) {
      expect(html).toContain(`action="/admin/places/${place.id}/photos/${photo.id}/cover"`);
      expect(html).toContain(`action="/admin/places/${place.id}/photos/${photo.id}/delete"`);
    }
    expect(html).toContain('alt="รูปที่ 2 ของ ร้านมีรูป"');
    // First photo has no "up", last has no "down".
    expect(html.match(/value="up"/g)).toHaveLength(2);
    expect(html.match(/value="down"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-current="page">รูปภาพ/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
  });

  test('the upload form is hidden at 10 photos; an empty place shows a hint', async () => {
    const { place } = await placeWithPhotos(9);
    const full = await admin.get(`/admin/places/${place.id}/photos`);
    expect(full.text).toContain('10 / 10 รูป');
    expect(full.text).not.toContain('name="photos"');

    const empty = await makePlace({ name: 'ว่าง' });
    const page = await admin.get(`/admin/places/${empty.id}/photos`);
    expect(page.text).toContain('0 / 10 รูป');
    expect(page.text).toContain('ยังไม่มีรูปหลัก');
    expect(page.text).not.toContain('ลบรูปหลัก');
  });

  test('an unknown place or a bad id is a 404 page', async () => {
    expect((await admin.get('/admin/places/999999/photos')).status).toBe(404);
    expect((await admin.get('/admin/places/01/photos')).status).toBe(404);
  });
});

describe('form routes', () => {
  test('add, move, cover and delete redirect back with a flash', async () => {
    const place = await makePlace();
    const back = `/admin/places/${place.id}/photos`;

    let res = await formAdd(admin, place.id, [jpeg(), jpeg(), jpeg()]);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(back);
    expect((await admin.get(back)).text).toContain('เพิ่มรูปแล้ว');
    const [a, b] = await dbPhotos(place.id);

    res = await admin.postForm(`${back}/${b.id}/move`, { direction: 'up' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(back);
    expect((await dbPhotos(place.id)).map((p) => p.id)).toEqual([b.id, a.id]);
    expect((await admin.get(back)).text).toContain('ย้ายตำแหน่งรูปแล้ว');

    res = await admin.postForm(`${back}/${a.id}/cover`);
    expect(res.status).toBe(303);
    expect((await admin.get(back)).text).toContain('ตั้งเป็นรูปหลักแล้ว');
    expect(await dbCover(place.id)).toBe(a.imagePath);

    res = await admin.postForm(`${back}/${b.id}/delete`);
    expect(res.status).toBe(303);
    expect((await admin.get(back)).text).toContain('ลบรูปแล้ว');

    res = await admin.postForm(`/admin/places/${place.id}/cover/delete`);
    expect(res.status).toBe(303);
    expect((await admin.get(back)).text).toContain('ลบรูปหลักแล้ว');
    expect(await dbCover(place.id)).not.toBe(a.imagePath);
  });

  test('fixable errors become an error flash and a redirect', async () => {
    const { place, gallery } = await placeWithPhotos(1);
    const back = `/admin/places/${place.id}/photos`;
    const before = listUploads();

    let res = await formAdd(admin, place.id, [jpeg(), notAnImage()]);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(back);
    let page = await admin.get(back);
    expect(page.text).toContain('notice-error');
    expect(page.text).toContain('รูปที่ 2');

    res = await formAdd(admin, place.id, []);
    expect(res.status).toBe(303);
    expect((await admin.get(back)).text).toContain('กรุณาเลือกรูปอย่างน้อย 1 รูป');

    res = await formAdd(admin, place.id, Array.from({ length: 10 }, () => jpeg()));
    expect(res.status).toBe(303);
    expect((await admin.get(back)).text).toContain('notice-error');

    res = await admin.postForm(`${back}/${gallery.photos[0].id}/move`, { direction: 'sideways' });
    expect(res.status).toBe(303);
    expect((await admin.get(back)).text).toContain('notice-error');

    res = await admin.postForm(`${back}/999999/delete`);
    expect(res.status).toBe(303);
    page = await admin.get(back);
    expect(page.text).toContain('ไม่พบรูปนี้');
    expect(listUploads()).toEqual(before);
  });

  test('the cap is also a flash on the page', async () => {
    const { place } = await placeWithPhotos(9);
    const res = await formAdd(admin, place.id, [jpeg()]);
    expect(res.status).toBe(303);
    expect((await admin.get(`/admin/places/${place.id}/photos`)).text).toContain('สถานที่หนึ่งแห่งมีรูปได้ไม่เกิน 10 รูป');
  });

  test('an unknown place is a real 404', async () => {
    expect((await admin.postForm('/admin/places/999999/photos/1/delete')).status).toBe(404);
    expect((await admin.postForm('/admin/places/999999/cover/delete')).status).toBe(404);
    expect((await formAdd(admin, 999999, [jpeg()])).status).toBe(404);
  });

  test('every form needs the CSRF token', async () => {
    const { place, gallery } = await placeWithPhotos(2);
    const before = listUploads();
    const photoId = gallery.photos[0].id;
    expect((await formAdd(admin, place.id, [jpeg()], false)).status).toBe(403);
    for (const url of [`/admin/places/${place.id}/photos/${photoId}/cover`, `/admin/places/${place.id}/photos/${photoId}/delete`, `/admin/places/${place.id}/cover/delete`]) {
      expect((await admin.agent.post(url).type('form').send({})).status).toBe(403);
    }
    expect((await admin.agent.post(`/api/v1/admin/places/${place.id}/photos/${photoId}/cover`)).status).toBe(403);
    expect(listUploads()).toEqual(before);
    expect(await dbPhotos(place.id)).toHaveLength(2);
  });
});

describe('where the gallery shows', () => {
  test('the public page and API show the cover first, then the photos in order', async () => {
    const { place, gallery } = await placeWithPhotos(3);
    await admin.post(`/api/v1/admin/places/${place.id}/photos/${gallery.photos[2].id}/move`, { direction: 'up' });
    const [a, b, c] = gallery.photos;
    const expected = [gallery.cover, a.imagePath, c.imagePath, b.imagePath];

    const api = await createClient(app).get(`/api/v1/places/${place.id}`);
    expect(api.status).toBe(200);
    expect(api.body.data.gallery).toEqual(expected);

    const page = await createClient(app).get(`/places/${place.id}`);
    expect(page.status).toBe(200);
    const shown = [...page.text.matchAll(/<img src="(\/uploads\/[^"]+)" alt="[^"]+"/g)].map((m) => m[1]);
    expect(shown.slice(0, 4)).toEqual(expected);
  });

  test('GET /api/v1/admin/places/:id includes the photos', async () => {
    const { place, gallery } = await placeWithPhotos(2);
    const res = await admin.get(`/api/v1/admin/places/${place.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.imagePath).toBe(gallery.cover);
    expect(res.body.data.photos).toEqual(gallery.photos);
  });

  test('"no cover" still drives hasPhoto and missing=photo', async () => {
    const withCover = await makePlace({ name: 'มีรูปหลัก', imagePath: '/images/a.webp' });
    const without = await makePlace({ name: 'ไม่มีรูปหลัก' });
    await prisma.placePhoto.create({ data: { placeId: without.id, imagePath: '/images/b.webp', position: 0 } });
    const list = await admin.get('/api/v1/admin/places?missing=photo');
    expect(list.body.data.map((p) => p.id)).toEqual([without.id]);
    const all = await admin.get('/api/v1/admin/places');
    expect(all.body.data.find((p) => p.id === withCover.id).hasPhoto).toBe(true);
  });
});
