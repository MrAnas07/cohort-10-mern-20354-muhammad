'use strict';

const { knex } = require('../config/db');
const { logger } = require('../config/logger');
const { NotFoundError } = require('../errors/AppError');
const noteRepository = require('../repositories/note.repository');
const tagRepository = require('../repositories/tag.repository');
const { extractPlainText } = require('../utils/editorContent');
const { buildMeta } = require('../utils/pagination');

const EXCERPT_LENGTH = 200;

// Case-insensitive dedupe where the first spelling wins, so ["Work", "work"]
// becomes one tag and the owner's original casing is kept (5.3 #7).
function dedupeTags(tags) {
  const seen = new Set();
  const unique = [];
  for (const raw of tags) {
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(raw);
  }
  return unique;
}

function toExcerpt(contentText) {
  return (contentText || '').slice(0, EXCERPT_LENGTH);
}

// List item (5.3 #6): no full content, excerpt instead - responses stay small.
function toListItem(row, tagsByNote) {
  return {
    id: row.id,
    title: row.title,
    excerpt: toExcerpt(row.contentText),
    isPinned: row.isPinned,
    tags: tagsByNote.get(row.id) || [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Full note (5.3 #7-#9): content as stored, content_text never leaves the API.
function toFullNote(note) {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    isPinned: note.isPinned,
    tags: note.tags,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

async function list(userId, query) {
  const { rows, total } = await noteRepository.list(userId, query);
  const tagsByNote = await noteRepository.findTagsForNotes(
    rows.map((row) => row.id),
    userId,
  );
  return {
    data: rows.map((row) => toListItem(row, tagsByNote)),
    meta: buildMeta({ page: query.page, limit: query.limit, total }),
  };
}

async function get(userId, id) {
  const note = await noteRepository.findByIdForUser(id, userId);
  if (!note) throw new NotFoundError('Note not found');
  const tagsByNote = await noteRepository.findTagsForNotes([id], userId);
  return toFullNote({ ...note, tags: tagsByNote.get(id) || [] });
}

async function create(userId, input) {
  const contentText = extractPlainText(input.content);
  const tagNames = dedupeTags(input.tags || []);

  // One transaction for note + tags (Phase 06 acceptance: partial failures
  // roll back): if any tag write fails, the note insert disappears with it.
  const note = await knex.transaction(async (trx) => {
    const created = await noteRepository.create(
      userId,
      {
        title: input.title,
        content: input.content,
        contentText,
        isPinned: input.isPinned === true,
      },
      trx,
    );
    if (tagNames.length > 0) {
      await tagRepository.replaceTagsForNote(userId, created.id, tagNames, trx);
    }
    const tagsByNote = await noteRepository.findTagsForNotes([created.id], userId, trx);
    return toFullNote({ ...created, tags: tagsByNote.get(created.id) || [] });
  });

  // Logs carry ids only - never title or content, which are user data.
  logger.info({ event: 'note.created', userId, noteId: note.id }, 'Note created');
  return note;
}

async function update(userId, id, patch) {
  const note = await knex.transaction(async (trx) => {
    const hasNoteFields =
      patch.title !== undefined || patch.content !== undefined || patch.isPinned !== undefined;

    let noteRow;
    if (hasNoteFields) {
      const row = {};
      if (patch.title !== undefined) row.title = patch.title;
      if (patch.content !== undefined) {
        row.content = patch.content;
        row.content_text = extractPlainText(patch.content);
      }
      if (patch.isPinned !== undefined) row.is_pinned = patch.isPinned;
      noteRow = await noteRepository.update(id, userId, row, trx);
      // update() already scoped by user_id: an empty result means "missing or
      // someone else's", both answering 404 (5.1: 404 leaks nothing).
      if (!noteRow) throw new NotFoundError('Note not found');
    } else {
      noteRow = await noteRepository.findByIdForUser(id, userId, trx);
      if (!noteRow) throw new NotFoundError('Note not found');
    }

    // tags present (even an empty array) replaces the whole tag set (5.3 #9).
    if (patch.tags !== undefined) {
      await tagRepository.replaceTagsForNote(userId, id, dedupeTags(patch.tags), trx);
    }

    const tagsByNote = await noteRepository.findTagsForNotes([id], userId, trx);
    return toFullNote({ ...noteRow, tags: tagsByNote.get(id) || [] });
  });

  // Field names only in the log - values stay out of the logs.
  logger.info(
    { event: 'note.updated', userId, noteId: id, fields: Object.keys(patch) },
    'Note updated',
  );
  return note;
}

async function remove(userId, id) {
  const deleted = await noteRepository.remove(id, userId);
  if (!deleted) throw new NotFoundError('Note not found');
  logger.info({ event: 'note.deleted', userId, noteId: id }, 'Note deleted');
}

module.exports = { list, get, create, update, remove };
