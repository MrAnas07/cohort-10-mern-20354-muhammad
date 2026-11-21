'use strict';

/**
 * note_tags junction table — docs/architecture.md §4.3 and §4.4.
 * Composite primary key; both FKs cascade so deleting a note or a tag
 * removes the link automatically.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE note_tags (
      note_id uuid NOT NULL REFERENCES notes (id) ON DELETE CASCADE,
      tag_id uuid NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    )
  `);
  await knex.raw('CREATE INDEX note_tags_tag_id_idx ON note_tags (tag_id)');
};

exports.down = async function down(knex) {
  await knex.raw('DROP TABLE IF EXISTS note_tags');
};
