// Helpers for tests that use the database.
const prisma = require('../../src/config/db');

// Empties every table and restarts the ID counters.
async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE submission_events, submissions, favorites, reviews, place_hours, places, categories, users, sessions
     RESTART IDENTITY CASCADE`
  );
}

module.exports = { prisma, resetDatabase };
