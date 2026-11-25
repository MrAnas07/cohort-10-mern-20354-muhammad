'use strict';

// Data-access foundation: repositories are the only layer that writes SQL
// (Knex), and this module is where they share the configured instance.
// user and refresh-token repositories arrive with Phase 05 (authentication);
// note and tag repositories arrive with Phase 06.
const { knex } = require('../config/db');
const userRepository = require('./user.repository');
const refreshTokenRepository = require('./refreshToken.repository');

module.exports = { knex, userRepository, refreshTokenRepository };
