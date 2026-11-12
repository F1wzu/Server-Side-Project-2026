// Page numbers for a list. `page` starts at 1.
function paginate(total, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page, pageSize, total, totalPages };
}

module.exports = { paginate };
