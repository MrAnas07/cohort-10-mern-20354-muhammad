'use strict';

const app = require('./app');
const env = require('./config/env');
const { logger } = require('./config/logger');
const { knex } = require('./config/db');

const SHUTDOWN_TIMEOUT_MS = 10_000;

// Express passes a listen error (e.g. EADDRINUSE) into this callback, and
// only calls it without an argument after a successful bind — so app.started
// is logged only on success, and failures exit non-zero.
const server = app.listen(env.PORT, (err) => {
  if (err) {
    logger.error({ err, port: env.PORT }, 'app.listen_failed');
    process.exit(1);
  }
  logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'app.started');
});

function shutdown(signal) {
  logger.info({ signal }, 'app.shutdown');

  const forceExit = setTimeout(() => {
    logger.error('app.shutdown_forced');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  server.close(async () => {
    try {
      // Release the PostgreSQL pool so the process can exit cleanly.
      await knex.destroy();
    } catch (err) {
      logger.error({ err }, 'app.db_close_failed');
    }
    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
