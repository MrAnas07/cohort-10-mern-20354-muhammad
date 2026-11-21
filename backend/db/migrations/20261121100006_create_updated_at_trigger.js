'use strict';

/**
 * Shared updated_at trigger — docs/architecture.md §4.5.
 * One function, one trigger per table that has an updated_at column,
 * so the value stays correct even for manual SQL.
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await knex.raw(
    'CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
  );
  await knex.raw(
    'CREATE TRIGGER notes_set_updated_at BEFORE UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
  );
};

exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS notes_set_updated_at ON notes');
  await knex.raw('DROP TRIGGER IF EXISTS users_set_updated_at ON users');
  await knex.raw('DROP FUNCTION IF EXISTS set_updated_at()');
};
