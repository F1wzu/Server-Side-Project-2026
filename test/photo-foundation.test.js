// The shared pieces behind places with several photos: storing a batch of
// photos all-or-nothing, and knowing whether a stored file is still used.
const fs = require('node:fs');
const sharp = require('sharp');
const storage = require('../src/storage');
const { storePhotos } = require('../src/utils/photo');
const { isUploadUnused, unusedUploads } = require('../src/models/photoUsage');
const { prisma, resetDatabase, closeDatabase } = require('./support/db');

const listUploads = () => (fs.existsSync(storage.UPLOAD_DIR) ? fs.readdirSync(storage.UPLOAD_DIR).sort() : []);
let jpeg;

beforeAll(async () => {
  jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#3a7d5c' } }).jpeg().toBuffer();
});

beforeEach(resetDatabase);

afterAll(async () => {
  fs.rmSync(storage.UPLOAD_DIR, { recursive: true, force: true });
  await closeDatabase();
});

describe('storePhotos', () => {
  test('stores every photo as a new WebP file, in order', async () => {
    const before = listUploads();
    const paths = await storePhotos([{ buffer: jpeg }, { buffer: jpeg }, { buffer: jpeg }]);
    expect(paths).toHaveLength(3);
    for (const path of paths) expect(path).toMatch(/^\/uploads\/[0-9a-f-]{36}\.webp$/);
    expect(new Set(paths).size).toBe(3);
    expect(listUploads()).toHaveLength(before.length + 3);
  });

  test('no files means no paths', async () => {
    expect(await storePhotos([])).toEqual([]);
    expect(await storePhotos()).toEqual([]);
  });

  test('one bad photo stores nothing and says which one it was', async () => {
    const before = listUploads();
    await expect(storePhotos([{ buffer: jpeg }, { buffer: Buffer.from('not an image') }, { buffer: jpeg }])).rejects.toMatchObject({
      status: 415,
      message: expect.stringMatching(/^รูปที่ 2: /),
    });
    expect(listUploads()).toEqual(before);
  });
});

describe('photoUsage', () => {
  let place;
  let user;

  beforeEach(async () => {
    const category = await prisma.category.create({ data: { name: 'คาเฟ่' } });
    user = await prisma.user.create({ data: { username: 'alice', email: 'alice@example.com', passwordHash: 'x' } });
    place = await prisma.place.create({ data: { categoryId: category.id, name: 'ร้าน', description: 'ร้าน', address: 'ลาดกระบัง' } });
  });

  const submission = (data) =>
    prisma.submission.create({
      data: { userId: user.id, categoryId: place.categoryId, name: 'ร้าน', description: 'ร้าน', address: 'ลาดกระบัง', hours: Array.from({ length: 7 }, (unused, weekday) => ({ weekday, state: 'unknown' })), ...data },
    });

  test('a file nothing points at is unused; seed illustrations never count as unused', async () => {
    await expect(isUploadUnused(prisma, '/uploads/a.webp')).resolves.toBe(true);
    await expect(isUploadUnused(prisma, '/images/places/cafe.svg')).resolves.toBe(false);
    await expect(isUploadUnused(prisma, null)).resolves.toBe(false);
  });

  test('a cover, a gallery photo, a submission photo or a submission extra photo all count as used', async () => {
    await prisma.place.update({ where: { id: place.id }, data: { imagePath: '/uploads/cover.webp' } });
    await prisma.placePhoto.create({ data: { placeId: place.id, imagePath: '/uploads/gallery.webp', position: 0 } });
    await submission({ imagePath: '/uploads/sub.webp', extraImagePaths: ['/uploads/extra.webp'] });

    for (const path of ['/uploads/cover.webp', '/uploads/gallery.webp', '/uploads/sub.webp', '/uploads/extra.webp']) {
      await expect(isUploadUnused(prisma, path)).resolves.toBe(false);
    }
    await expect(unusedUploads(prisma, ['/uploads/cover.webp', '/uploads/free.webp', '/uploads/free.webp', '/images/x.svg'])).resolves.toEqual([
      '/uploads/free.webp',
    ]);
  });

  test('the database refuses more than 4 extra submission photos, or extras without a cover', async () => {
    const five = Array.from({ length: 5 }, (unused, i) => `/uploads/${i}.webp`);
    await expect(submission({ imagePath: '/uploads/c.webp', extraImagePaths: five })).rejects.toThrow(/submissions_extra_image_paths_check/);
    await expect(submission({ imagePath: null, extraImagePaths: ['/uploads/a.webp'] })).rejects.toThrow(/submissions_extra_image_paths_check/);
    await expect(submission({ imagePath: '/uploads/c.webp', extraImagePaths: five.slice(0, 4) })).resolves.toBeTruthy();
  });

  test('gallery positions are unique per place and never negative', async () => {
    await prisma.placePhoto.create({ data: { placeId: place.id, imagePath: '/uploads/a.webp', position: 0 } });
    await expect(prisma.placePhoto.create({ data: { placeId: place.id, imagePath: '/uploads/b.webp', position: 0 } })).rejects.toThrow();
    await expect(prisma.placePhoto.create({ data: { placeId: place.id, imagePath: '/uploads/b.webp', position: -1 } })).rejects.toThrow(/place_photos_position_check/);
  });
});
