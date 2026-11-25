'use strict';

// Knex CLI entry point. Loading config/db pulls in the shared validated
// environment, so a missing or malformed DATABASE_URL fails fast before any
// connection is attempted.
const { resolveConnectionUrl } = require('./src/config/db');

function buildConfig(connection) {
  return {
    client: 'pg',
    connection,
    pool: { min: 0, max: 10 },
    migrations: {
      directory: './db/migrations',
      tableName: 'knex_migrations',
    },
    seeds: {
      directory: './db/seeds',
    },
  };
}

module.exports = {
  development: buildConfig(resolveConnectionUrl('development')),
  // Built lazily: the knex CLI only reads the environment it was asked to
  // run, so development/production commands never require TEST_DATABASE_URL.
  // Selecting `test` without it fails fast with a clear error instead of
  // silently falling back to DATABASE_URL.
  get test() {
    return buildConfig(resolveConnectionUrl('test'));
  },
  production: buildConfig(resolveConnectionUrl('production')),
};
