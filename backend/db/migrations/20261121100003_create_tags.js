'use strict';

/**
 * Tags table — docs/architecture.md §4.3 and §4.4.
 * Tags are per-user: unique on (user_id, lower(name)).
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE tags (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      name varchar(30) NOT NULL CHECK (length(trim(name)) >= 1),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await knex.raw('CREATE UNIQUE INDEX tags_user_name_lower_unique ON tags (user_id, lower(name))');
};

exports.down = async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS tags');
};
