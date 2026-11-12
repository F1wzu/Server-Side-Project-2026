const placeModel = require('../models/place');
const categoryModel = require('../models/category');

// GET / — a placeholder until the catalog is built in step 3.
async function home(req, res) {
  const [placeCount, categoryCount] = await Promise.all([placeModel.countPublished(), categoryModel.count()]);
  res.render('home', { title: 'หน้าแรก', placeCount, categoryCount });
}

module.exports = { home };
