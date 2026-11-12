// Starts the app and shuts it down cleanly.
let env;
try {
  env = require('./config/env');
} catch (err) {
  // Configuration problems: print the list of settings to fix and stop.
  console.error(err.message);
  process.exit(1);
}

const logger = require('./utils/logger');
const prisma = require('./config/db');
const { closeSessionStore } = require('./middleware/session');
const { createApp } = require('./app');

const server = createApp().listen(env.PORT, () => {
  logger.info(`Listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

server.on('error', (err) => {
  logger.fatal({ err }, err.code === 'EADDRINUSE' ? `Port ${env.PORT} is already in use` : 'Server failed to start');
  process.exit(1);
});

// Graceful shutdown: stop taking new requests, let running ones finish,
// close the database connections, then exit.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);

  const force = setTimeout(() => {
    logger.error('Shutdown took too long, forcing exit');
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(async () => {
    await closeSessionStore().catch((err) => logger.error({ err }, 'error while closing the session store'));
    await prisma.$disconnect().catch((err) => logger.error({ err }, 'error while closing the database'));
    process.exit(0);
  });
  server.closeIdleConnections();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
