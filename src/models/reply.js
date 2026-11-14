// Replies under a review: any member may reply, one level deep (a reply
// cannot itself be replied to). Like reviews they are soft-deleted, and an
// admin may remove one with a reason the author can see.
const prisma = require('../config/db');
const AppError = require('../utils/AppError');

const authorFields = { select: { id: true, username: true } };
const MAX_SHOWN = 50; // replies shown under one review

// What a reply looks like outside this file. The admin's id is never shown.
function present(reply) {
  const { removedById, ...rest } = reply;
  return rest;
}

const notFound = () => AppError.notFound('ไม่พบความเห็นตอบกลับนี้');

// Which replies a viewer sees under each review: every active reply, plus
// the viewer's own replies an admin removed (so they can read the reason).
// Shared by the place page, the public API and the admin lists.
function visibleTo(viewerId) {
  return viewerId ? { OR: [{ status: 'active' }, { status: 'removed', userId: viewerId }] } : { status: 'active' };
}

// For Prisma `include` on reviews: replies oldest first, so a conversation
// reads top to bottom.
function includeFor(viewerId) {
  return {
    where: visibleTo(viewerId),
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: MAX_SHOWN,
    include: { user: authorFields },
  };
}

// Admins see every reply, whatever its status.
const includeAll = {
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  include: { user: authorFields },
};

// Replies to an active review of a published place. A review that is
// hidden (deleted, removed, or its place unpublished) answers 404, so its
// existence is not revealed.
async function create(userId, reviewId, body) {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, status: 'active', place: { status: 'published' } },
    select: { id: true, placeId: true },
  });
  if (!review) throw AppError.notFound('ไม่พบรีวิวนี้');
  const reply = await prisma.reviewReply.create({ data: { reviewId, userId, body }, include: { user: authorFields } });
  return { ...present(reply), placeId: review.placeId };
}

// Edits or deletes the member's own active reply. The status is part of the
// update's condition, so a reply an admin removes at the same moment stays
// removed. Someone else's reply is "not found".
async function changeOwn(userId, replyId, data) {
  const { count } = await prisma.reviewReply.updateMany({ where: { id: replyId, userId, status: 'active' }, data });
  if (count === 0) throw notFound();
  const reply = await prisma.reviewReply.findUnique({
    where: { id: replyId },
    include: { user: authorFields, review: { select: { placeId: true } } },
  });
  const { review, ...rest } = reply;
  return { ...present(rest), placeId: review.placeId };
}

const update = (userId, replyId, body) => changeOwn(userId, replyId, { body });
const remove = (userId, replyId) => changeOwn(userId, replyId, { status: 'deleted' });

// An admin takes down an active reply. Only an active row matches, so two
// admins (or an admin and the author) cannot both act on it.
async function adminRemove(adminId, replyId, reason) {
  const { count } = await prisma.reviewReply.updateMany({
    where: { id: replyId, status: 'active' },
    data: { status: 'removed', removedById: adminId, removedReason: reason },
  });
  if (count === 0) {
    const exists = await prisma.reviewReply.findUnique({ where: { id: replyId }, select: { id: true } });
    if (!exists) throw notFound();
    throw new AppError(409, 'INVALID_STATE', 'ความเห็นตอบกลับนี้ไม่ได้อยู่ในสถานะที่นำออกได้');
  }
  return present(await prisma.reviewReply.findUnique({ where: { id: replyId }, include: { user: authorFields } }));
}

module.exports = { create, update, remove, adminRemove, includeFor, includeAll, present, MAX_SHOWN };
