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
  test: buildConfig(resolveConnectionUrl('test')),
  production: buildConfig(resolveConnectionUrl('production')),
};
