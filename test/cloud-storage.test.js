// The Cloudinary photo store (src/storage/cloud.js). No request leaves the
// machine: fetch is replaced, and the tests check what would have been sent.
const crypto = require('node:crypto');

jest.mock('../src/config/env', () => ({ CLOUDINARY_URL: 'cloudinary://key123:secret456@demo-cloud' }));

const cloud = require('../src/storage/cloud');
const { isUpload, CLOUD_URL } = require('../src/storage/paths');

const UUID = '00000000-0000-4000-8000-000000000000';
const STORED = `https://res.cloudinary.com/demo-cloud/image/upload/v1731600000/painaidee/${UUID}.webp`;

const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const sentForm = () => Object.fromEntries(global.fetch.mock.calls[0][1].body.entries());
const signatureOf = (params) =>
  crypto
    .createHash('sha1')
    .update(Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&') + 'secret456')
    .digest('hex');

const realFetch = global.fetch;
beforeEach(() => {
  global.fetch = jest.fn();
});
afterAll(() => {
  global.fetch = realFetch;
});

describe('saving a photo', () => {
  test('uploads the WebP to the account folder, signed, and returns the address', async () => {
    global.fetch.mockImplementation(async (url, options) => {
      const publicId = options.body.get('public_id');
      return answer(200, { secure_url: `https://res.cloudinary.com/demo-cloud/image/upload/v1731600000/${publicId}.webp` });
    });
    const address = await cloud.save(Buffer.from('webp-bytes'));

    expect(address).toMatch(CLOUD_URL);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/upload');
    expect(options.method).toBe('POST');
    const form = sentForm();
    expect(form.public_id).toMatch(/^painaidee\/[0-9a-f-]{36}$/);
    expect(form.api_key).toBe('key123');
    expect(form.signature).toBe(signatureOf({ public_id: form.public_id, timestamp: form.timestamp }));
    expect(form.file.type).toBe('image/webp');
    expect(Buffer.from(await form.file.arrayBuffer()).toString()).toBe('webp-bytes');
    // The secret signs the request; it is never sent.
    expect(JSON.stringify(form)).not.toContain('secret456');
  });

  test('a refusal from Cloudinary becomes a retryable error without leaking its message', async () => {
    global.fetch.mockResolvedValue(answer(401, { error: { message: 'Invalid api_key key123' } }));
    await expect(cloud.save(Buffer.from('x'))).rejects.toMatchObject({ status: 502, code: 'STORAGE_FAILED' });
    const error = await cloud.save(Buffer.from('x')).catch((err) => err);
    expect(error.message).not.toContain('key123');
    expect(error.cause.message).toContain('401');
  });

  test('a dropped connection becomes the same error', async () => {
    global.fetch.mockRejectedValue(new TypeError('fetch failed'));
    await expect(cloud.save(Buffer.from('x'))).rejects.toMatchObject({ status: 502, code: 'STORAGE_FAILED' });
  });

  test('an address the app would not recognise later is refused, not stored', async () => {
    global.fetch.mockResolvedValue(answer(200, { secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1/elsewhere/cat.jpg' }));
    await expect(cloud.save(Buffer.from('x'))).rejects.toMatchObject({ code: 'STORAGE_FAILED' });
  });
});

describe('deleting a photo', () => {
  test('asks Cloudinary to destroy exactly that photo and clear its cached copy', async () => {
    global.fetch.mockResolvedValue(answer(200, { result: 'ok' }));
    await cloud.remove(STORED);
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.cloudinary.com/v1_1/demo-cloud/image/destroy');
    const form = sentForm();
    expect(form.public_id).toBe(`painaidee/${UUID}`);
    expect(form.invalidate).toBe('true');
    expect(form.signature).toBe(signatureOf({ invalidate: 'true', public_id: form.public_id, timestamp: form.timestamp }));
  });

  test('a photo that is already gone is not an error', async () => {
    global.fetch.mockResolvedValue(answer(200, { result: 'not found' }));
    await expect(cloud.remove(STORED)).resolves.toBeUndefined();
  });

  test('nothing to delete, or a photo from the local store, makes no request', async () => {
    await cloud.remove(null);
    await cloud.remove(`/uploads/${UUID}.webp`);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('refuses anything that is not a photo this app uploaded to this account', async () => {
    const others = [
      `https://res.cloudinary.com/other-cloud/image/upload/v1/painaidee/${UUID}.webp`, // another account
      'https://res.cloudinary.com/demo-cloud/image/upload/v1/someone/else.webp', // outside the app's folder
      `https://evil.example/demo-cloud/image/upload/painaidee/${UUID}.webp`,
      '/images/places/cafe.svg',
      42,
    ];
    for (const path of others) await expect(cloud.remove(path)).rejects.toThrow(/Refusing to delete/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('recognising an uploaded photo', () => {
  test('local and Cloudinary photos count; illustrations and other sites do not', () => {
    expect(isUpload(`/uploads/${UUID}.webp`)).toBe(true);
    expect(isUpload(STORED)).toBe(true);
    expect(isUpload(`https://res.cloudinary.com/demo-cloud/image/upload/painaidee/${UUID}.webp`)).toBe(true); // no version part
    expect(isUpload('/images/places/cafe.svg')).toBe(false);
    expect(isUpload(`https://res.cloudinary.com.evil.example/demo-cloud/image/upload/painaidee/${UUID}.webp`)).toBe(false);
    expect(isUpload(`http://res.cloudinary.com/demo-cloud/image/upload/painaidee/${UUID}.webp`)).toBe(false); // not https
    expect(isUpload(null)).toBe(false);
  });
});
