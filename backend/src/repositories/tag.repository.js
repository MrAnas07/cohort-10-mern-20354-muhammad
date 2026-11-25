'use strict';

const { knex } = require('../config/db');

// Tags are per-user and case-insensitively unique on (user_id, lower(name))
// via the expression index from the tags migration. The upsert reuses the
// existing row whatever casing arrives and keeps the owner's original
// spelling, returning the id so the caller can link it to a note.
async function upsertByName(userId, name, trx = knex) {
  const result = await trx.raw(
    'INSERT INTO tags (user_id, name) VALUES (?, ?) ON CONFLICT (user_id, lower(name)) DO UPDATE SET name = tags.name RETURNING id, name',
    [userId, name],
  );
  return result.rows[0];
}

// Passing tags to create or PATCH replaces the whole set (5.3 #9): unlink
// everything first, then upsert each name and link it. Runs inside the
// caller's transaction, so a failure anywhere rolls the note change back too.
async function replaceTagsForNote(userId, noteId, tagNames, trx = knex) {
  await trx('note_tags').where('note_id', noteId).del();
  for (const name of tagNames) {
    const tag = await upsertByName(userId, name, trx);
    await trx('note_tags').insert({ note_id: noteId, tag_id: tag.id });
  }
}

// Endpoint 11 (5.3 #11): only tags attached to at least one note, with
// counts, sorted by name. The inner join already guarantees noteCount >= 1.
async function listWithCounts(userId, trx = knex) {
  const rows = await trx('tags as t')
    .join('note_tags as nt', 'nt.tag_id', 't.id')
    .where('t.user_id', userId)
    .select('t.name as name')
    .count('nt.note_id as note_count')
    .groupBy('t.id', 't.name')
    .orderByRaw('lower(t.name) asc');

  return rows.map((row) => ({ name: row.name, noteCount: Number(row.note_count) }));
}

module.exports = { upsertByName, replaceTagsForNote, listWithCounts };
