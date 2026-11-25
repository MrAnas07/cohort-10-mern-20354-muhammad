'use strict';

const { randomBytes, createHash } = require('node:crypto');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

// Token strategy (docs/architecture.md 6.2):
// - access token: HS256 JWT, 15 minutes, claims sub/iat/exp/iss only — no
//   email or role, so a leaked token reveals nothing beyond the user id;
// - refresh token: opaque 256-bit random string, 7 days, and only its
//   SHA-256 hash is ever persisted.
// Both live in httpOnly cookies so page script cannot read them (6.3).
const ISSUER = 'notes-app';
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function issueAccessToken(userId) {
  return jwt.sign({ sub: userId }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    issuer: ISSUER,
  });
}

// Throws TokenExpiredError / JsonWebTokenError; the caller maps those to the
// TOKEN_EXPIRED / UNAUTHENTICATED codes (6.4).
function verifyAccessToken(token) {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    algorithms: ['HS256'],
    issuer: ISSUER,
  });
}

function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function createRefreshToken() {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    hash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  };
}

function cookieBase(path) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path,
  };
}

// Path-scoped so each token is only sent where it is used: the access token
// goes to the whole API, the refresh token only to /api/v1/auth (6.3).
function setAuthCookies(res, { accessToken, refreshToken, refreshExpiresAt }) {
  res.cookie('access_token', accessToken, {
    ...cookieBase('/api/v1'),
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie('refresh_token', refreshToken, {
    ...cookieBase('/api/v1/auth'),
    expires: refreshExpiresAt,
  });
}

// Clearing must repeat the original path (and flags), otherwise the browser
// considers it a different cookie and keeps the old one.
function clearAuthCookies(res) {
  res.clearCookie('access_token', cookieBase('/api/v1'));
  res.clearCookie('refresh_token', cookieBase('/api/v1/auth'));
}

module.exports = {
  ISSUER,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_MS,
  issueAccessToken,
  verifyAccessToken,
  hashRefreshToken,
  createRefreshToken,
  setAuthCookies,
  clearAuthCookies,
};
