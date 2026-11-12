// Builds the Express app. server.js starts it; the tests import it directly.
// The middleware order is part of the design: see docs/ARCHITECTURE.md section 4.
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const env = require('./config/env');
const requestLogger = require('./middleware/requestLogger');
const { sessionMiddleware } = require('./middleware/session');
const { loadCurrentUser } = require('./middleware/auth');
const { csrfProtection, exposeCsrfToken } = require('./middleware/csrf');
const { exposeFlash } = require('./middleware/flash');
const { notFound, errorHandler } = require('./middleware/errors');
const webRoutes = require('./routes/webRoutes');
const apiRoutes = require('./routes/apiRoutes');
const viewHelpers = require('./views/helpers');

// A folder inside an installed package (the fonts are served from node_modules).
const packageFolder = (name, folder) => path.join(path.dirname(require.resolve(`${name}/package.json`)), folder);

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY) {
    // A number means "how many proxies are in front of the app".
    app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY);
  }
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  // Values every page uses. The safe defaults matter for the error page,
  // which can be shown before the session middleware has run.
  app.locals.siteName = 'วันนี้ไปไหนดี @ ลาดกระบัง';
  app.locals.currentUser = null;
  app.locals.currentPath = '';
  app.locals.csrfToken = () => '';
  app.locals.takeFlash = () => null;
  Object.assign(app.locals, viewHelpers); // icon(), rating(), date() ...

  app.use(requestLogger); // 1. request ID + log line
  app.use(helmet()); // 2. security headers
  app.use(compression()); // 3. smaller responses
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: env.isProduction ? '7d' : 0 })); // 4. site assets
  const fonts = { maxAge: env.isProduction ? '30d' : 0 };
  app.use('/fonts/display', express.static(packageFolder('@fontsource/chonburi', 'files'), fonts));
  app.use('/fonts/text', express.static(packageFolder('@fontsource/ibm-plex-sans-thai-looped', 'files'), fonts));
  app.use(express.urlencoded({ extended: false, limit: '64kb' })); // 5. form bodies
  app.use(express.json({ limit: '64kb' })); //    JSON bodies
  app.use(sessionMiddleware); // 6. session from the cookie
  app.use(exposeFlash);
  app.use((req, res, next) => {
    res.locals.currentPath = req.path; // the header marks the current page
    next();
  });
  app.use(loadCurrentUser); // 7. who is logged in (role read from the database)
  app.use(exposeCsrfToken);
  app.use(csrfProtection); // 8. token required on POST, PUT, PATCH, DELETE

  app.use('/api/v1', apiRoutes); // 9. routes
  app.use(webRoutes);

  app.use(notFound); // 10. no route matched
  app.use(errorHandler); // 11. every error ends here

  return app;
}

module.exports = { createApp };
