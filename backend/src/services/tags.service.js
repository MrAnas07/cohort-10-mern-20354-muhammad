'use strict';

const tagRepository = require('../repositories/tag.repository');

// Endpoint 11 (5.3 #11): the caller's own tags that are attached to at least
// one note, with counts - what the dashboard's tag filter is built from.
async function list(userId) {
  return tagRepository.listWithCounts(userId);
}

module.exports = { list };
