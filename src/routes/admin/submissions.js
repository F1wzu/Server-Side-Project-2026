// Admin routes: the submission queue. Mounted under /admin (pages) and
// /api/v1/admin (API) by routes/webRoutes.js and routes/apiRoutes.js, which
// have already checked that the visitor is logged in and is an admin.
const express = require('express');
const controller = require('../../controllers/adminSubmissionController');

const web = express.Router();
web.get('/submissions', controller.list);
web.get('/submissions/:id', controller.show);
web.post('/submissions/:id/approve', controller.approve);
web.post('/submissions/:id/return', controller.returnForChanges);
web.post('/submissions/:id/reject', controller.reject);

const api = express.Router();
api.get('/submissions', controller.apiList);
api.get('/submissions/:id', controller.apiShow);
api.post('/submissions/:id/approve', controller.apiApprove);
api.post('/submissions/:id/return', controller.apiReturn);
api.post('/submissions/:id/reject', controller.apiReject);

module.exports = { web, api };
