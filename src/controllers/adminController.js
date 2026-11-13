// The admin's starting page: what is waiting for a decision.
const adminSubmissionModel = require('../models/adminSubmission');
const reportModel = require('../models/report');
const placeModel = require('../models/place');

// GET /admin
async function dashboard(req, res) {
  const [pendingSubmissions, openReports, publishedPlaces] = await Promise.all([
    adminSubmissionModel.pendingCount(),
    reportModel.listOpenCount(),
    placeModel.countPublished(),
  ]);
  res.render('admin/index', { title: 'ผู้ดูแลระบบ', pendingSubmissions, openReports, publishedPlaces });
}

module.exports = { dashboard };
