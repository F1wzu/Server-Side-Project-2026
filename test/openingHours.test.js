const { bangkokNow, openStatus } = require('../src/utils/openingHours');

const time = (hhmm) => new Date(`1970-01-01T${hhmm}:00Z`);
const open = (weekday, opens, closes, closesNextDay = false) => ({ weekday, state: 'open', opensAt: time(opens), closesAt: time(closes), closesNextDay });
const closed = (weekday) => ({ weekday, state: 'closed', opensAt: null, closesAt: null, closesNextDay: false });
const unknown = (weekday) => ({ weekday, state: 'unknown', opensAt: null, closesAt: null, closesNextDay: false });

// A moment given as Bangkok wall-clock time. 2026-11-15 is a Sunday.
const SUNDAY = 15;
const at = (weekday, hhmm) => new Date(`2026-11-${SUNDAY + weekday}T${hhmm}:00+07:00`);

const week = (rows) => Array.from({ length: 7 }, (unused, weekday) => rows[weekday] ?? unknown(weekday));

describe('Bangkok time', () => {
  test('is seven hours ahead of UTC, whatever the server time zone', () => {
    expect(bangkokNow(new Date('2026-11-15T00:30:00Z'))).toEqual({ weekday: 0, minutes: 7 * 60 + 30 });
  });

  test('late evening UTC is already the next day in Bangkok', () => {
    // Sunday 18:00 UTC = Monday 01:00 in Bangkok
    expect(bangkokNow(new Date('2026-11-15T18:00:00Z'))).toEqual({ weekday: 1, minutes: 60 });
  });
});

describe('open now', () => {
  const cafe = week({ 1: open(1, '09:00', '17:00'), 2: open(2, '09:00', '17:00'), 3: closed(3) });

  test('open during the day, with the closing time', () => {
    expect(openStatus(cafe, at(1, '12:00'))).toEqual({ state: 'open', closesAt: '17:00' });
  });

  test('opening minute is open, closing minute is closed', () => {
    expect(openStatus(cafe, at(1, '09:00')).state).toBe('open');
    expect(openStatus(cafe, at(1, '16:59')).state).toBe('open');
    expect(openStatus(cafe, at(1, '17:00')).state).toBe('closed');
  });

  test('before opening shows today\'s opening time', () => {
    expect(openStatus(cafe, at(1, '07:30'))).toEqual({ state: 'closed', opensAt: '09:00' });
  });

  test('after closing shows when it opens next', () => {
    expect(openStatus(cafe, at(1, '20:00'))).toEqual({ state: 'closed', opensAt: 'พรุ่งนี้ 09:00' });
  });

  test('a closed day shows closed', () => {
    expect(openStatus(cafe, at(3, '12:00')).state).toBe('closed');
  });

  test('unknown hours are unknown, never closed', () => {
    expect(openStatus(cafe, at(5, '12:00'))).toEqual({ state: 'unknown' });
    expect(openStatus([], at(1, '12:00'))).toEqual({ state: 'unknown' });
  });

  test('does not promise an opening time across a day with unknown hours', () => {
    // Tuesday evening: Wednesday is closed, Thursday is unknown.
    expect(openStatus(cafe, at(2, '20:00'))).toEqual({ state: 'closed' });
  });

  test('names the day when the next opening is later in the week', () => {
    const weekend = week({ 0: closed(0), 1: closed(1), 2: closed(2), 3: closed(3), 4: closed(4), 5: closed(5), 6: open(6, '10:00', '16:00') });
    expect(openStatus(weekend, at(3, '12:00'))).toEqual({ state: 'closed', opensAt: 'วันเสาร์ 10:00' });
  });
});

describe('a place that closes after midnight', () => {
  // Friday 18:00 to Saturday 02:00; closed on Saturday itself.
  const bar = week({ 5: open(5, '18:00', '02:00', true), 6: closed(6), 0: closed(0) });

  test('is open on Friday night', () => {
    expect(openStatus(bar, at(5, '23:30'))).toEqual({ state: 'open', closesAt: '02:00' });
  });

  test('is still open at 01:00 on Saturday, although Saturday is a closed day', () => {
    expect(openStatus(bar, at(6, '01:00'))).toEqual({ state: 'open', closesAt: '02:00' });
  });

  test('is closed at 02:00 on Saturday', () => {
    expect(openStatus(bar, at(6, '02:00')).state).toBe('closed');
  });

  test('is closed on Friday afternoon, before it opens', () => {
    expect(openStatus(bar, at(5, '15:00'))).toEqual({ state: 'closed', opensAt: '18:00' });
  });

  test('Saturday night into Sunday wraps around the week', () => {
    const late = week({ 6: open(6, '20:00', '03:00', true), 0: closed(0) });
    expect(openStatus(late, at(7, '02:00')).state).toBe('open'); // Sunday 02:00
    expect(openStatus(late, at(7, '03:30')).state).toBe('closed');
  });

  test('open around the clock', () => {
    const always = Array.from({ length: 7 }, (unused, weekday) => open(weekday, '00:00', '00:00', true));
    expect(openStatus(always, at(2, '04:00')).state).toBe('open');
    expect(openStatus(always, at(2, '23:59')).state).toBe('open');
  });
});
