'use strict';

const { rateLimit } = require('express-rate-limit');
const env = require('../config/env');
const { RateLimitError } = require('../errors/AppError');

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

// Starting limits from architecture 6.7. Exported so tests can assert the
// configuration without duplicating the numbers.
const LIMITS = {
  global: { limit: 100, windowMs: FIFTEEN_MINUTES },
  register: { limit: 5, windowMs: ONE_HOUR },
  login: { limit: 10, windowMs: FIFTEEN_MINUTES },
  refresh: { limit: 30, windowMs: FIFTEEN_MINUTES },
};

function buildLimiter({ limit, windowMs }, options = {}) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    // Route rejections through our error handler so a 429 uses the standard
    // envelope with code RATE_LIMITED instead of a bare limiter response.
    handler: (req, res, next) => next(new RateLimitError()),
    ...options,
  });
}

const registerLimiter = buildLimiter(LIMITS.register);
const loginLimiter = buildLimiter(LIMITS.login);
const refreshLimiter = buildLimiter(LIMITS.refresh);

// The whole suite talks to one IP; an active global limiter would starve it
// long before any interesting assertion. Skipped only under NODE_ENV=test and
// covered by the LIMITS unit test — the auth limiters stay active in tests
// and are proven end-to-end by the integration suite.
const globalLimiter = buildLimiter(LIMITS.global, {
  skip: () => env.NODE_ENV === 'test',
});

module.exports = { LIMITS, globalLimiter, registerLimiter, loginLimiter, refreshLimiter };
