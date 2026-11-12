const prisma = require('../config/db');

// Public pages only ever see published places.
function countPublished() {
  return prisma.place.count({ where: { status: 'published' } });
}

module.exports = { countPublished };
