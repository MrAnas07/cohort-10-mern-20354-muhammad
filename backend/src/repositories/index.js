'use strict';

// Data-access foundation: repositories are the only layer that writes SQL
// (Knex), and this module is where they share the configured instance.
const { knex } = require('../config/db');
const userRepository = require('./user.repository');
const refreshTokenRepository = require('./refreshToken.repository');
const noteRepository = require('./note.repository');
const tagRepository = require('./tag.repository');

module.exports = {
  knex,
  userRepository,
  refreshTokenRepository,
  noteRepository,
  tagRepository,
};
