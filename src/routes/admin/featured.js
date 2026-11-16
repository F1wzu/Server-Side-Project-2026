// Admin routes: the home page's "ทีมงานชวนไป" picks. Mounted under /admin
// (pages) and /api/v1/admin (API), behind the logged-in admin check.
const express = require('express');
const controller = require('../../controllers/adminFeaturedController');

const web = express.Router();
const api = express.Router();

web.get('/featured', controller.index);
web.post('/featured', controller.add);
web.post('/featured/:id/move', controller.move);
web.post('/featured/:id/remove', controller.remove);

api.get('/featured', controller.apiIndex);
api.put('/featured', controller.apiSet);

module.exports = { web, api };
