'use strict';

const knexFactory = require('knex');
const env = require('./env');
const { logger } = require('./logger');

// Tests run against TEST_DATABASE_URL when it is configured; every other
// environment (development, production) uses DATABASE_URL.
function resolveConnectionUrl(envName = env.NODE_ENV) {
  if (envName === 'test' && env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  return env.DATABASE_URL;
}

// Reusable knex instance. Connections are created lazily by the pool, so
// requiring this module never opens a socket on its own. Knex diagnostics
// (e.g. pool acquire failures) go through the structured pino logger.
const knex = knexFactory({
  client: 'pg',
  connection: resolveConnectionUrl(),
  pool: { min: 0, max: 10 },
  connectionTimeoutMillis: 5000,
  log: {
    warn: (message) => logger.warn({ module: 'knex' }, message),
    error: (message) => logger.error({ module: 'knex' }, message),
    deprecate: (message) => logger.warn({ module: 'knex' }, message),
  },
});

// Lightweight liveness probe for the health endpoint. Never throws: an
// unreachable database must degrade the health payload, not crash the process.
async function pingDatabase() {
  try {
    await knex.raw('SELECT 1');
    return 'up';
  } catch {
    return 'down';
  }
}

module.exports = { knex, resolveConnectionUrl, pingDatabase };
