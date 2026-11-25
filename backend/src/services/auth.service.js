'use strict';

const bcrypt = require('bcryptjs');
const { logger } = require('../config/logger');
const { AppError, AuthenticationError, ConflictError } = require('../errors/AppError');
const userRepository = require('../repositories/user.repository');
const refreshTokenRepository = require('../repositories/refreshToken.repository');
const tokenService = require('./token.service');

// bcrypt cost factor 12 (architecture 6.1).
const BCRYPT_ROUNDS = 12;

// Timing-attack parity (6.1): when the email is unknown the login still runs
// a full bcrypt comparison against this throwaway hash, so "no such account"
// and "wrong password" take the same time and reveal nothing. Computed once.
const DUMMY_HASH = bcrypt.hashSync('timing-parity-placeholder-password1', BCRYPT_ROUNDS);

// The only user shape that ever leaves this layer — passwordHash never goes
// into a response, a log or a token.
function toPublicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    createdAt: user.createdAt,
  };
}

function invalidCredentials() {
  // Same message whether the email or the password is wrong (5.3 #2).
  return new AppError('Invalid email or password', {
    statusCode: 401,
    code: 'INVALID_CREDENTIALS',
  });
}

function invalidRefreshToken() {
  // Missing, expired, revoked and unknown refresh tokens share one code (5.3 #3).
  return new AuthenticationError('Invalid or expired refresh token');
}

// Login and refresh share the session mechanics: persist the refresh hash,
// then hand back the cookie values (never the hash).
async function createSession(userId) {
  const { token, hash, expiresAt } = tokenService.createRefreshToken();
  await refreshTokenRepository.create({ userId, tokenHash: hash, expiresAt });
  return {
    accessToken: tokenService.issueAccessToken(userId),
    refreshToken: token,
    refreshExpiresAt: expiresAt,
  };
}

// 5.3 #1 — register. The user is created but not logged in; the client sends
// them to login explicitly.
async function register({ fullName, email, password }) {
  const existing = await userRepository.findByEmail(email);
  if (existing) {
    throw new ConflictError('An account with this email already exists', {
      code: 'EMAIL_ALREADY_REGISTERED',
    });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await userRepository.create({ fullName, email, passwordHash });

  // Security event log: identifiers only, never the password or its hash.
  logger.info({ event: 'auth.register', userId: user.id }, 'user registered');
  return { user: toPublicUser(user) };
}

// 5.3 #2 — login. Sets both cookies through the controller; the response body
// carries the user only, never a token.
async function login({ email, password }) {
  const user = await userRepository.findByEmail(email);
  const matches = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);

  if (!user || !matches) {
    logger.warn({ event: 'auth.login.failed', email }, 'login failed');
    throw invalidCredentials();
  }

  const session = await createSession(user.id);
  logger.info({ event: 'auth.login', userId: user.id }, 'login succeeded');
  return { user: toPublicUser(user), session };
}

// 5.3 #3 — refresh with rotation and reuse detection (6.2).
async function refresh(refreshToken) {
  if (!refreshToken) throw invalidRefreshToken();

  const hash = tokenService.hashRefreshToken(refreshToken);
  const stored = await refreshTokenRepository.findByHash(hash);
  if (!stored) throw invalidRefreshToken();

  if (stored.revokedAt) {
    // A revoked token coming back means it may have been stolen: kill every
    // live session for this user and record the security event.
    await refreshTokenRepository.revokeAllForUser(stored.userId);
    logger.warn(
      { event: 'auth.refresh.reuse_detected', userId: stored.userId },
      'revoked refresh token reused; all sessions revoked',
    );
    throw invalidRefreshToken();
  }

  if (stored.expiresAt <= new Date()) throw invalidRefreshToken();

  const user = await userRepository.findById(stored.userId);
  if (!user) {
    await refreshTokenRepository.revokeAllForUser(stored.userId);
    throw invalidRefreshToken();
  }

  // Rotation: the presented token is revoked and a fresh one issued, so a
  // captured cookie has a short useful life.
  await refreshTokenRepository.revoke(hash);
  const session = await createSession(user.id);

  logger.info({ event: 'auth.refresh', userId: user.id }, 'session refreshed');
  return { user: toPublicUser(user), session };
}

// 5.3 #4 — logout. Revokes the refresh token if one was presented; a missing,
// unknown or already-revoked token changes nothing, which keeps logout
// idempotent (204 either way).
async function logout(userId, refreshToken) {
  if (refreshToken) {
    await refreshTokenRepository.revoke(tokenService.hashRefreshToken(refreshToken));
  }
  logger.info({ event: 'auth.logout', userId }, 'logout');
}

// 5.3 #5 — session restore. authenticate() already proved the token; here we
// read the current row so the response always reflects the database.
async function getMe(userId) {
  const user = await userRepository.findById(userId);
  if (!user) {
    // Valid token, deleted account: treat the session as dead.
    throw new AuthenticationError();
  }
  return { user: toPublicUser(user) };
}

module.exports = { register, login, refresh, logout, getMe, toPublicUser };
