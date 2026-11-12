// Runs once before the test suite: applies the migrations to the test database.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function globalSetup() {
  process.env.NODE_ENV = 'test';
  // Validates the settings; in test mode DATABASE_URL is the test database.
  const env = require('../../src/config/env');

  const prismaCli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build', 'index.js');
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: path.join(__dirname, '..', '..'),
    env: { ...process.env, DATABASE_URL: env.DATABASE_URL },
    stdio: 'pipe',
  });
};
