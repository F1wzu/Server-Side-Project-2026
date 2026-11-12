// Builds the Express app. server.js starts it; the tests import it directly.
// The middleware order is part of the design: see docs/ARCHITECTURE.md section 4.
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const env = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const { notFound, errorHandler } = require('./middleware/errors');
const webRoutes = require('./routes/webRoutes');
const apiRoutes = require('./routes/apiRoutes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY) {
    // A number means "how many proxies are in front of the app".
    app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);
  }
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.locals.siteName = 'วันนี้ไปไหนดี @ ลาดกระบัง';

  app.use(requestLogger); // 1. request ID + log line
  app.use(helmet()); // 2. security headers
  app.use(compression()); // 3. smaller responses
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: env.isProduction ? '7d' : 0 })); // 4. site assets
  app.use(express.urlencoded({ extended: false, limit: '64kb' })); // 5. form bodies
  app.use(express.json({ limit: '64kb' })); //    JSON bodies
  // 6–8. session, current user and CSRF are added in step 2

  app.use('/api/v1', apiRoutes); // 9. routes
  app.use(webRoutes);

  app.use(notFound); // 10. no route matched
  app.use(errorHandler); // 11. every error ends here

  return app;
}

module.exports = { createApp };
