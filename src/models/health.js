const prisma = require('../config/db');

// Resolves when the database answers a trivial query in time; rejects otherwise.
async function checkDatabase(timeoutMs = 2000) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Database did not answer within ${timeoutMs} ms`)), timeoutMs);
  });
  const query = prisma.$queryRaw`SELECT 1`;
  query.catch(() => {}); // a late failure after the timeout must not crash the process
  try {
    await Promise.race([query, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { checkDatabase };
