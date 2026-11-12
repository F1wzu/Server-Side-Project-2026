const placeModel = require('../models/place');
const categoryModel = require('../models/category');

// GET /
async function home(req, res) {
  const [totalPlaces, categories, featured, openNow, highlyRated] = await Promise.all([
    placeModel.countPublished(),
    categoryModel.listWithCounts(),
    placeModel.featured(),
    placeModel.list({ openNow: true, pageSize: 4 }),
    placeModel.highlyRated(),
  ]);
  res.render('home', {
    title: 'หน้าแรก',
    totalPlaces,
    categories,
    featured,
    openNow,
    highlyRated,
    minimumReviews: placeModel.MIN_REVIEWS_FOR_TOP_RATED,
  });
}

module.exports = { home };
