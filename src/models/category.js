const prisma = require('../config/db');

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

module.exports = { count, listWithCounts };
