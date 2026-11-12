const prisma = require('../config/db');

function count() {
  return prisma.category.count();
}

module.exports = { count };
