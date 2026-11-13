const prisma = require('../config/db');
const AppError = require('../utils/AppError');

function count() {
  return prisma.category.count();
}

// Every category with the number of published places in it.
async function listWithCounts() {
  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, name: true, _count: { select: { places: { where: { status: 'published' } } } } },
  });
  return categories.map(({ _count, ...category }) => ({ ...category, placeCount: _count.places }));
}

// ---------- admin ----------

const duplicate = () => new AppError(409, 'CONFLICT', 'มีหมวดหมู่ชื่อนี้อยู่แล้ว');
const notFound = () => AppError.notFound('ไม่พบหมวดหมู่นี้');
const inUse = () => new AppError(409, 'CATEGORY_IN_USE', 'ลบไม่ได้ เพราะยังมีสถานที่หรือคำขอใช้หมวดหมู่นี้อยู่');

// The unique index is on lower(name), an expression, so the error may not
// carry the usual P2002 code; the constraint name in the message is the fallback.
const isDuplicate = (err) => err.code === 'P2002' || /categories_name_lower_key/.test(`${err.message} ${err.cause?.message ?? ''}`);
const isForeignKey = (err) => err.code === 'P2003' || /foreign key constraint|23503/i.test(`${err.message} ${err.cause?.message ?? ''}`);

// For the admin list: every place counts (published or not), and so does
// every submission, because both keep the category from being deleted.
async function listForAdmin() {
  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      _count: { select: { places: true, submissions: true } },
    },
  });
  const pending = await prisma.submission.groupBy({ by: ['categoryId'], where: { status: 'pending' }, _count: { _all: true } });
  const pendingBy = new Map(pending.map((row) => [row.categoryId, row._count._all]));
  return categories.map(({ _count, ...category }) => ({
    ...category,
    placeCount: _count.places,
    submissionCount: _count.submissions,
    pendingCount: pendingBy.get(category.id) ?? 0,
  }));
}

async function create(name) {
  try {
    return await prisma.category.create({ data: { name }, select: { id: true, name: true, createdAt: true } });
  } catch (err) {
    if (isDuplicate(err)) throw duplicate();
    throw err;
  }
}

// Renaming to the same name in another case is allowed: the unique index
// ignores the row itself.
async function rename(id, name) {
  try {
    return await prisma.category.update({ where: { id }, data: { name }, select: { id: true, name: true, createdAt: true } });
  } catch (err) {
    if (err.code === 'P2025') throw notFound();
    if (isDuplicate(err)) throw duplicate();
    throw err;
  }
}

// Refused while a place or a submission uses the category. The check gives
// the friendly answer; the foreign keys (ON DELETE RESTRICT) catch a place
// added between the check and the delete.
async function remove(id) {
  const category = await prisma.category.findUnique({
    where: { id },
    select: { _count: { select: { places: true, submissions: true } } },
  });
  if (!category) throw notFound();
  if (category._count.places > 0 || category._count.submissions > 0) throw inUse();
  try {
    await prisma.category.delete({ where: { id } });
  } catch (err) {
    if (err.code === 'P2025') throw notFound();
    if (isForeignKey(err)) throw inUse();
    throw err;
  }
}

module.exports = { count, listWithCounts, listForAdmin, create, rename, remove };
