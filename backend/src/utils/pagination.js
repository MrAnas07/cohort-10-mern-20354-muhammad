'use strict';

// List meta (architecture 5.3 #6): page and limit echo the request, total is
// the row count for the current filters, and totalPages never drops below 1
// so an empty first page still reads as "page 1 of 1" instead of "1 of 0".
function buildMeta({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

module.exports = { buildMeta };
