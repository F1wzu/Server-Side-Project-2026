// Server-side sessions. The browser only holds a random session ID in a
// cookie; the data (the user ID, the account's session version, the CSRF
// token and any flash message) lives in the `sessions` table.
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const { Pool } = require('pg');
const env = require('../config/env');
const logger = require('../utils/logger');

const COOKIE_NAME = 'sid'; // does not reveal the framework
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

// The session store talks to PostgreSQL directly, through its own small pool.
const pool = new Pool({ connectionString: env.DATABASE_URL, max: 5, connectionTimeoutMillis: 5000 });
pool.on('error', (err) => logger.error({ err }, 'session database connection error'));

const PgStore = connectPgSimple(session);
const store = new PgStore({
  pool,
  tableName: 'sessions',
  // Expired sessions are deleted every 15 minutes (not while testing).
  pruneSessionInterval: env.isTest ? false : 15 * 60,
  errorLog: (err) => logger.error({ err }, 'session store error'),
});

// Session IDs that were logged out in the last hour. The store saves a
// session with "insert or update", so a request that was still running when
// its session was logged out would otherwise write the session back, logged
// in, after the logout had deleted it. Writes for these IDs are ignored.
// Kept in memory: enough for the single server this app runs on.
const REVOKED_FOR_MS = 60 * 60 * 1000;
const revoked = new Map();

function revokeSession(sid) {
  if (!sid) return;
  const now = Date.now();
  revoked.set(sid, now + REVOKED_FOR_MS);
  for (const [id, until] of revoked) if (until < now) revoked.delete(id);
}
const isRevoked = (sid) => (revoked.get(sid) ?? 0) > Date.now();

for (const method of ['set', 'touch']) {
  const original = store[method].bind(store);
  store[method] = (sid, sess, callback) => (isRevoked(sid) ? callback?.() : original(sid, sess, callback));
}

function cookieOptions(isProduction) {
  return {
    httpOnly: true, // page scripts cannot read it
    sameSite: 'lax', // not sent on cross-site form posts
    secure: isProduction, // HTTPS only in production
    maxAge: SEVEN_DAYS,
    path: '/',
  };
}

const sessionMiddleware = session({
  name: COOKIE_NAME,
  secret: env.SESSION_SECRET,
  store,
  resave: false,
  saveUninitialized: false, // a visitor gets no session until one is needed
  cookie: cookieOptions(env.isProduction),
});

async function closeSessionStore() {
  await store.close();
  await pool.end();
}

module.exports = { sessionMiddleware, closeSessionStore, cookieOptions, revokeSession, COOKIE_NAME, store };
