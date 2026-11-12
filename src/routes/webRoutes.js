// Pages. Routes only connect a URL to a controller; they contain no logic.
const express = require('express');
const healthController = require('../controllers/healthController');
const homeController = require('../controllers/homeController');

const router = express.Router();

router.get('/healthz', healthController.check);
router.get('/', homeController.home);

module.exports = router;
