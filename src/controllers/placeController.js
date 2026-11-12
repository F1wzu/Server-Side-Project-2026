// Place pages. The layout is complete; search by text, category and sort
// work. "Open now", pagination, the map and the JSON API come with the
// catalog step (docs/PLAN.md, step 3).
const placeModel = require('../models/place');
const categoryModel = require('../models/category');
const AppError = require('../utils/AppError');

// A positive whole number from a URL, or null.
function toId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function readFilters(query) {
  return {
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 100) : '',
    categoryId: toId(query.categoryId),
    sort: Object.hasOwn(placeModel.SORTS, query.sort) ? query.sort : 'name',
  };
}

// GET /places
async function list(req, res) {
  const filters = readFilters(req.query);
  const [places, categories] = await Promise.all([placeModel.list(filters), categoryModel.listWithCounts()]);
  res.render('places', { title: 'สำรวจสถานที่', filters, places, categories });
}

// GET /places/random — "สุ่มให้หน่อย"
async function random(req, res) {
  const id = await placeModel.randomId({ categoryId: toId(req.query.categoryId) });
  res.redirect(id ? `/places/${id}` : '/places');
}

// GET /places/:id
async function show(req, res) {
  const id = toId(req.params.id);
  const place = id && (await placeModel.findPublishedById(id));
  if (!place) throw AppError.notFound('ไม่พบสถานที่นี้');

  const related = await placeModel.sameCategory(place);
  // The weekday in Bangkok, whatever time zone the server runs in.
  const todayWeekday = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCDay();
  res.render('place', { title: place.name, place, related, todayWeekday });
}

// Pages whose layout slot exists but whose feature is built in a later step.
const comingSoon = (title, text) => (req, res) => res.render('coming-soon', { title, text });

module.exports = { list, random, show, comingSoon };
