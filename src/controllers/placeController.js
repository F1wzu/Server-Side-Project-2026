// Browsing places: the list, a place page, the map, "random", and the
// public JSON API. Page handlers and API handlers call the same model.
const placeModel = require('../models/place');
const categoryModel = require('../models/category');
const reviewModel = require('../models/review');
const favoriteModel = require('../models/favorite');
const AppError = require('../utils/AppError');
const { bangkokNow } = require('../utils/openingHours');
const { validate } = require('../utils/validate');
const { parseId } = require('../utils/ids');
const { listQuerySchema, lenientListQuery, randomQuerySchema } = require('../validation/place');

const notFound = () => AppError.notFound('ไม่พบสถานที่นี้');

// The id from the URL, or a 404 when it is not written exactly as an id
// ("01" or "1e0" would otherwise be a second address for the same place).
function placeId(req) {
  const id = parseId(req.params.id);
  if (id === null) throw notFound();
  return id;
}

async function findPlace(req) {
  const place = await placeModel.findPublishedById(placeId(req));
  if (!place) throw notFound();
  return place;
}

// Category and "open now" for /places/random; a wrong value is ignored.
function randomFilters(query) {
  const parsed = randomQuerySchema.safeParse(query);
  return parsed.success ? parsed.data : {};
}

// ---------- pages ----------

// GET /places
async function list(req, res) {
  const filters = lenientListQuery(req.query);
  const [result, categories] = await Promise.all([placeModel.list({ ...filters, clamp: true }), categoryModel.listWithCounts()]);

  // Links to other pages keep the current search.
  const pageLink = (page) => {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.categoryId) params.set('categoryId', filters.categoryId);
    if (filters.openNow) params.set('openNow', 'true');
    if (filters.sort !== 'name') params.set('sort', filters.sort);
    if (page > 1) params.set('page', page);
    const query = params.toString();
    return query ? `/places?${query}` : '/places';
  };
  res.render('places', { title: 'สำรวจสถานที่', filters, result, categories, pageLink });
}

// GET /places/random — "สุ่มให้หน่อย"
async function random(req, res) {
  const id = await placeModel.randomId(randomFilters(req.query));
  res.redirect(id ? `/places/${id}` : '/places');
}

// GET /places/:id
async function show(req, res) {
  const place = await findPlace(req);
  const reviewsPage = Number.isInteger(Number(req.query.reviewsPage)) && Number(req.query.reviewsPage) >= 1 ? Number(req.query.reviewsPage) : 1;
  const [related, reviews, ownReview, saved] = await Promise.all([
    placeModel.related(place),
    reviewModel.listForPlace(place.id, { page: Math.min(reviewsPage, 100000) }),
    req.user ? reviewModel.findOwnForPlace(req.user.id, place.id) : null,
    req.user ? favoriteModel.isSaved(req.user.id, place.id) : false,
  ]);
  const reviewsPageLink = (page) => (page > 1 ? `/places/${place.id}?reviewsPage=${page}#reviews` : `/places/${place.id}#reviews`);
  res.render('place', {
    title: place.name,
    place,
    related,
    reviews,
    ownReview,
    saved,
    reviewsPageLink,
    todayWeekday: bangkokNow().weekday,
    withMap: place.latitude !== null,
  });
}

// GET /map
async function map(req, res) {
  const [places, total] = await Promise.all([placeModel.forMap(), placeModel.countPublished()]);
  res.render('map', { title: 'แผนที่ลาดกระบัง', places, total, withMap: true });
}

// Pages whose layout slot exists but whose feature is built in a later step.
const comingSoon = (title, text) => (req, res) => res.render('coming-soon', { title, text });

// ---------- API ----------

// GET /api/v1/categories
async function apiCategories(req, res) {
  res.json({ data: await categoryModel.listWithCounts() });
}

// GET /api/v1/places
async function apiList(req, res) {
  const { data, pagination } = await placeModel.list(validate(listQuerySchema, req.query));
  res.json({ data, meta: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total } });
}

// GET /api/v1/places/map
async function apiMap(req, res) {
  res.json({ data: await placeModel.forMap() });
}

// GET /api/v1/places/random
async function apiRandom(req, res) {
  const id = await placeModel.randomId(validate(randomQuerySchema, req.query));
  if (!id) throw AppError.notFound('ไม่พบสถานที่ที่ตรงกับเงื่อนไข');
  res.json({ data: await placeModel.findPublishedById(id) });
}

// GET /api/v1/places/:id
async function apiShow(req, res) {
  res.json({ data: await findPlace(req) });
}

// GET /api/v1/places/:id/related
async function apiRelated(req, res) {
  res.json({ data: await placeModel.related(await findPlace(req)) });
}

// GET /api/v1/recommendations
async function apiRecommendations(req, res) {
  const [featured, highlyRated] = await Promise.all([placeModel.featured(), placeModel.highlyRated()]);
  res.json({ data: { featured, highlyRated, rules: { minimumReviews: placeModel.MIN_REVIEWS_FOR_TOP_RATED } } });
}

module.exports = { list, random, show, map, comingSoon, apiCategories, apiList, apiMap, apiRandom, apiShow, apiRelated, apiRecommendations };
