'use strict';

/**
 * Notes table — docs/architecture.md §4.3 and §4.4.
 * search_vector is a stored generated column (weight A: title, B: content_text)
 * that the GIN index supports for full-text search in Phase 06.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
      title varchar(200) NOT NULL CHECK (length(trim(title)) >= 1),
      content jsonb NOT NULL,
      content_text text NOT NULL DEFAULT '',
      is_pinned boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', title), 'A') ||
        setweight(to_tsvector('english', content_text), 'B')
      ) STORED
    )
  `);
  await knex.raw('CREATE INDEX notes_user_updated_at_idx ON notes (user_id, updated_at DESC)');
  await knex.raw(
    'CREATE INDEX notes_user_pinned_updated_at_idx ON notes (user_id, is_pinned, updated_at DESC)',
  );
  await knex.raw('CREATE INDEX notes_search_vector_idx ON notes USING GIN (search_vector)');
};

exports.down = async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS notes');
};
