// Pages. Routes only connect a URL to a controller; they contain no logic.
const express = require('express');
const healthController = require('../controllers/healthController');
const homeController = require('../controllers/homeController');
const authController = require('../controllers/authController');
const adminController = require('../controllers/adminController');
const placeController = require('../controllers/placeController');
const reviewController = require('../controllers/reviewController');
const replyController = require('../controllers/replyController');
const reportController = require('../controllers/reportController');
const submissionController = require('../controllers/submissionController');
const { photosUpload } = require('../middleware/upload');
const { csrfAfterUpload } = require('../middleware/csrf');
const { stripNul } = require('../middleware/sanitize');

// Parse the photo form, then check its CSRF token (see middleware/csrf.js).
// Up to 5 photos per submission (the first is the cover).
const withPhotos = [photosUpload(5), stripNul, csrfAfterUpload];
const { requireLogin, requireAdmin, redirectIfLoggedIn } = require('../middleware/auth');
const { loginLimiter, passwordChangeLimiter, registerLimiter, memberWriteLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.get('/healthz', healthController.check);
router.get('/', homeController.home);

// Places. /places/random must come before /places/:id.
router.get('/places', placeController.list);
router.get('/places/random', placeController.random);
router.get('/places/:id', placeController.show);

// Pages that are in the menu already; their features arrive in later steps.
const { comingSoon } = placeController;
router.get('/map', placeController.map);

// Reviews and saved places (members)
router.post('/places/:id/reviews', requireLogin, memberWriteLimiter, reviewController.createFromForm);
router.post('/reviews/:id/edit', requireLogin, memberWriteLimiter, reviewController.updateFromForm);
router.post('/reviews/:id/delete', requireLogin, memberWriteLimiter, reviewController.deleteFromForm);
router.post('/reviews/:id/replies', requireLogin, memberWriteLimiter, replyController.createFromForm);
router.post('/replies/:id/edit', requireLogin, memberWriteLimiter, replyController.updateFromForm);
router.post('/replies/:id/delete', requireLogin, memberWriteLimiter, replyController.deleteFromForm);
router.get('/me/reviews', requireLogin, reviewController.myReviews);
router.post('/favorites/:placeId', requireLogin, reviewController.favoriteFromForm);
router.get('/me/favorites', requireLogin, reviewController.myFavorites);
router.post('/places/:id/reports', requireLogin, memberWriteLimiter, reportController.create);

// Submissions (members). Login is checked before the upload is read.
router.get('/submissions/new', requireLogin, submissionController.newForm);
router.post('/submissions', requireLogin, memberWriteLimiter, withPhotos, submissionController.create);
router.get('/me/submissions', requireLogin, submissionController.mine);
router.get('/me/submissions/:id', requireLogin, submissionController.show);
router.get('/me/submissions/:id/edit', requireLogin, submissionController.editForm);
router.post('/me/submissions/:id', requireLogin, memberWriteLimiter, withPhotos, submissionController.update);
router.post('/me/submissions/:id/resubmit', requireLogin, memberWriteLimiter, submissionController.resubmit);

// Accounts
router.get('/register', redirectIfLoggedIn, authController.showRegister);
router.post('/register', redirectIfLoggedIn, registerLimiter, authController.register);
router.get('/login', redirectIfLoggedIn, authController.showLogin);
router.post('/login', redirectIfLoggedIn, loginLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', requireLogin, authController.profile);
router.post('/me', requireLogin, authController.updateProfile);
router.post('/me/password', requireLogin, passwordChangeLimiter, authController.changePassword);

// Admin
router.get('/admin', requireLogin, requireAdmin, adminController.dashboard);

// Admin areas. Everything under /admin needs a logged-in admin.
for (const area of ['submissions', 'places', 'photos', 'moderation']) {
  router.use('/admin', requireLogin, requireAdmin, require(`./admin/${area}`).web);
}

module.exports = router;
