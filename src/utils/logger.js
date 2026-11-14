// JSON logs in production, readable logs in development, silent in tests.
const pino = require('pino');
const env = require('../config/env');

const logger = pino({
  level: env.LOG_LEVEL,
  // Never write login cookies or tokens to the log.
  // Request bodies (passwords) are never logged at all.
  redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
  transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } : undefined,
});

module.exports = logger;
