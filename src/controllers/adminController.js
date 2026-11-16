// The admin's starting page: what is waiting for a decision.
const adminSubmissionModel = require('../models/adminSubmission');
const reportModel = require('../models/report');
const placeModel = require('../models/place');
const reviewReportModel = require('../models/reviewReport');
const userModerationModel = require('../models/userModeration');

// GET /admin
async function dashboard(req, res) {
  const [pendingSubmissions, openReports, reportedReviews, publishedPlaces, suspendedMembers] = await Promise.all([
    adminSubmissionModel.pendingCount(),
    reportModel.listOpenCount(),
    reviewReportModel.countReviewsWithOpen(),
    placeModel.countPublished(),
    userModerationModel.countSuspended(),
  ]);
  res.render('admin/index', { title: 'ผู้ดูแลระบบ', pendingSubmissions, openReports, reportedReviews, publishedPlaces, suspendedMembers });
}

module.exports = { dashboard };
