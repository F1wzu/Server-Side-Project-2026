module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.js'],
  // Brings the test database up to date once, before any test runs.
  globalSetup: '<rootDir>/test/support/globalSetup.js',
  // The tests share one database, so test files run one after another.
  maxWorkers: 1,
};
