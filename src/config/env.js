// Reads .env, validates every setting and exports the result.
// The app refuses to start when a setting is missing or wrong.
const path = require('node:path');
const dotenv = require('dotenv');
const { z } = require('zod');

dotenv.config({ path: path.join(__dirname, '..', '..', '.env'), quiet: true });

// An empty value in .env ("PUBLIC_ORIGIN=") means "not set".
const optional = (schema) => z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const postgresUrl = z
  .string({ error: 'is required' })
  .regex(/^postgres(ql)?:\/\/\S+$/, 'must be a PostgreSQL connection string (postgresql://user:password@host:port/database)');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production'], { error: 'must be development, test or production' }).default('development'),
    PORT: z.coerce.number({ error: 'must be a number' }).int().min(1).max(65535).default(3000),
    DATABASE_URL: postgresUrl,
    TEST_DATABASE_URL: optional(postgresUrl),
    SESSION_SECRET: z
      .string({ error: 'is required' })
      .min(32, 'must be at least 32 characters; generate one with: node -e "console.log(require(\'node:crypto\').randomBytes(48).toString(\'hex\'))"'),
    PUBLIC_ORIGIN: optional(
      z.string().regex(/^https?:\/\/[^/\s]+$/, 'must be an address such as https://example.com, without a trailing slash')
    ),
    TRUST_PROXY: optional(z.string()),
    // Empty ("STORAGE_DRIVER=") means the default, local.
    STORAGE_DRIVER: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.enum(['local', 'cloud'], { error: 'must be local or cloud' }).default('local')
    ),
    LOG_LEVEL: optional(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production' && !value.PUBLIC_ORIGIN?.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_ORIGIN'], message: 'is required in production and must start with https://' });
    }
    if (value.NODE_ENV === 'test') {
      if (!value.TEST_DATABASE_URL) {
        ctx.addIssue({ code: 'custom', path: ['TEST_DATABASE_URL'], message: 'is required to run the tests' });
      } else if (value.TEST_DATABASE_URL === value.DATABASE_URL) {
        ctx.addIssue({ code: 'custom', path: ['TEST_DATABASE_URL'], message: 'must be a different database from DATABASE_URL; the tests erase it' });
      }
    }
  });

function parseEnv(source) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `  - ${issue.path.join('.') || 'settings'} ${issue.message}`);
    throw new Error(`Invalid configuration. Fix these settings in .env (see .env.example):\n${lines.join('\n')}`);
  }
  const value = result.data;
  return {
    ...value,
    // Tests always run against the separate test database.
    DATABASE_URL: value.NODE_ENV === 'test' ? value.TEST_DATABASE_URL : value.DATABASE_URL,
    LOG_LEVEL: value.LOG_LEVEL ?? (value.NODE_ENV === 'test' ? 'silent' : 'info'),
    isProduction: value.NODE_ENV === 'production',
    isTest: value.NODE_ENV === 'test',
  };
}

// The settings are read once, here. parseEnv is also exported so the tests
// can check the rules without changing the real environment.
module.exports = Object.freeze({ ...parseEnv(process.env), parseEnv });
