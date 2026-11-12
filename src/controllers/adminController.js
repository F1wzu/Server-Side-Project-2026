// Admin pages. The tools themselves (queue, places, reviews, categories)
// are built in step 6; this page proves the admin-only check works.
function dashboard(req, res) {
  res.render('admin/index', { title: 'ผู้ดูแลระบบ' });
}

module.exports = { dashboard };
