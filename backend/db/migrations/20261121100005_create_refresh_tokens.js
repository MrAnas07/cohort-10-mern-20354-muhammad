'use strict';

/**
 * refresh_tokens table — docs/architecture.md §4.3 and §4.4.
 * Used by Phase 05 (rotating refresh tokens, secure logout).
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE refresh_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      token_hash char(64) NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await knex.raw('CREATE INDEX refresh_tokens_user_id_idx ON refresh_tokens (user_id)');
};

exports.down = async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS refresh_tokens');
};
