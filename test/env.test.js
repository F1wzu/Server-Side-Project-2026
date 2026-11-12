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
    expect(parseEnv({ ...valid, NODE_ENV: 'production', PUBLIC_ORIGIN: 'https://example.com' }).isProduction).toBe(true);
  });

  test('tests use the separate test database, never the development one', () => {
    const testUrl = 'postgresql://user:password@127.0.0.1:5432/app_test';
    expect(parseEnv({ ...valid, NODE_ENV: 'test', TEST_DATABASE_URL: testUrl }).DATABASE_URL).toBe(testUrl);
    expect(() => parseEnv({ ...valid, NODE_ENV: 'test' })).toThrow(/TEST_DATABASE_URL is required/);
    expect(() => parseEnv({ ...valid, NODE_ENV: 'test', TEST_DATABASE_URL: valid.DATABASE_URL })).toThrow(/different database/);
  });
});
