const placeModel = require('../models/place');
const categoryModel = require('../models/category');
const favoriteModel = require('../models/favorite');

// GET /
async function home(req, res) {
  const [totalPlaces, categories, featured, openNow, highlyRated] = await Promise.all([
    placeModel.countPublished(),
    categoryModel.listWithCounts(),
    placeModel.featured(),
    placeModel.list({ openNow: true, pageSize: 4 }),
    placeModel.highlyRated(),
  ]);
  // One query tells every card on the page whether this member saved it.
  const shown = [...featured, ...openNow.data, ...highlyRated];
  const savedIds = req.user ? await favoriteModel.savedPlaceIds(req.user.id, shown.map((place) => place.id)) : null;
  res.render('home', {
    savedIds,
    cardNext: req.originalUrl,
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
