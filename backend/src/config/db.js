'use strict';

const knexFactory = require('knex');
const env = require('./env');
const { logger } = require('./logger');

// Hard deadline for the health ping: the probe must answer within this
// window even when the database accepts TCP connections but never responds.
// pingDatabase() enforces it with its own Promise.race, independent of the
// pg-level deadline below.
const PING_TIMEOUT_MS = 4000;

// pg-level client deadline for every query: a hung query must error out so
// knex releases its pool connection instead of holding it indefinitely. The
// suite runs against a remote test database (Supabase pooler), where healthy
// queries occasionally take several seconds, so this is deliberately larger
// than the ping window - /health still degrades at 4s via pingDatabase().
const QUERY_TIMEOUT_MS = 10000;

// Tests run against TEST_DATABASE_URL; every other environment (development,
// production) uses DATABASE_URL. The test environment requires its own URL and
// never falls back to DATABASE_URL, so a test run can never touch the
// development database by accident.
function resolveConnectionUrl(envName = env.NODE_ENV) {
  if (envName === 'test') {
    if (!env.TEST_DATABASE_URL) {
      throw new Error(
        'TEST_DATABASE_URL is required when the test environment is selected; refusing to fall back to DATABASE_URL.',
      );
    }
    return env.TEST_DATABASE_URL;
  }
  return env.DATABASE_URL;
}

// Reusable knex instance. Connections are created lazily by the pool, so
// requiring this module never opens a socket on its own. Knex diagnostics
// (e.g. pool acquire failures) go through the structured pino logger.
const knex = knexFactory({
  client: 'pg',
  connection: {
    connectionString: resolveConnectionUrl(),
    // pg-level bounds: a connect attempt or query can never hang the pool
    // longer than these deadlines allow.
    connectionTimeoutMillis: 5000,
    query_timeout: QUERY_TIMEOUT_MS,
  },
  pool: { min: 0, max: 10 },
  log: {
    warn: (message) => logger.warn({ module: 'knex' }, message),
    error: (message) => logger.error({ module: 'knex' }, message),
    deprecate: (message) => logger.warn({ module: 'knex' }, message),
  },
});

// Lightweight liveness probe for the health endpoint. Never throws and never
// outlives PING_TIMEOUT_MS: an unreachable or hung database must degrade the
// health payload, not crash or stall the process.
async function pingDatabase() {
  let deadlineTimer;
  try {
    // Settle both outcomes so a probe that loses the race can never become
    // an unhandled rejection after the deadline has already answered.
    const probe = knex.raw('SELECT 1').then(
      () => 'up',
      () => 'down',
    );
    const deadline = new Promise((resolve) => {
      deadlineTimer = setTimeout(() => resolve('down'), PING_TIMEOUT_MS);
      // Never keep the process alive for a probe that outlives shutdown.
      if (typeof deadlineTimer.unref === 'function') deadlineTimer.unref();
    });
    return await Promise.race([probe, deadline]);
  } catch {
    return 'down';
  } finally {
    clearTimeout(deadlineTimer);
  }
}

module.exports = { knex, resolveConnectionUrl, pingDatabase };
