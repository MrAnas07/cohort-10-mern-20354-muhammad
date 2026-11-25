'use strict';

const { AppError, AuthenticationError } = require('../errors/AppError');
const tokenService = require('../services/token.service');

// Authentication middleware (architecture 6.4): reads the access_token
// cookie, verifies signature, 15-minute expiry and issuer, then attaches the
// caller as req.user = { id }. Deliberately stateless — no database hit per
// request, because every later query is scoped by that id anyway.
function authenticate(req, res, next) {
  const token = req.cookies ? req.cookies.access_token : undefined;
  if (!token) {
    next(new AuthenticationError());
    return;
  }

  try {
    const payload = tokenService.verifyAccessToken(token);
    if (!payload || !payload.sub) {
      next(new AuthenticationError());
      return;
    }
    req.user = { id: payload.sub };
    next();
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') {
      // Distinguished so the client knows to try /auth/refresh once (7.2).
      next(new AppError('Access token expired', { statusCode: 401, code: 'TOKEN_EXPIRED' }));
      return;
    }
    next(new AuthenticationError());
  }
}

module.exports = authenticate;
