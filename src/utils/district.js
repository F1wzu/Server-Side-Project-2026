// Lat Krabang district: its real border (from OpenStreetMap, see
// src/data/lat-krabang-boundary.json) and a check that a pin lies inside it.
// A rectangle let in the airport and parts of the neighbouring districts, so
// pins are checked against the district's actual shape.
const { ring } = require('../data/lat-krabang-boundary.json');

// The smallest rectangle around the border: a quick first check (and the
// area the map pickers are limited to).
const LAT_KRABANG = {
  minLat: Math.min(...ring.map(([lat]) => lat)),
  maxLat: Math.max(...ring.map(([lat]) => lat)),
  minLng: Math.min(...ring.map(([, lng]) => lng)),
  maxLng: Math.max(...ring.map(([, lng]) => lng)),
};

// Ray casting: count how many border edges a line going east from the point
// crosses; an odd number means inside. The district is one simple outline
// with no holes, and over a few kilometres latitude/longitude can be treated
// as flat coordinates.
function isInsideDistrict(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < LAT_KRABANG.minLat || latitude > LAT_KRABANG.maxLat || longitude < LAT_KRABANG.minLng || longitude > LAT_KRABANG.maxLng) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    const crosses = latI > latitude !== latJ > latitude && longitude < ((lngJ - lngI) * (latitude - latI)) / (latJ - latI) + lngI;
    if (crosses) inside = !inside;
  }
  return inside;
}

module.exports = { LAT_KRABANG, BOUNDARY: ring, isInsideDistrict };
