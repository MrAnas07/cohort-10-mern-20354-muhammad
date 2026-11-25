'use strict';

const { knex } = require('../config/db');

// List rows never carry the full editor JSON (5.3 #6): the list envelope
// needs these columns only, content_text included for the excerpt.
const LIST_COLUMNS = ['id', 'title', 'content_text', 'is_pinned', 'created_at', 'updated_at'];

// Row mapper: SQL columns are snake_case, the API speaks camelCase. This is
// the only place the mapping happens, so services never see column names.
function mapNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    contentText: row.content_text,
    isPinned: row.is_pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapListNote(row) {
  return {
    id: row.id,
    title: row.title,
    contentText: row.content_text,
    isPinned: row.is_pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Ownership rule (6.5): every read and write carries user_id in the WHERE
// clause, so a missing row and someone else's row are indistinguishable.
async function findByIdForUser(id, userId, trx = knex) {
  const row = await trx('notes').where({ id, user_id: userId }).first();
  return mapNote(row);
}

const SORT_SQL = {
  updated_desc: 'notes.updated_at DESC',
  updated_asc: 'notes.updated_at ASC',
  created_desc: 'notes.created_at DESC',
  created_asc: 'notes.created_at ASC',
  title_asc: 'notes.title ASC',
};

// Full list query (5.3 #6): keyword search through the GIN index, tag and
// pinned filters, pinned-first ordering unless sorting by relevance, then
// pagination. Returns the rows of one page plus the total for the meta block.
async function list(userId, { q, tag, pinned, sort = 'updated_desc', page, limit }, trx = knex) {
  const applyFilters = (qb) => {
    qb.where('notes.user_id', userId);
    if (q) {
      qb.whereRaw("notes.search_vector @@ websearch_to_tsquery('english', ?)", [q]);
    }
    if (tag) {
      // The tag must belong to the same user too: tags are per-user, and the
      // correlation keeps other users' tag names out of the filter.
      qb.whereExists(function () {
        this.select(1)
          .from('note_tags as nt')
          .join('tags as t', 't.id', 'nt.tag_id')
          .whereColumn('nt.note_id', 'notes.id')
          .where('t.user_id', userId)
          .whereRaw('lower(t.name) = lower(?)', [tag]);
      });
    }
    if (pinned !== undefined) {
      qb.where('notes.is_pinned', pinned);
    }
  };

  const countRow = await trx('notes').modify(applyFilters).count('* as total').first();
  const total = Number(countRow.total);

  const rowsQuery = trx('notes')
    .modify(applyFilters)
    .select(LIST_COLUMNS)
    .limit(limit)
    .offset((page - 1) * limit);

  if (sort === 'relevance') {
    rowsQuery
      .orderByRaw("ts_rank(notes.search_vector, websearch_to_tsquery('english', ?)) DESC", [q])
      .orderBy('notes.updated_at', 'desc');
  } else {
    // Pinned notes float to the top for every sort except relevance (5.3 #6).
    rowsQuery
      .orderBy('notes.is_pinned', 'desc')
      .orderByRaw(SORT_SQL[sort] || SORT_SQL.updated_desc);
  }
  // Final tiebreaker keeps pagination stable when the sort column ties
  // (two notes written in the same transaction share a timestamp).
  rowsQuery.orderBy('notes.id', 'asc');

  const rows = await rowsQuery;
  return { rows: rows.map(mapListNote), total };
}

// One extra query per page (rather than a join per row) to attach tag names;
// ordered by name so list items always present tags in the same order.
async function findTagsForNotes(noteIds, userId, trx = knex) {
  const byNote = new Map();
  if (noteIds.length === 0) return byNote;

  const rows = await trx('note_tags as nt')
    .join('tags as t', 't.id', 'nt.tag_id')
    .whereIn('nt.note_id', noteIds)
    .where('t.user_id', userId)
    .select('nt.note_id as note_id', 't.name as name')
    .orderBy('t.name', 'asc');

  for (const row of rows) {
    const names = byNote.get(row.note_id) || [];
    names.push(row.name);
    byNote.set(row.note_id, names);
  }
  return byNote;
}

async function create(userId, data, trx = knex) {
  const [row] = await trx('notes')
    .insert({
      user_id: userId,
      title: data.title,
      content: data.content,
      content_text: data.contentText,
      is_pinned: data.isPinned,
    })
    .returning('*');
  return mapNote(row);
}

async function update(id, userId, patch, trx = knex) {
  const [row] = await trx('notes').where({ id, user_id: userId }).update(patch).returning('*');
  return mapNote(row);
}

// Returns true when a row was actually removed, so the service can answer
// 404 for "never existed" and "belongs to someone else" alike.
async function remove(id, userId, trx = knex) {
  const deleted = await trx('notes').where({ id, user_id: userId }).del();
  return deleted > 0;
}

module.exports = { findByIdForUser, list, findTagsForNotes, create, update, remove };
