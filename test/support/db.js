// Helpers for tests that use the database.
const prisma = require('../../src/config/db');

// Empties every table and restarts the ID counters.
async function resetDatabase() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE place_reports, submission_events, submissions, favorites, reviews, place_hours, places, categories, users, sessions
     RESTART IDENTITY CASCADE`
  );
}

// Closes every database connection so Jest can exit.
async function closeDatabase() {
  const { closeSessionStore } = require('../../src/middleware/session');
  await closeSessionStore();
  await prisma.$disconnect();
}

module.exports = { prisma, resetDatabase, closeDatabase };
