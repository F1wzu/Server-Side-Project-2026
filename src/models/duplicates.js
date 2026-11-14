// Places that may be the same as a submission, shown to the admin before
// they approve. Matching is done here in JS over one query: the district has
// only tens to a few hundred places, and PostgreSQL's pg_trgm is not installed.
const prisma = require('../config/db');

const NEAR_METERS = 150;
const MAX_RESULTS = 5;
// A name this short ("ก") would "contain-match" almost anything.
const MIN_NAME_LENGTH = 3;

const number = (decimal) => (decimal === null || decimal === undefined ? null : Number(decimal));

// Lower case, with spaces and punctuation removed, so "ร้าน กาแฟ-ริมคลอง"
// and "ร้านกาแฟริมคลอง" compare equal. Thai vowel / tone marks (\p{M}) stay.
const normalise = (name) => String(name).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]/gu, '');

function sameName(a, b) {
  const x = normalise(a);
  const y = normalise(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= MIN_NAME_LENGTH && long.includes(short);
}

// Distance between two points in metres (haversine).
function distanceMeters(a, b) {
  const rad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}

// Only submissions that can still be decided on need the check.
const CHECKED_STATUSES = ['pending', 'changes_requested'];

// Returns up to five places (published or not), best matches first:
// both name and pin, then name only, then pin only (nearest first).
// Each has `matchedBy`: ['name'], ['pin'] or both.
async function findPossibleDuplicates(submission) {
  if (!CHECKED_STATUSES.includes(submission.status)) return [];
  const pin = number(submission.latitude) === null ? null : { latitude: number(submission.latitude), longitude: number(submission.longitude) };

  const places = await prisma.place.findMany({
    select: { id: true, name: true, status: true, latitude: true, longitude: true, category: { select: { id: true, name: true } } },
    orderBy: { id: 'asc' },
  });

  const found = [];
  for (const place of places) {
    const matchedBy = [];
    if (sameName(place.name, submission.name)) matchedBy.push('name');
    const at = number(place.latitude) === null || number(place.longitude) === null ? null : { latitude: number(place.latitude), longitude: number(place.longitude) };
    const distance = pin && at ? Math.round(distanceMeters(pin, at)) : null;
    if (distance !== null && distance <= NEAR_METERS) matchedBy.push('pin');
    if (matchedBy.length) found.push({ id: place.id, name: place.name, status: place.status, category: place.category, distanceMeters: distance, matchedBy });
  }

  const rank = (item) => (item.matchedBy.length === 2 ? 0 : item.matchedBy[0] === 'name' ? 1 : 2);
  found.sort((a, b) => rank(a) - rank(b) || (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity) || a.id - b.id);
  return found.slice(0, MAX_RESULTS);
}

module.exports = { findPossibleDuplicates, normalise, sameName, distanceMeters, NEAR_METERS };
