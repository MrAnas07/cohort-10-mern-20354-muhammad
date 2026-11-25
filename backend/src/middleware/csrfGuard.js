'use strict';

const { AppError } = require('../errors/AppError');

// CSRF guard (architecture 6.10, layer 3): every mutating request must carry
// X-Requested-With: notes-app. A cross-site form or image cannot set a custom
// header without a CORS preflight, which the API refuses — cheap protection
// stacked on top of the SameSite cookie attribute.
const CSRF_HEADER = 'x-requested-with';
const CSRF_VALUE = 'notes-app';
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function csrfGuard(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  if (req.headers[CSRF_HEADER] !== CSRF_VALUE) {
    next(
      new AppError('Missing or invalid X-Requested-With header', {
        statusCode: 403,
        code: 'CSRF_REJECTED',
      }),
    );
    return;
  }

  next();
}

module.exports = csrfGuard;
