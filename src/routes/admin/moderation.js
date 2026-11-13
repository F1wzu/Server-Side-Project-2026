// Admin routes: reviews, reports and categories. Mounted under /admin (pages) and /api/v1/admin
// (API) by routes/webRoutes.js and routes/apiRoutes.js, which have already
// checked that the visitor is logged in and is an admin.
const express = require('express');
const moderation = require('../../controllers/moderationController');
const categories = require('../../controllers/categoryController');

const web = express.Router();
const api = express.Router();

web.get('/reviews', moderation.reviewsPage);
web.post('/reviews/:id/remove', moderation.removeReviewFromForm);
web.get('/reports', moderation.reportsPage);
web.post('/reports/:id/resolve', moderation.closeReportFromForm);
web.get('/categories', categories.list);
web.post('/categories', categories.createFromForm);
web.post('/categories/:id/delete', categories.removeFromForm);
web.post('/categories/:id', categories.renameFromForm);

api.get('/reviews', moderation.apiReviews);
api.post('/reviews/:id/remove', moderation.apiRemoveReview);
api.get('/reports', moderation.apiReports);
api.post('/reports/:id/resolve', moderation.apiCloseReport);
api.post('/categories', categories.apiCreate);
api.patch('/categories/:id', categories.apiRename);
api.delete('/categories/:id', categories.apiRemove);

module.exports = { web, api };
