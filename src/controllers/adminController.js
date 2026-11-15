// The admin's starting page: what is waiting for a decision.
const adminSubmissionModel = require('../models/adminSubmission');
const reportModel = require('../models/report');
const placeModel = require('../models/place');
const reviewReportModel = require('../models/reviewReport');

// GET /admin
async function dashboard(req, res) {
  const [pendingSubmissions, openReports, reportedReviews, publishedPlaces] = await Promise.all([
    adminSubmissionModel.pendingCount(),
    reportModel.listOpenCount(),
    reviewReportModel.countReviewsWithOpen(),
    placeModel.countPublished(),
  ]);
  res.render('admin/index', { title: 'ผู้ดูแลระบบ', pendingSubmissions, openReports, reportedReviews, publishedPlaces });
}

module.exports = { dashboard };
