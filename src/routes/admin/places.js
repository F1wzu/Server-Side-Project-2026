// Admin routes: place management. Mounted under /admin (pages) and /api/v1/admin
// (API) by routes/webRoutes.js and routes/apiRoutes.js, which have already
// checked that the visitor is logged in and is an admin.
const express = require('express');
const controller = require('../../controllers/adminPlaceController');
const { photoUpload } = require('../../middleware/upload');
const { csrfAfterUpload } = require('../../middleware/csrf');
const { stripNul } = require('../../middleware/sanitize');

// Forms with a photo: parse the upload, then check the CSRF token
// (these routes are listed in PHOTO_ROUTES in middleware/csrf.js).
const withPhoto = [photoUpload, stripNul, csrfAfterUpload];

const web = express.Router();
const api = express.Router();

web.get('/places', controller.index);
web.get('/places/new', controller.newForm);
web.post('/places', withPhoto, controller.create);
web.get('/places/:id/edit', controller.editForm);
web.post('/places/:id/status', controller.setStatus);
web.post('/places/:id', withPhoto, controller.update);

api.get('/places', controller.apiList);
api.post('/places', withPhoto, controller.apiCreate);
api.get('/places/:id', controller.apiShow);
api.patch('/places/:id', withPhoto, controller.apiUpdate);

module.exports = { web, api };
