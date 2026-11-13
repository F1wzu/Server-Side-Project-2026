// Opening hours are kept in two shapes: as JSON on a submission
// ([{ weekday, state, opensAt: "09:00", closesAt: "17:00", closesNextDay }] × 7)
// and as seven rows in place_hours for a published place.

// "09:00" -> a value for a TIME column (only the time part is stored).
const toTime = (hhmm) => new Date(`1970-01-01T${hhmm}:00Z`);

// The JSON shape -> seven rows ready for `place.hours.create` / createMany.
function toPlaceHoursRows(hours) {
  return hours.map((day) => ({
    weekday: day.weekday,
    state: day.state,
    opensAt: day.state === 'open' ? toTime(day.opensAt) : null,
    closesAt: day.state === 'open' ? toTime(day.closesAt) : null,
    closesNextDay: day.state === 'open' ? Boolean(day.closesNextDay) : false,
  }));
}

module.exports = { toPlaceHoursRows, toTime };
