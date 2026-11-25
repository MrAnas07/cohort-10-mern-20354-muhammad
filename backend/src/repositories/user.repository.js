'use strict';

const { knex } = require('../config/db');

// Row mapper: SQL columns are snake_case, the API speaks camelCase. This is
// the only place the mapping happens, so controllers never see column names.
function mapUser(row) {
  if (!row) return null;
  const user = {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    createdAt: row.created_at,
  };
  if (row.password_hash !== undefined) {
    user.passwordHash = row.password_hash;
  }
  return user;
}

// Lookups go through lower(email) so they line up with the case-insensitive
// unique index from the users migration, whatever case the input arrived in.
async function findByEmail(email) {
  const row = await knex('users').whereRaw('lower(email) = ?', [email.toLowerCase()]).first();
  return mapUser(row);
}

// Used by /auth/me: never selects password_hash, so the hash cannot leak
// further up the stack by accident.
async function findById(id) {
  const row = await knex('users')
    .select('id', 'full_name', 'email', 'created_at')
    .where('id', id)
    .first();
  return mapUser(row);
}

async function create({ fullName, email, passwordHash }) {
  const [row] = await knex('users')
    .insert({ full_name: fullName, email, password_hash: passwordHash })
    .returning(['id', 'full_name', 'email', 'created_at']);
  return mapUser(row);
}

module.exports = { findByEmail, findById, create };
