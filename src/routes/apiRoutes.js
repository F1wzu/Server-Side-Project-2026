// JSON API, mounted at /api/v1. The endpoints are listed in docs/DESIGN.md
// and are added step by step.
const express = require('express');
const authController = require('../controllers/authController');
const placeController = require('../controllers/placeController');
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

module.exports = router;
