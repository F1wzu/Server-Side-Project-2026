// Applies new migrations to the team's shared Neon database
// (`npm run db:deploy:shared`).
//
// Two reasons this is its own command instead of `npm run db:migrate`:
// - `prisma migrate dev` may offer to reset the database when it differs
//   from the migration files; on the shared database that would erase
//   everyone's data. `migrate deploy` only ever applies new migrations.
// - Schema changes should go through Neon's direct connection
//   (DATABASE_URL_UNPOOLED); the pooled one is for the running app.
//
// prisma.config.js keeps reading DATABASE_URL on purpose: the tests run
// migrations on TEST_DATABASE_URL through that same variable, and must never
// be redirected to the shared database.
require('dotenv/config');
const { execFileSync } = require('node:child_process');

const direct = process.env.DATABASE_URL_UNPOOLED;
if (!direct) {
  console.error('DATABASE_URL_UNPOOLED is missing in .env. Ask the project owner for the shared database lines.');
  process.exit(1);
}

const prismaCli = require.resolve('prisma/build/index.js');
try {
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: direct },
  });
} catch {
  process.exit(1);
}
