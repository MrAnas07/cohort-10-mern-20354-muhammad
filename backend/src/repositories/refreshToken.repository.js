'use strict';

const { knex } = require('../config/db');

// refresh_tokens stores only the SHA-256 hash of the opaque refresh token
// (architecture 6.2): a database leak still leaves every session unclaimable.
function mapRefreshToken(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

async function create({ userId, tokenHash, expiresAt }) {
  const [row] = await knex('refresh_tokens')
    .insert({ user_id: userId, token_hash: tokenHash, expires_at: expiresAt })
    .returning(['id', 'user_id', 'expires_at', 'revoked_at']);
  return mapRefreshToken(row);
}

async function findByHash(tokenHash) {
  const row = await knex('refresh_tokens').where('token_hash', tokenHash).first();
  return mapRefreshToken(row);
}

// Revocation is idempotent: revoking an unknown or already-revoked token
// changes no rows, so logout and refresh are safe to retry.
async function revoke(tokenHash) {
  await knex('refresh_tokens')
    .where('token_hash', tokenHash)
    .whereNull('revoked_at')
    .update({ revoked_at: knex.fn.now() });
}

// Reuse detection (6.2): a revoked token being presented again suggests theft,
// so every live token of that user is revoked.
async function revokeAllForUser(userId) {
  await knex('refresh_tokens')
    .where('user_id', userId)
    .whereNull('revoked_at')
    .update({ revoked_at: knex.fn.now() });
}

module.exports = { create, findByHash, revoke, revokeAllForUser };
