// JSON API, mounted at /api/v1. The endpoints are listed in docs/DESIGN.md
// and are added step by step.
const express = require('express');
const authController = require('../controllers/authController');
const placeController = require('../controllers/placeController');
const reviewController = require('../controllers/reviewController');
const reportController = require('../controllers/reportController');
const { requireLogin } = require('../middleware/auth');
const { loginLimiter, passwordChangeLimiter } = require('../middleware/rateLimit');

const router = express.Router();

// Accounts
router.get('/auth/csrf', authController.apiCsrf);
router.post('/auth/register', authController.apiRegister);
router.post('/auth/login', loginLimiter, authController.apiLogin);
router.post('/auth/logout', requireLogin, authController.apiLogout);
router.get('/me', requireLogin, authController.apiMe);
router.patch('/me', requireLogin, authController.apiUpdateProfile);
router.put('/me/password', requireLogin, passwordChangeLimiter, authController.apiChangePassword);

// Browsing places (public). The fixed paths come before /places/:id.
router.get('/categories', placeController.apiCategories);
router.get('/recommendations', placeController.apiRecommendations);
router.get('/places', placeController.apiList);
router.get('/places/map', placeController.apiMap);
router.get('/places/random', placeController.apiRandom);
router.get('/places/:id', placeController.apiShow);
router.get('/places/:id/related', placeController.apiRelated);
router.get('/places/:id/reviews', reviewController.apiPlaceReviews);

// Reviews and saved places (members)
router.post('/places/:id/reviews', requireLogin, reviewController.apiCreate);
router.patch('/reviews/:id', requireLogin, reviewController.apiUpdate);
router.delete('/reviews/:id', requireLogin, reviewController.apiDelete);
router.get('/me/reviews', requireLogin, reviewController.apiMyReviews);
router.get('/me/favorites', requireLogin, reviewController.apiMyFavorites);
router.put('/me/favorites/:placeId', requireLogin, reviewController.apiSaveFavorite);
router.delete('/me/favorites/:placeId', requireLogin, reviewController.apiRemoveFavorite);
router.post('/places/:id/reports', requireLogin, reportController.apiCreate);

module.exports = router;
