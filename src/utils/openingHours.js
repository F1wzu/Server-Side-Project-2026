// "Is this place open right now?"
//
// Opening hours are wall-clock times in Bangkok (UTC+7, no daylight saving),
// stored one row per weekday: 0 = Sunday ... 6 = Saturday. A row that closes
// after midnight has closesNextDay = true, for example Friday 18:00–02:00.
// That row also covers the first two hours of Saturday.

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const WEEKDAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

// The weekday and the minutes since midnight in Bangkok, whatever time zone
// the server itself runs in.
function bangkokNow(now = new Date()) {
  const local = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  return { weekday: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

// A TIME column arrives as a Date on 1970-01-01 (UTC); only the clock matters.
const toMinutes = (time) => time.getUTCHours() * 60 + time.getUTCMinutes();
const toClock = (time) => time.toISOString().slice(11, 16);

// A value for comparing against a TIME column in a query.
const minutesToTime = (minutes) => new Date(Date.UTC(1970, 0, 1, Math.floor(minutes / 60), minutes % 60));

// The status of a place from its seven hours rows:
//   { state: 'open', closesAt: '21:00' }
//   { state: 'closed', opensAt: '10:00' }  (or 'พรุ่งนี้ 10:00', 'วันจันทร์ 10:00')
//   { state: 'unknown' }                   when today's hours are not known
// Unknown is never reported as closed.
function openStatus(hours, now = new Date()) {
  const { weekday, minutes } = bangkokNow(now);
  const byDay = new Map(hours.map((row) => [row.weekday, row]));
  const today = byDay.get(weekday);
  const yesterday = byDay.get((weekday + 6) % 7);

  // Still open from yesterday evening?
  if (yesterday?.state === 'open' && yesterday.closesNextDay && minutes < toMinutes(yesterday.closesAt)) {
    return { state: 'open', closesAt: toClock(yesterday.closesAt) };
  }

  if (!today || today.state === 'unknown') return { state: 'unknown' };

  if (today.state === 'open') {
    const opens = toMinutes(today.opensAt);
    const closes = toMinutes(today.closesAt);
    if (minutes >= opens && (today.closesNextDay || minutes < closes)) {
      return { state: 'open', closesAt: toClock(today.closesAt) };
    }
    if (minutes < opens) return { state: 'closed', opensAt: toClock(today.opensAt) };
  }

  // Closed for the rest of today: find the next day it opens.
  for (let ahead = 1; ahead <= 7; ahead += 1) {
    const day = byDay.get((weekday + ahead) % 7);
    if (!day || day.state === 'unknown') break; // cannot promise an opening time
    if (day.state === 'open') {
      const label = ahead === 1 ? 'พรุ่งนี้' : `วัน${WEEKDAYS[day.weekday]}`;
      return { state: 'closed', opensAt: `${label} ${toClock(day.opensAt)}` };
    }
  }
  return { state: 'closed' };
}

// The same rule as a database filter, so "open now" can be combined with
// search, sorting and pagination inside one query.
function openNowFilter(now = new Date()) {
  const { weekday, minutes } = bangkokNow(now);
  const time = minutesToTime(minutes);
  return {
    OR: [
      // opened earlier today and not closed yet
      {
        hours: {
          some: { weekday, state: 'open', opensAt: { lte: time }, OR: [{ closesNextDay: true }, { closesAt: { gt: time } }] },
        },
      },
      // opened yesterday and closes after midnight
      { hours: { some: { weekday: (weekday + 6) % 7, state: 'open', closesNextDay: true, closesAt: { gt: time } } } },
    ],
  };
}

module.exports = { bangkokNow, openStatus, openNowFilter, toClock };
