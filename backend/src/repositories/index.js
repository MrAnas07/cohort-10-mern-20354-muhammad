'use strict';

// Data-access foundation: repositories are the only layer that writes SQL
// (Knex), and this module is where they share the configured instance.
// Concrete repositories (user, note, tag, refresh token) arrive with their
// features in Phases 05/06 — no business logic lives here yet.
const { knex } = require('../config/db');

module.exports = { knex };
