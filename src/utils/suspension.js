// "Suspended now": a suspension is set (suspended_at) and either has no end
// (NULL = until an admin lifts it) or the end is still in the future. There is
// no job that clears expired suspensions; an expired one just stops counting.
// Returns { reason, until, at } or null. Used by the login check
// (middleware/auth.js) and by the admin member lists (models/userModeration.js).
function activeSuspension({ suspendedAt, suspendedUntil, suspendedReason }, now = new Date()) {
  if (!suspendedAt) return null;
  if (suspendedUntil && suspendedUntil <= now) return null;
  return { reason: suspendedReason, until: suspendedUntil ?? null, at: suspendedAt };
}

// "until <date and time>" or the open-ended wording, for the error and the banner.
function suspensionEnd(until) {
  const { dateTime } = require('../views/helpers');
  return until ? `ถึงวันที่ ${dateTime(until)}` : 'จนกว่าผู้ดูแลจะยกเลิก';
}

module.exports = { activeSuspension, suspensionEnd };
