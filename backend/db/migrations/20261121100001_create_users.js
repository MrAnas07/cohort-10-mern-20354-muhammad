'use strict';

/**
 * Users table — docs/architecture.md §4.3.
 * Case-insensitive email uniqueness via a unique index on lower(email).
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name varchar(100) NOT NULL CHECK (length(full_name) >= 2),
      email varchar(255) NOT NULL,
      password_hash varchar(255) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await knex.raw('CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email))');
};

exports.down = async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS users');
};
