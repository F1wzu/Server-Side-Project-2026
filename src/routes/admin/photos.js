// Admin routes: a place's photo gallery. Mounted under /admin (pages) and
// /api/v1/admin (API) by routes/webRoutes.js and routes/apiRoutes.js, which
// have already checked that the visitor is logged in and is an admin.
const express = require('express');
const controller = require('../../controllers/adminPhotoController');
const { photosUpload } = require('../../middleware/upload');
const { csrfAfterUpload } = require('../../middleware/csrf');
const { stripNul } = require('../../middleware/sanitize');

const MAX_UPLOAD = 9; // the cover plus 9 more makes 10 photos
const parseUpload = photosUpload(MAX_UPLOAD);

// Forms with photos: parse the upload, then check the CSRF token
// (these routes are listed in PHOTO_ROUTES in middleware/csrf.js).
const withPhotosApi = [parseUpload, stripNul, csrfAfterUpload];
// On the page, a refused file (wrong type, too large, too many) comes back as
// a message on the gallery page instead of an error page, so the error is
// kept on the request and raised by the handler once the CSRF check passed.
const keepUploadError = (req, res, next) =>
  parseUpload(req, res, (err) => {
    if (err) req.uploadError = err;
    next();
  });
const withPhotosWeb = [keepUploadError, stripNul, csrfAfterUpload];

const web = express.Router();
const api = express.Router();

web.get('/places/:id/photos', controller.show);
web.post('/places/:id/photos', withPhotosWeb, controller.add);
web.post('/places/:id/photos/:photoId/cover', controller.makeCover);
web.post('/places/:id/photos/:photoId/move', controller.move);
web.post('/places/:id/photos/:photoId/delete', controller.remove);
web.post('/places/:id/cover/delete', controller.removeCover);

api.post('/places/:id/photos', withPhotosApi, controller.apiAdd);
api.post('/places/:id/photos/:photoId/cover', controller.apiMakeCover);
api.post('/places/:id/photos/:photoId/move', controller.apiMove);
api.delete('/places/:id/photos/:photoId', controller.apiRemove);
api.delete('/places/:id/cover', controller.apiRemoveCover);

module.exports = { web, api };
