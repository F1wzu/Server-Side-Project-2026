const placeModel = require('../models/place');
const categoryModel = require('../models/category');

// GET /
async function home(req, res) {
  const [totalPlaces, categories, featured] = await Promise.all([
    placeModel.countPublished(),
    categoryModel.listWithCounts(),
    placeModel.featured(),
  ]);
  // "Open now" and "highly rated" are filled in by the catalog and review steps.
  res.render('home', { title: 'หน้าแรก', totalPlaces, categories, featured, highlyRated: [] });
}

module.exports = { home };
