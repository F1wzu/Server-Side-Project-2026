// Pages. Routes only connect a URL to a controller; they contain no logic.
const express = require('express');
const healthController = require('../controllers/healthController');
const homeController = require('../controllers/homeController');
const authController = require('../controllers/authController');
const adminController = require('../controllers/adminController');
const placeController = require('../controllers/placeController');
const { requireLogin, requireAdmin, redirectIfLoggedIn } = require('../middleware/auth');
const { loginLimiter, passwordChangeLimiter } = require('../middleware/rateLimit');

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
router.get('/me/favorites', requireLogin, comingSoon('ที่บันทึกไว้', 'สถานที่ที่คุณบันทึกไว้จะแสดงที่นี่'));
router.get('/me/reviews', requireLogin, comingSoon('รีวิวของฉัน', 'รีวิวที่คุณเขียนจะแสดงที่นี่ พร้อมปุ่มแก้ไขและลบ'));
router.get('/me/submissions', requireLogin, comingSoon('คำขอของฉัน', 'สถานที่ที่คุณแนะนำและสถานะการตรวจสอบจะแสดงที่นี่'));
router.get('/submissions/new', requireLogin, comingSoon('แนะนำสถานที่', 'ฟอร์มแนะนำสถานที่ พร้อมรูปและแผนที่สำหรับปักหมุด'));

// Accounts
router.get('/register', redirectIfLoggedIn, authController.showRegister);
router.post('/register', redirectIfLoggedIn, authController.register);
router.get('/login', redirectIfLoggedIn, authController.showLogin);
router.post('/login', redirectIfLoggedIn, loginLimiter, authController.login);
router.post('/logout', authController.logout);
router.get('/me', requireLogin, authController.profile);
router.post('/me', requireLogin, authController.updateProfile);
router.post('/me/password', requireLogin, passwordChangeLimiter, authController.changePassword);

// Admin
router.get('/admin', requireLogin, requireAdmin, adminController.dashboard);

module.exports = router;
