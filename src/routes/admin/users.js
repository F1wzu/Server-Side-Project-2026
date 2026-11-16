// Admin: members (list, one member, suspend and unsuspend). Mounted under
// /admin (pages) and /api/v1/admin (API) by routes/webRoutes.js and
// routes/apiRoutes.js, which have already checked that the visitor is an admin.
const express = require('express');
const users = require('../../controllers/adminUserController');

const web = express.Router();
const api = express.Router();

web.get('/users', users.listPage);
web.get('/users/:id', users.showPage);
web.post('/users/:id/suspend', users.suspendFromForm);
web.post('/users/:id/unsuspend', users.unsuspendFromForm);

api.get('/users', users.apiList);
api.get('/users/:id', users.apiShow);
api.post('/users/:id/suspend', users.apiSuspend);
api.post('/users/:id/unsuspend', users.apiUnsuspend);

module.exports = { web, api };
