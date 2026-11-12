// Settings for the Prisma command-line tool (migrate, seed, studio).
// The running app builds its own client in src/config/db.js.
require('dotenv/config');
const { defineConfig } = require('prisma/config');

module.exports = defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed.js',
  },
  datasource: {
    // Empty during `npm install` on a machine with no .env yet;
    // `prisma generate` does not need a database.
    url: process.env.DATABASE_URL ?? '',
  },
});
