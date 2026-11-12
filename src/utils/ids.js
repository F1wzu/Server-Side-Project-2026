// Ids in URLs (/places/12, /reviews/7, /me/submissions/3 ...).
//
// Only plain positive whole numbers without leading zeros are ids, so every
// record has exactly one address (/places/01 is not /places/1) and values such
// as "1e3", "0x1" or " 1" are not quietly turned into a number.
const MAX_ID = 2147483647; // the largest value of a PostgreSQL integer

// The id as a number, or null when the text is not a valid id.
function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,9}$/.test(value)) return null;
  const id = Number(value);
  return id <= MAX_ID ? id : null;
}

module.exports = { parseId, MAX_ID };
