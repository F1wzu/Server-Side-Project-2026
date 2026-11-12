// Step 5: photo uploads. Only the upload pipeline is tested here, through a
// tiny app of its own, so this file never touches the database.
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const sharp = require('sharp');
const AppError = require('../src/utils/AppError');
const { photoUpload } = require('../src/middleware/upload');
const { storePhoto, detectImageType } = require('../src/utils/photo');
const storage = require('../src/storage');

const app = express();
app.post('/upload', photoUpload, async (req, res) => {
  res.json({ path: await storePhoto(req.file) });
});
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof AppError) return res.status(err.status).json({ code: err.code });
  return res.status(500).json({ code: 'INTERNAL_ERROR', message: err.message });
});

const UUID_PATH = /^\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;
const PACKAGE_JSON = path.join(__dirname, '..', 'package.json');

const upload = (buffer, filename = 'photo.jpg', contentType = 'image/jpeg', field = 'photo') =>
  request(app).post('/upload').attach(field, buffer, { filename, contentType });

const storedFile = (publicPath) => path.join(storage.UPLOAD_DIR, path.basename(publicPath));
// Read into memory first: sharp given a file name keeps the file open, and on
// Windows an open file cannot be deleted when the folder is cleaned up.
const storedMetadata = (publicPath) => sharp(fs.readFileSync(storedFile(publicPath))).metadata();
const listUploads = () => (fs.existsSync(storage.UPLOAD_DIR) ? fs.readdirSync(storage.UPLOAD_DIR).sort() : []);

const image = (width, height) => sharp({ create: { width, height, channels: 3, background: '#3a7d5c' } });

// The tag numbers of the entries in the first IFD of an EXIF block.
// 0x8825 is the pointer to the GPS data.
function exifTags(exif) {
  const tiff = exif.subarray(exif.indexOf('Exif\0\0') === 0 ? 6 : 0);
  const little = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (offset) => (little ? tiff.readUInt16LE(offset) : tiff.readUInt16BE(offset));
  const u32 = (offset) => (little ? tiff.readUInt32LE(offset) : tiff.readUInt32BE(offset));
  const ifd = u32(4);
  return Array.from({ length: u16(ifd) }, (unused, i) => u16(ifd + 2 + i * 12));
}

// A multipart body written by hand, for what supertest cannot send: a file
// input that the visitor left empty.
function rawMultipart(parts) {
  const boundary = '----painaideeTestBoundary';
  const chunks = parts.map(({ name, filename, value = '' }) => {
    const disposition = filename === undefined ? `form-data; name="${name}"` : `form-data; name="${name}"; filename="${filename}"`;
    const type = filename === undefined ? '' : 'Content-Type: application/octet-stream\r\n';
    return `--${boundary}\r\nContent-Disposition: ${disposition}\r\n${type}\r\n${value}\r\n`;
  });
  return { body: `${chunks.join('')}--${boundary}--\r\n`, type: `multipart/form-data; boundary=${boundary}` };
}

let gpsJpeg;
let pngPhoto;
let webpPhoto;

beforeAll(async () => {
  // A large camera photo turned sideways, with the camera name and a GPS position.
  gpsJpeg = await image(3000, 2000)
    .jpeg()
    .withExif({
      IFD0: { Make: 'PaiNaiDeeCam', Model: 'TestModel' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 43/1 37/1', GPSLongitudeRef: 'E', GPSLongitude: '100/1 46/1 42/1' },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  pngPhoto = await image(2400, 1200).png().toBuffer();
  webpPhoto = await image(400, 300).webp().toBuffer();
});

afterAll(() => {
  fs.rmSync(storage.UPLOAD_DIR, { recursive: true, force: true });
});

describe('storage', () => {
  test('tests write to the temp folder, never into the project', () => {
    expect(storage.driver).toBe('local');
    expect(storage.UPLOAD_DIR).not.toContain(path.resolve(__dirname, '..'));
  });
});

describe('accepted photos', () => {
  test('a large JPEG is turned, shrunk to 1600 px, converted to WebP and loses all EXIF including GPS', async () => {
    // The fixture really carries the data that must disappear.
    const input = await sharp(gpsJpeg).metadata();
    expect(input.orientation).toBe(6);
    expect(exifTags(input.exif)).toContain(0x8825);
    expect(input.exif.toString('latin1')).toContain('PaiNaiDeeCam');

    const res = await upload(gpsJpeg);
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(UUID_PATH);

    const stored = fs.readFileSync(storedFile(res.body.path));
    expect(detectImageType(stored)).toBe('webp');
    const output = await sharp(stored).metadata();
    expect(output.format).toBe('webp');
    // 3000×2000 on its side is 2000×3000, which fits 1600 px as about 1067×1600.
    expect(output.height).toBe(1600);
    expect(output.width).toBeLessThanOrEqual(1600);
    expect(output.width).toBeLessThan(output.height);
    expect(output.exif).toBeUndefined();
    expect(output.xmp).toBeUndefined();
    expect(output.icc).toBeUndefined();
    expect(stored.includes('EXIF')).toBe(false);
    expect(stored.includes('PaiNaiDeeCam')).toBe(false);
  });

  test('two uploads get different names', async () => {
    const [first, second] = [await upload(gpsJpeg), await upload(gpsJpeg)];
    expect(first.body.path).toMatch(UUID_PATH);
    expect(second.body.path).toMatch(UUID_PATH);
    expect(first.body.path).not.toBe(second.body.path);
  });

  test('a PNG is accepted and shrunk', async () => {
    const res = await upload(pngPhoto, 'map.png', 'image/png');
    expect(res.status).toBe(200);
    const output = await storedMetadata(res.body.path);
    expect(output).toMatchObject({ format: 'webp', width: 1600, height: 800 });
  });

  test('a small WebP is accepted and not enlarged', async () => {
    const res = await upload(webpPhoto, 'small.webp', 'image/webp');
    expect(res.status).toBe(200);
    const output = await storedMetadata(res.body.path);
    expect(output).toMatchObject({ format: 'webp', width: 400, height: 300 });
  });

  test('the file name and the browser\'s type do not matter, only the bytes', async () => {
    const res = await upload(pngPhoto, 'not-really.txt', 'text/plain');
    expect(res.status).toBe(200);
    expect(res.body.path).toMatch(UUID_PATH);
  });
});

describe('refused files', () => {
  test('a file over 5 MB is 413 FILE_TOO_LARGE', async () => {
    const big = Buffer.alloc(6 * 1024 * 1024, 0x41);
    big.set([0xff, 0xd8, 0xff, 0xe0]);
    const before = listUploads();
    const res = await upload(big);
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('FILE_TOO_LARGE');
    expect(listUploads()).toEqual(before);
  });

  test('a program named photo.jpg is 415 and nothing is written', async () => {
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2048, 0x90)]);
    const before = listUploads();
    const res = await upload(exe, 'photo.jpg', 'image/jpeg');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_FILE');
    expect(listUploads()).toEqual(before);
  });

  test('a text file is 415', async () => {
    const res = await upload(Buffer.from('สวัสดี นี่ไม่ใช่รูปภาพ'), 'note.txt', 'text/plain');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_FILE');
  });

  test('a cut-off JPEG with a valid header is 415', async () => {
    const before = listUploads();
    const res = await upload(gpsJpeg.subarray(0, 4000));
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_FILE');
    expect(listUploads()).toEqual(before);
  });

  test('a JPEG header followed by garbage is 415', async () => {
    const garbage = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(5000, 0x13)]);
    const res = await upload(garbage);
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_FILE');
  });

  test('a small file that decodes to a huge image (over 40 megapixels) is 415', async () => {
    const bomb = await image(8000, 6000).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    const res = await upload(bomb, 'bomb.png', 'image/png');
    expect(res.status).toBe(415);
    expect(res.body.code).toBe('UNSUPPORTED_FILE');
  });

  test('two files are 400', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('photo', webpPhoto, { filename: 'a.webp', contentType: 'image/webp' })
      .attach('photo', webpPhoto, { filename: 'b.webp', contentType: 'image/webp' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('a file under another field name is 400', async () => {
    const res = await upload(webpPhoto, 'a.webp', 'image/webp', 'avatar');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('too many fields are 400', async () => {
    let req = request(app).post('/upload');
    for (let i = 0; i < 41; i += 1) req = req.field(`f${i}`, 'x');
    const res = await req;
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

describe('no photo', () => {
  test('a multipart form without a file gives path null', async () => {
    const res = await request(app).post('/upload').field('name', 'ร้านกาแฟ');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ path: null });
  });

  test('a file input left empty gives path null', async () => {
    const { body, type } = rawMultipart([{ name: 'name', value: 'ร้านกาแฟ' }, { name: 'photo', filename: '' }]);
    const res = await request(app).post('/upload').set('Content-Type', type).send(body);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ path: null });
  });

  test('a request that is not multipart passes through', async () => {
    const res = await request(app).post('/upload').type('form').send({ name: 'x' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ path: null });
  });
});

describe('remove()', () => {
  test('deletes a stored photo', async () => {
    const res = await upload(webpPhoto, 'small.webp', 'image/webp');
    const file = storedFile(res.body.path);
    expect(fs.existsSync(file)).toBe(true);
    await storage.remove(res.body.path);
    expect(fs.existsSync(file)).toBe(false);
  });

  test('ignores a photo that is already gone, and null', async () => {
    await expect(storage.remove('/uploads/00000000-0000-4000-8000-000000000000.webp')).resolves.toBeUndefined();
    await expect(storage.remove(null)).resolves.toBeUndefined();
    await expect(storage.remove(undefined)).resolves.toBeUndefined();
  });

  test.each([
    '/uploads/../package.json',
    '/uploads/../../package.json',
    '../package.json',
    'package.json',
    '/uploads/photo.webp',
    '/uploads/00000000-0000-4000-8000-000000000000.png',
    '/uploads/00000000-0000-4000-8000-000000000000.webp/../../package.json',
    '/uploads\\..\\package.json',
    `/uploads/${'..%2F'.repeat(3)}package.json`,
    ' /uploads/00000000-0000-4000-8000-000000000000.webp',
    '/uploads/00000000-0000-4000-8000-000000000000.webp\n',
    '',
  ])('refuses the odd path %j', async (odd) => {
    await expect(storage.remove(odd)).rejects.toThrow();
    expect(fs.existsSync(PACKAGE_JSON)).toBe(true);
  });

  test('refuses values that are not text', async () => {
    for (const odd of [42, {}, ['/uploads/x.webp']]) await expect(storage.remove(odd)).rejects.toThrow();
    expect(fs.existsSync(PACKAGE_JSON)).toBe(true);
  });
});
