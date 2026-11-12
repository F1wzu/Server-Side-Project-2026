// JSON API, mounted at /api/v1. The endpoints are listed in docs/DESIGN.md
// and are added step by step.
const express = require('express');
const authController = require('../controllers/authController');
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

module.exports = router;
