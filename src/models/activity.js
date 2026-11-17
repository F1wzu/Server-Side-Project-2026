// The admin's activity history (/admin/activity): recent actions on the site,
// newest first. There is no log table: every entry comes from a timestamp the
// tables already keep (sign-ups, suspensions, submission events, reviews
// and replies, reports). Actions that leave no timestamp — hiding or editing a place,
// photo and category changes — are not listed.
const { Prisma } = require('@prisma/client');
const prisma = require('../config/db');
const { paginate } = require('../utils/pagination');
const { DELETED_NAME } = require('./user');

const GROUPS = ['all', 'members', 'submissions', 'places', 'reviews', 'reports'];
const PAGE_SIZE = 50;

// One SELECT per kind of action, all with the same columns.
const feed = Prisma.sql`
  SELECT u.created_at AS at, 'members' AS grp, 'member_joined' AS kind,
         u.id AS actor_id, u.username AS actor_name, NULL::int AS place_id, NULL::int AS submission_id,
         NULL::text AS subject_name, NULL::text AS note, NULL::int AS member_id
    FROM users u
  UNION ALL
  SELECT e.created_at, 'submissions', 'submission_' || e.action::text,
         e.actor_id, a.username, s.place_id, s.id, s.name, e.note, NULL
    FROM submission_events e
    JOIN submissions s ON s.id = e.submission_id
    JOIN users a ON a.id = e.actor_id
  UNION ALL
  SELECT p.created_at, 'places', 'place_added',
         p.created_by, a.username, p.id, NULL, p.name, NULL, NULL
    FROM places p
    JOIN users a ON a.id = p.created_by
   WHERE NOT EXISTS (SELECT 1 FROM submissions s WHERE s.place_id = p.id)
  UNION ALL
  SELECT r.created_at, 'reviews', 'review_posted',
         r.user_id, a.username, r.place_id, NULL, p.name, NULL, NULL
    FROM reviews r
    JOIN users a ON a.id = r.user_id
    JOIN places p ON p.id = r.place_id
  UNION ALL
  -- A removed review is not changed afterwards, so updated_at is when it was removed.
  SELECT r.updated_at, 'reviews', 'review_removed',
         r.removed_by, a.username, r.place_id, NULL, p.name, r.removed_reason, NULL
    FROM reviews r
    JOIN users a ON a.id = r.removed_by
    JOIN places p ON p.id = r.place_id
   WHERE r.status = 'removed'
  UNION ALL
  SELECT rp.created_at, 'reviews', 'reply_posted',
         rp.user_id, a.username, r.place_id, NULL, p.name, NULL, NULL
    FROM review_replies rp
    JOIN reviews r ON r.id = rp.review_id
    JOIN users a ON a.id = rp.user_id
    JOIN places p ON p.id = r.place_id
  UNION ALL
  SELECT rp.updated_at, 'reviews', 'reply_removed',
         rp.removed_by, a.username, r.place_id, NULL, p.name, rp.removed_reason, NULL
    FROM review_replies rp
    JOIN reviews r ON r.id = rp.review_id
    JOIN users a ON a.id = rp.removed_by
    JOIN places p ON p.id = r.place_id
   WHERE rp.status = 'removed'
  UNION ALL
  SELECT pr.created_at, 'reports', 'place_reported',
         pr.user_id, a.username, pr.place_id, NULL, p.name, pr.details, NULL
    FROM place_reports pr
    JOIN users a ON a.id = pr.user_id
    JOIN places p ON p.id = pr.place_id
  UNION ALL
  SELECT pr.resolved_at, 'reports', 'place_report_' || pr.status::text,
         pr.resolved_by, a.username, pr.place_id, NULL, p.name, NULL, NULL
    FROM place_reports pr
    JOIN users a ON a.id = pr.resolved_by
    JOIN places p ON p.id = pr.place_id
   WHERE pr.resolved_at IS NOT NULL
  UNION ALL
  SELECT rr.created_at, 'reports', 'review_reported',
         rr.user_id, a.username, r.place_id, NULL, p.name, rr.details, NULL
    FROM review_reports rr
    JOIN reviews r ON r.id = rr.review_id
    JOIN users a ON a.id = rr.user_id
    JOIN places p ON p.id = r.place_id
  UNION ALL
  SELECT rr.resolved_at, 'reports', 'review_report_' || rr.status::text,
         rr.resolved_by, a.username, r.place_id, NULL, p.name, NULL, NULL
    FROM review_reports rr
    JOIN reviews r ON r.id = rr.review_id
    JOIN users a ON a.id = rr.resolved_by
    JOIN places p ON p.id = r.place_id
   WHERE rr.resolved_at IS NOT NULL
  UNION ALL
  SELECT xr.created_at, 'reports', 'reply_reported',
         xr.user_id, a.username, r.place_id, NULL, p.name, xr.details, NULL
    FROM reply_reports xr
    JOIN review_replies rp ON rp.id = xr.reply_id
    JOIN reviews r ON r.id = rp.review_id
    JOIN users a ON a.id = xr.user_id
    JOIN places p ON p.id = r.place_id
  UNION ALL
  SELECT xr.resolved_at, 'reports', 'reply_report_' || xr.status::text,
         xr.resolved_by, a.username, r.place_id, NULL, p.name, NULL, NULL
    FROM reply_reports xr
    JOIN review_replies rp ON rp.id = xr.reply_id
    JOIN reviews r ON r.id = rp.review_id
    JOIN users a ON a.id = xr.resolved_by
    JOIN places p ON p.id = r.place_id
   WHERE xr.resolved_at IS NOT NULL
  UNION ALL
  -- Suspending a member and lifting it (models/userModeration.js). The subject
  -- is the member; the note is the reason, or what the admin wrote when lifting.
  SELECT e.created_at, 'members', 'member_' || e.action::text,
         e.actor_id, a.username, NULL, NULL, m.username, e.note, m.id
    FROM user_moderation_events e
    JOIN users a ON a.id = e.actor_id
    JOIN users m ON m.id = e.user_id`;

// Where an entry leads in the admin area, by kind.
function linkOf(row) {
  if (row.member_id) return `/admin/users/${row.member_id}`;
  if (row.submission_id) return `/admin/submissions/${row.submission_id}`;
  if (!row.place_id) return null;
  if (row.grp === 'reviews') return `/admin/places/${row.place_id}/reviews`;
  if (row.kind.startsWith('place_report') || row.kind === 'place_reported') return `/admin/places/${row.place_id}/reports`;
  if (/^(review|reply)_report/.test(row.kind)) return `/admin/places/${row.place_id}/reviews`;
  return `/admin/places/${row.place_id}/edit`;
}

// One page of the history. `group` must be one of GROUPS (the caller checks).
async function list({ group = 'all', page = 1 } = {}) {
  const where = group === 'all' ? Prisma.empty : Prisma.sql`WHERE grp = ${group}`;
  const [{ total }] = await prisma.$queryRaw`SELECT count(*)::int AS total FROM (${feed}) f ${where}`;
  const pagination = paginate(total, page, PAGE_SIZE);
  if (pagination.page > pagination.totalPages) pagination.page = pagination.totalPages;
  const rows = await prisma.$queryRaw`
    SELECT * FROM (${feed}) f ${where}
     ORDER BY at DESC, kind
     LIMIT ${PAGE_SIZE} OFFSET ${(pagination.page - 1) * PAGE_SIZE}`;
  const data = rows.map((row) => ({
    at: row.at,
    group: row.grp,
    kind: row.kind,
    // The actor links to the admin's member page; a deleted account has none.
    actor: row.actor_id
      ? { id: row.actor_id, username: row.actor_name, link: row.actor_name === DELETED_NAME ? null : `/admin/users/${row.actor_id}` }
      : null,
    subject: row.subject_name,
    note: row.note,
    link: linkOf(row),
  }));
  return { data, pagination };
}

module.exports = { list, GROUPS, PAGE_SIZE };
