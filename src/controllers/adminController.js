// The admin's starting page: what is waiting for a decision.
const adminSubmissionModel = require('../models/adminSubmission');
const reportModel = require('../models/report');
const placeModel = require('../models/place');
const reviewReportModel = require('../models/reviewReport');
const userModerationModel = require('../models/userModeration');
const featuredModel = require('../models/featured');
const { FEATURED_LIMIT } = require('../models/place');

// GET /admin
async function dashboard(req, res) {
  const [pendingSubmissions, openReports, reportedReviews, publishedPlaces, suspendedMembers, featuredShown] = await Promise.all([
    adminSubmissionModel.pendingCount(),
    reportModel.listOpenCount(),
    reviewReportModel.countReviewsWithOpen(),
    placeModel.countPublished(),
    userModerationModel.countSuspended(),
    featuredModel.shownCount(),
  ]);
  res.render('admin/index', { title: 'ผู้ดูแลระบบ', pendingSubmissions, openReports, reportedReviews, publishedPlaces, suspendedMembers, featuredShown, featuredLimit: FEATURED_LIMIT });
}

module.exports = { dashboard };
