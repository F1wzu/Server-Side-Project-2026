// Gives every request an ID, returns it in the X-Request-Id header and logs
// one line per request with that ID.
const { randomUUID } = require('node:crypto');
const pinoHttp = require('pino-http');
const logger = require('../utils/logger');

module.exports = pinoHttp({
  logger,
  genReqId(req, res) {
    const id = randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  // Health checks arrive every few seconds in production; do not log them.
  autoLogging: { ignore: (req) => req.url === '/healthz' },
  customLogLevel(req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
});
