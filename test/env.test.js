const { parseEnv } = require('../src/config/env');

const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/app',
  SESSION_SECRET: 'x'.repeat(32),
};

describe('configuration', () => {
  test('accepts a complete configuration and fills in the defaults', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.STORAGE_DRIVER).toBe('local');
    expect(env.isProduction).toBe(false);
  });

  test('treats an empty optional value as not set', () => {
    expect(parseEnv({ ...valid, PUBLIC_ORIGIN: '', TRUST_PROXY: '' }).PUBLIC_ORIGIN).toBeUndefined();
  });

  test('refuses to start without SESSION_SECRET', () => {
    const { SESSION_SECRET, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(/SESSION_SECRET is required/);
  });

  test('refuses a SESSION_SECRET shorter than 32 characters', () => {
    expect(() => parseEnv({ ...valid, SESSION_SECRET: 'x'.repeat(31) })).toThrow(/SESSION_SECRET must be at least 32 characters/);
  });

  test('refuses a missing or non-PostgreSQL DATABASE_URL', () => {
    const { DATABASE_URL, ...rest } = valid;
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL is required/);
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://localhost/app' })).toThrow(/DATABASE_URL must be a PostgreSQL/);
  });

  test('refuses a port that is not a number', () => {
    expect(() => parseEnv({ ...valid, PORT: 'abc' })).toThrow(/PORT/);
  });

  test('lists every problem at once', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL[\s\S]*SESSION_SECRET/);
  });

  test('production requires an https PUBLIC_ORIGIN', () => {
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/PUBLIC_ORIGIN/);
    expect(() => parseEnv({ ...valid, NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://example.com' })).toThrow(/PUBLIC_ORIGIN/);
    expect(parseEnv({ ...valid, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://example.com', TRUST_PROXY: '1' }).isProduction).toBe(true);
  });

  test('production requires TRUST_PROXY, or the secure login cookie is never set', () => {
    const prod = { ...valid, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://example.com' };
    expect(() => parseEnv(prod)).toThrow(/TRUST_PROXY is required in production/);
    expect(() => parseEnv({ ...prod, TRUST_PROXY: 'false' })).toThrow(/TRUST_PROXY is required in production/);
    expect(() => parseEnv({ ...prod, TRUST_PROXY: '1' })).not.toThrow();
    // Development needs no proxy.
    expect(() => parseEnv(valid)).not.toThrow();
  });

  test("on Render, PUBLIC_ORIGIN defaults to the service's own address", () => {
    const render = { ...valid, NODE_ENV: 'production', TRUST_PROXY: '1', RENDER_EXTERNAL_URL: 'https://painaidee.onrender.com' };
    expect(parseEnv(render).PUBLIC_ORIGIN).toBe('https://painaidee.onrender.com');
    // A PUBLIC_ORIGIN set by hand (a custom domain) wins.
    expect(parseEnv({ ...render, PUBLIC_ORIGIN: 'https://example.com' }).PUBLIC_ORIGIN).toBe('https://example.com');
  });

  test('tests use the separate test database, never the development one', () => {
    const testUrl = 'postgresql://user:password@127.0.0.1:5432/app_test';
    expect(parseEnv({ ...valid, NODE_ENV: 'test', TEST_DATABASE_URL: testUrl }).DATABASE_URL).toBe(testUrl);
    expect(() => parseEnv({ ...valid, NODE_ENV: 'test' })).toThrow(/TEST_DATABASE_URL is required/);
    expect(() => parseEnv({ ...valid, NODE_ENV: 'test', TEST_DATABASE_URL: valid.DATABASE_URL })).toThrow(/different database/);
  });
});

describe('cloud photo storage settings', () => {
  test('STORAGE_DRIVER=cloud needs the Cloudinary account', () => {
    expect(() => parseEnv({ ...valid, STORAGE_DRIVER: 'cloud' })).toThrow(/CLOUDINARY_URL is required when STORAGE_DRIVER=cloud/);
    expect(parseEnv({ ...valid, STORAGE_DRIVER: 'cloud', CLOUDINARY_URL: 'cloudinary://123:abc_DEF-9@my-cloud' }).STORAGE_DRIVER).toBe('cloud');
  });

  test('a malformed CLOUDINARY_URL is refused, an empty one means not set', () => {
    expect(() => parseEnv({ ...valid, CLOUDINARY_URL: 'https://cloudinary.com/console' })).toThrow(/CLOUDINARY_URL must look like/);
    expect(parseEnv({ ...valid, CLOUDINARY_URL: '' }).CLOUDINARY_URL).toBeUndefined();
  });
});

describe('the local photo store next to cloud photos', () => {
  test('is not asked to delete a photo kept on Cloudinary', async () => {
    const local = require('../src/storage/local');
    await expect(local.remove('https://res.cloudinary.com/demo/image/upload/v1/painaidee/00000000-0000-4000-8000-000000000000.webp')).resolves.toBeUndefined();
    await expect(local.remove('/uploads/../package.json')).rejects.toThrow(/Refusing to delete/);
  });
});

describe('photo storage during tests', () => {
  test('a test run uses local storage even when .env says cloud', () => {
    const test = { ...valid, NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/app_test' };
    expect(parseEnv({ ...test, STORAGE_DRIVER: 'cloud', CLOUDINARY_URL: 'cloudinary://123:abc@my-cloud' }).STORAGE_DRIVER).toBe('local');
    expect(require('../src/storage').driver).toBe('local');
  });
});
