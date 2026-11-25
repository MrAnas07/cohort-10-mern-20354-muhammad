'use strict';

const { expect } = require('chai');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const app = require('../../src/app');
const { knex } = require('../../src/config/db');
const userRepository = require('../../src/repositories/user.repository');
const tokenService = require('../../src/services/token.service');

const API = '/api/v1/notes';
const CSRF = { 'X-Requested-With': 'notes-app' };

// Every user flows through here so afterEach can remove exactly what a test
// created - the suite may share its database with dev seed data, and user
// deletion cascades to that user's notes and tags.
const createdUserIds = [];
let sequence = 0;

async function createUser() {
  sequence += 1;
  const user = await userRepository.create({
    fullName: `Notes Tester ${sequence}`,
    email: `notes-test-${Date.now()}-${sequence}@example.com`,
    passwordHash: bcrypt.hashSync('Str0ngPass1', 4),
  });
  createdUserIds.push(user.id);
  return { id: user.id, token: tokenService.issueAccessToken(user.id) };
}

function authHeader(user) {
  return { Cookie: `access_token=${user.token}` };
}

function textNode(text, marks) {
  return { type: 'text', text, ...(marks ? { marks } : {}) };
}

function docWith(paragraphText) {
  return { type: 'doc', content: [{ type: 'paragraph', content: [textNode(paragraphText)] }] };
}

async function createNote(user, overrides = {}) {
  const title = overrides.title || 'Untitled note';
  const res = await request(app)
    .post(API)
    .set(authHeader(user))
    .set(CSRF)
    .send({
      title,
      content: overrides.content || docWith(overrides.text || `body of ${title}`),
      ...(overrides.tags ? { tags: overrides.tags } : {}),
      ...(overrides.isPinned !== undefined ? { isPinned: overrides.isPinned } : {}),
    })
    .expect(201);
  return res.body.data.note;
}

async function listNotes(user, query = {}) {
  return request(app).get(API).query(query).set(authHeader(user)).expect(200);
}

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await knex('users').whereIn('id', createdUserIds).del();
    createdUserIds.length = 0;
  }
});

// Remote test DB (Supabase pooler): multi-request tests easily exceed the
// 5s default, so each suite gets the same headroom the auth suite uses.
describe('integration: notes - authentication and CSRF', function () {
  this.timeout(30000);

  it('rejects a tokenless list with 401 UNAUTHENTICATED', async () => {
    const res = await request(app).get(API).expect(401);
    expect(res.body.error.code).to.equal('UNAUTHENTICATED');
    expect(res.body.error.requestId).to.be.a('string');
  });

  it('rejects a tokenless create with 401 even when the CSRF header is present', async () => {
    const res = await request(app).post(API).set(CSRF).send({ title: 'x' }).expect(401);
    expect(res.body.error.code).to.equal('UNAUTHENTICATED');
  });

  it('rejects mutating requests without X-Requested-With with 403 CSRF_REJECTED', async () => {
    const user = await createUser();
    const note = await createNote(user, { title: 'csrf target' });

    const post = await request(app)
      .post(API)
      .set(authHeader(user))
      .send({ title: 'x' })
      .expect(403);
    expect(post.body.error.code).to.equal('CSRF_REJECTED');

    const patch = await request(app)
      .patch(`${API}/${note.id}`)
      .set(authHeader(user))
      .send({ title: 'y' })
      .expect(403);
    expect(patch.body.error.code).to.equal('CSRF_REJECTED');

    const del = await request(app).delete(`${API}/${note.id}`).set(authHeader(user)).expect(403);
    expect(del.body.error.code).to.equal('CSRF_REJECTED');

    // The failed attempts changed nothing.
    const after = await request(app).get(`${API}/${note.id}`).set(authHeader(user)).expect(200);
    expect(after.body.data.note.title).to.equal('csrf target');
  });
});

describe('integration: POST /notes', function () {
  this.timeout(30000);

  it('creates a note: 201, Location header, full envelope, trimmed title', async () => {
    const user = await createUser();
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [textNode('Sprint planning')] },
        { type: 'paragraph', content: [textNode('Discuss the roadmap with the team.')] },
      ],
    };

    const res = await request(app)
      .post(API)
      .set(authHeader(user))
      .set(CSRF)
      .send({
        title: '  Sprint planning  ',
        content,
        tags: ['Work', 'work', 'meetings'],
        isPinned: true,
      })
      .expect(201);

    expect(res.body.success).to.be.true;
    const note = res.body.data.note;
    expect(res.headers.location).to.equal(`${API}/${note.id}`);
    expect(Object.keys(note).sort()).to.deep.equal([
      'content',
      'createdAt',
      'id',
      'isPinned',
      'tags',
      'title',
      'updatedAt',
    ]);
    expect(note.title).to.equal('Sprint planning');
    expect(note.isPinned).to.equal(true);
    expect(note.content).to.deep.equal(content);
    expect(note.tags).to.have.members(['Work', 'meetings']);
    expect(note.tags).to.have.length(2);

    // The stored row: structured JSONB, derived plain text, owner scoping.
    const row = await knex('notes').where('id', note.id).first();
    expect(row.content).to.deep.equal(content);
    expect(row.content_text).to.equal('Sprint planning\nDiscuss the roadmap with the team.');
    expect(row.user_id).to.equal(user.id);
    expect(row.is_pinned).to.equal(true);

    // Case-insensitive dedupe left exactly one "work" tag, first spelling kept.
    const workTags = await knex('tags')
      .where('user_id', user.id)
      .whereRaw('lower(name) = ?', ['work']);
    expect(workTags).to.have.length(1);
    expect(workTags[0].name).to.equal('Work');

    const links = await knex('note_tags as nt')
      .join('tags as t', 't.id', 'nt.tag_id')
      .where('nt.note_id', note.id)
      .select('t.name');
    expect(links.map((link) => link.name)).to.have.members(['Work', 'meetings']);
    expect(links).to.have.length(2);
  });

  it('defaults isPinned to false and tolerates an absent tag list', async () => {
    const user = await createUser();
    const note = await createNote(user, { title: 'plain' });
    expect(note.isPinned).to.equal(false);
    expect(note.tags).to.deep.equal([]);
    const row = await knex('notes').where('id', note.id).first();
    expect(row.is_pinned).to.equal(false);
  });

  it('rejects invalid payloads with 400 VALIDATION_ERROR', async () => {
    const user = await createUser();
    const content = docWith('hello');
    const linkContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [textNode('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])],
        },
      ],
    };

    const invalid = [
      { case: 'empty title', body: { title: '   ', content }, field: 'title' },
      { case: 'title over 200 chars', body: { title: 'a'.repeat(201), content }, field: 'title' },
      { case: 'missing content', body: { title: 'x' }, field: 'content' },
      { case: 'null content', body: { title: 'x', content: null }, field: 'content' },
      { case: 'html string content', body: { title: 'x', content: '<p>hi</p>' }, field: 'content' },
      {
        case: 'root not doc',
        body: { title: 'x', content: { type: 'paragraph' } },
        field: 'content',
      },
      {
        case: 'disallowed node type',
        body: { title: 'x', content: { type: 'doc', content: [{ type: 'script' }] } },
        field: 'content',
      },
      {
        case: 'heading level 4',
        body: {
          title: 'x',
          content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 4 } }] },
        },
        field: 'content',
      },
      { case: 'javascript: link', body: { title: 'x', content: linkContent }, field: 'content' },
      { case: 'unknown body field', body: { title: 'x', content, nope: true }, field: '(root)' },
      { case: '11 tags', body: { title: 'x', content, tags: Array(11).fill('t') }, field: 'tags' },
      { case: '31-char tag', body: { title: 'x', content, tags: ['x'.repeat(31)] }, field: 'tags' },
      {
        case: 'isPinned as string',
        body: { title: 'x', content, isPinned: 'true' },
        field: 'isPinned',
      },
    ];

    for (const { case: name, body, field } of invalid) {
      const res = await request(app)
        .post(API)
        .set(authHeader(user))
        .set(CSRF)
        .send(body)
        .expect(400);
      expect(res.body.error.code, name).to.equal('VALIDATION_ERROR');
      expect(res.body.error.requestId, name).to.be.a('string');
      expect(
        res.body.error.details.some(
          (detail) => detail.field === field || detail.field.startsWith(`${field}.`),
        ),
        `${name} should report field ${field}`,
      ).to.be.true;
    }

    // None of the rejected payloads created a note.
    const { body } = await listNotes(user);
    expect(body.data).to.deep.equal([]);
    expect(body.meta.total).to.equal(0);
  });
});

describe('integration: GET /notes/:id', function () {
  this.timeout(30000);

  it('returns the full note with content', async () => {
    const user = await createUser();
    const created = await createNote(user, { title: 'read me', tags: ['work'] });

    const res = await request(app).get(`${API}/${created.id}`).set(authHeader(user)).expect(200);
    const note = res.body.data.note;
    expect(Object.keys(note).sort()).to.deep.equal([
      'content',
      'createdAt',
      'id',
      'isPinned',
      'tags',
      'title',
      'updatedAt',
    ]);
    expect(note.title).to.equal('read me');
    expect(note.content).to.deep.equal(docWith('body of read me'));
    expect(note.tags).to.deep.equal(['work']);
    expect(note).to.not.have.property('contentText');
  });

  it("answers 404 for another user's note and reveals nothing", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const aliceNote = await createNote(alice, { title: 'alice private' });

    const res = await request(app).get(`${API}/${aliceNote.id}`).set(authHeader(bob)).expect(404);
    expect(res.body.error.code).to.equal('NOT_FOUND');
    expect(JSON.stringify(res.body)).to.not.include('alice private');

    // The owner is unaffected.
    const owner = await request(app)
      .get(`${API}/${aliceNote.id}`)
      .set(authHeader(alice))
      .expect(200);
    expect(owner.body.data.note.title).to.equal('alice private');
  });

  it('answers 400 for an invalid uuid and 404 for an unknown one', async () => {
    const user = await createUser();
    const bad = await request(app).get(`${API}/not-a-uuid`).set(authHeader(user)).expect(400);
    expect(bad.body.error.code).to.equal('VALIDATION_ERROR');

    const missing = await request(app)
      .get(`${API}/7c9e6679-7425-40de-944b-e07fc1f90ae7`)
      .set(authHeader(user))
      .expect(404);
    expect(missing.body.error.code).to.equal('NOT_FOUND');
  });
});

describe('integration: PATCH /notes/:id', function () {
  this.timeout(30000);

  it('updates the title without touching content or content_text', async () => {
    const user = await createUser();
    const note = await createNote(user, { title: 'before', text: 'keep this text' });

    const res = await request(app)
      .patch(`${API}/${note.id}`)
      .set(authHeader(user))
      .set(CSRF)
      .send({ title: 'after' })
      .expect(200);

    expect(res.body.data.note.title).to.equal('after');
    expect(res.body.data.note.content).to.deep.equal(docWith('keep this text'));

    const row = await knex('notes').where('id', note.id).first();
    expect(row.content_text).to.equal('keep this text');
  });

  it('re-derives content_text when content changes', async () => {
    const user = await createUser();
    const note = await createNote(user, { title: 'editor', text: 'old words here' });
    const newContent = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [textNode('New title')] },
        { type: 'paragraph', content: [textNode('Fresh paragraph.')] },
      ],
    };

    const res = await request(app)
      .patch(`${API}/${note.id}`)
      .set(authHeader(user))
      .set(CSRF)
      .send({ content: newContent })
      .expect(200);

    expect(res.body.data.note.content).to.deep.equal(newContent);
    const row = await knex('notes').where('id', note.id).first();
    expect(row.content_text).to.equal('New title\nFresh paragraph.');
  });

  it('replaces the whole tag set when tags are supplied', async () => {
    const user = await createUser();
    const note = await createNote(user, { title: 'tagged', tags: ['alpha', 'beta'] });

    await request(app)
      .patch(`${API}/${note.id}`)
      .set(authHeader(user))
      .set(CSRF)
      .send({ tags: ['gamma'] })
      .expect(200);

    const after = await request(app).get(`${API}/${note.id}`).set(authHeader(user)).expect(200);
    expect(after.body.data.note.tags).to.deep.equal(['gamma']);

    const links = await knex('note_tags').where('note_id', note.id);
    expect(links).to.have.length(1);
    const linkedTag = await knex('tags').where('id', links[0].tag_id).first();
    expect(linkedTag.name).to.equal('gamma');
  });

  it('detaches every tag when tags is an empty array', async () => {
    const user = await createUser();
    const note = await createNote(user, { title: 'untag me', tags: ['alpha'] });

    await request(app)
      .patch(`${API}/${note.id}`)
      .set(authHeader(user))
      .set(CSRF)
      .send({ tags: [] })
      .expect(200);

    const after = await request(app).get(`${API}/${note.id}`).set(authHeader(user)).expect(200);
    expect(after.body.data.note.tags).to.deep.equal([]);
    expect(await knex('note_tags').where('note_id', note.id)).to.have.length(0);
  });

  it('toggles isPinned', async () => {
    const user = await createUser();
    const note = await createNote(user, { title: 'pin me' });

    const pinned = await request(app)
      .patch(`${API}/${note.id}`)
      .set(authHeader(user))
      .set(CSRF)
      .send({ isPinned: true })
      .expect(200);
    expect(pinned.body.data.note.isPinned).to.equal(true);

    const unpinned = await request(app)
      .patch(`${API}/${note.id}`)
      .set(authHeader(user))
      .set(CSRF)
      .send({ isPinned: false })
      .expect(200);
    expect(unpinned.body.data.note.isPinned).to.equal(false);
  });

  it("answers 404 for another user's note and leaves it unchanged", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const aliceNote = await createNote(alice, { title: 'alice original' });

    const res = await request(app)
      .patch(`${API}/${aliceNote.id}`)
      .set(authHeader(bob))
      .set(CSRF)
      .send({ title: 'bob was here' })
      .expect(404);
    expect(res.body.error.code).to.equal('NOT_FOUND');

    const after = await request(app)
      .get(`${API}/${aliceNote.id}`)
      .set(authHeader(alice))
      .expect(200);
    expect(after.body.data.note.title).to.equal('alice original');
  });

  it('rejects an empty body, unknown fields and invalid values with 400', async () => {
    const user = await createUser();
    const note = await createNote(user, { title: 'validate me' });
    const patch = (body) =>
      request(app).patch(`${API}/${note.id}`).set(authHeader(user)).set(CSRF).send(body);

    const empty = await patch({}).expect(400);
    expect(empty.body.error.code).to.equal('VALIDATION_ERROR');
    expect(empty.body.error.details[0].field).to.equal('(root)');

    const unknown = await patch({ nope: 1 }).expect(400);
    expect(unknown.body.error.code).to.equal('VALIDATION_ERROR');

    const badTitle = await patch({ title: '  ' }).expect(400);
    expect(badTitle.body.error.details[0].field).to.equal('title');

    const badContent = await patch({ content: { type: 'nope' } }).expect(400);
    expect(badContent.body.error.details[0].field).to.equal('content');

    const badId = await request(app)
      .patch(`${API}/nope`)
      .set(authHeader(user))
      .set(CSRF)
      .send({ title: 'x' })
      .expect(400);
    expect(badId.body.error.code).to.equal('VALIDATION_ERROR');
  });

  it('rolls the note change back when a tag write fails', async () => {
    const user = await createUser();
    const note = await createNote(user, { title: 'before rollback' });

    // A NUL byte passes zod (1 character) but PostgreSQL rejects it in text,
    // so the tag upsert fails after the title update already ran - the
    // transaction must undo it (Phase 06 acceptance: partial failures roll back).
    const nulTag = `${String.fromCharCode(0)}bad`;
    const res = await request(app)
      .patch(`${API}/${note.id}`)
      .set(authHeader(user))
      .set(CSRF)
      .send({ title: 'after rollback', tags: [nulTag] })
      .expect(500);
    expect(res.body.error.code).to.equal('INTERNAL_ERROR');

    const after = await request(app).get(`${API}/${note.id}`).set(authHeader(user)).expect(200);
    expect(after.body.data.note.title).to.equal('before rollback');
    expect(after.body.data.note.tags).to.deep.equal([]);
  });
});

describe('integration: DELETE /notes/:id', function () {
  this.timeout(30000);

  it('deletes the note with 204 and it is gone afterwards', async () => {
    const user = await createUser();
    const note = await createNote(user, { title: 'delete me', tags: ['work'] });

    const res = await request(app)
      .delete(`${API}/${note.id}`)
      .set(authHeader(user))
      .set(CSRF)
      .expect(204);
    expect(res.text).to.equal('');

    const after = await request(app).get(`${API}/${note.id}`).set(authHeader(user)).expect(404);
    expect(after.body.error.code).to.equal('NOT_FOUND');
    expect(await knex('notes').where('id', note.id)).to.have.length(0);
    expect(await knex('note_tags').where('note_id', note.id)).to.have.length(0);
  });

  it("answers 404 for another user's note and keeps it for the owner", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const aliceNote = await createNote(alice, { title: 'keep me' });

    const res = await request(app)
      .delete(`${API}/${aliceNote.id}`)
      .set(authHeader(bob))
      .set(CSRF)
      .expect(404);
    expect(res.body.error.code).to.equal('NOT_FOUND');

    const after = await request(app)
      .get(`${API}/${aliceNote.id}`)
      .set(authHeader(alice))
      .expect(200);
    expect(after.body.data.note.title).to.equal('keep me');
  });

  it('answers 400 for an invalid uuid and 404 for an already deleted note', async () => {
    const user = await createUser();
    const note = await createNote(user, { title: 'twice' });

    await request(app).delete(`${API}/${note.id}`).set(authHeader(user)).set(CSRF).expect(204);
    const second = await request(app)
      .delete(`${API}/${note.id}`)
      .set(authHeader(user))
      .set(CSRF)
      .expect(404);
    expect(second.body.error.code).to.equal('NOT_FOUND');

    const bad = await request(app)
      .delete(`${API}/nope`)
      .set(authHeader(user))
      .set(CSRF)
      .expect(400);
    expect(bad.body.error.code).to.equal('VALIDATION_ERROR');
  });
});

describe('integration: GET /notes - list', function () {
  this.timeout(30000);

  it('returns only the caller notes with the list envelope', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await createNote(alice, { title: 'alice one' });
    await createNote(alice, { title: 'alice two' });
    await createNote(bob, { title: 'bob only' });

    const res = await listNotes(alice);
    expect(res.body.success).to.be.true;
    expect(res.body.data.map((note) => note.title).sort()).to.deep.equal([
      'alice one',
      'alice two',
    ]);
    expect(res.body.meta).to.deep.equal({ page: 1, limit: 20, total: 2, totalPages: 1 });
  });

  it('never returns full content - only the list fields', async () => {
    const user = await createUser();
    await createNote(user, { title: 'small', text: 'short text' });

    const res = await listNotes(user);
    const item = res.body.data[0];
    expect(Object.keys(item).sort()).to.deep.equal([
      'createdAt',
      'excerpt',
      'id',
      'isPinned',
      'tags',
      'title',
      'updatedAt',
    ]);
    expect(item).to.not.have.property('content');
    expect(item).to.not.have.property('contentText');
    expect(item.excerpt).to.equal('short text');
  });

  it('excerpts the first 200 characters of plain text', async () => {
    const user = await createUser();
    await createNote(user, { title: 'long', text: 'x'.repeat(250) });
    await createNote(user, {
      title: 'blocked',
      content: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [textNode('Title')] },
          { type: 'paragraph', content: [textNode('Body')] },
        ],
      },
    });

    const res = await listNotes(user);
    const byTitle = Object.fromEntries(res.body.data.map((note) => [note.title, note]));
    expect(byTitle.long.excerpt).to.equal('x'.repeat(200));
    expect(byTitle.long.excerpt).to.have.length(200);
    expect(byTitle.blocked.excerpt).to.equal('Title\nBody');
  });

  it('lists pinned notes first under the default sort', async () => {
    const user = await createUser();
    await createNote(user, { title: 'pinned older', isPinned: true });
    await createNote(user, { title: 'unpinned newer' });

    const res = await listNotes(user);
    expect(res.body.data.map((note) => note.title)).to.deep.equal([
      'pinned older',
      'unpinned newer',
    ]);
    expect(res.body.data[0].isPinned).to.equal(true);
  });

  it('paginates with page, limit, total and totalPages', async () => {
    const user = await createUser();
    await createNote(user, { title: 'first' });
    await createNote(user, { title: 'second' });
    await createNote(user, { title: 'third' });

    const page1 = await listNotes(user, { page: '1', limit: '2' });
    expect(page1.body.data.map((note) => note.title)).to.deep.equal(['third', 'second']);
    expect(page1.body.meta).to.deep.equal({ page: 1, limit: 2, total: 3, totalPages: 2 });

    const page2 = await listNotes(user, { page: '2', limit: '2' });
    expect(page2.body.data.map((note) => note.title)).to.deep.equal(['first']);
    expect(page2.body.meta).to.deep.equal({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it('sorts by title ascending', async () => {
    const user = await createUser();
    await createNote(user, { title: 'gamma' });
    await createNote(user, { title: 'alpha' });
    await createNote(user, { title: 'beta' });

    const res = await listNotes(user, { sort: 'title_asc' });
    expect(res.body.data.map((note) => note.title)).to.deep.equal(['alpha', 'beta', 'gamma']);
  });

  it('searches title and content without crossing users', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await createNote(alice, { title: 'database migration', text: 'we move data carefully' });
    await createNote(alice, { title: 'grocery list', text: 'the database is fine' });
    await createNote(alice, { title: 'unrelated', text: 'nothing to see' });
    await createNote(bob, { title: 'database of cats', text: 'meow' });

    const res = await listNotes(alice, { q: 'database' });
    expect(res.body.data.map((note) => note.title).sort()).to.deep.equal([
      'database migration',
      'grocery list',
    ]);
    expect(res.body.meta.total).to.equal(2);

    const none = await listNotes(alice, { q: 'zzzznotfound' });
    expect(none.body.data).to.deep.equal([]);
    expect(none.body.meta).to.deep.equal({ page: 1, limit: 20, total: 0, totalPages: 1 });

    // Malicious-looking input stays a plain parameterised search.
    const injection = await listNotes(alice, { q: "Robert'); DROP TABLE notes;--" });
    expect(injection.body.data).to.deep.equal([]);
    expect(await knex('notes').where('user_id', alice.id)).to.have.length(3);
  });

  it('keeps pinned first with a search term, and ranks by relevance when asked', async () => {
    const user = await createUser();
    // Pinned note matches only in content (weight B); unpinned matches in the
    // title (weight A) and was created later.
    await createNote(user, {
      title: 'Room booking',
      text: 'we need a projector for the meeting',
      isPinned: true,
    });
    await createNote(user, { title: 'projector notes', text: 'nothing relevant here' });

    const pinnedFirst = await listNotes(user, { q: 'projector' });
    expect(pinnedFirst.body.data.map((note) => note.title)).to.deep.equal([
      'Room booking',
      'projector notes',
    ]);

    const relevance = await listNotes(user, { q: 'projector', sort: 'relevance' });
    expect(relevance.body.data.map((note) => note.title)).to.deep.equal([
      'projector notes',
      'Room booking',
    ]);

    const noQ = await request(app)
      .get(API)
      .query({ sort: 'relevance' })
      .set(authHeader(user))
      .expect(400);
    expect(noQ.body.error.code).to.equal('VALIDATION_ERROR');
    expect(noQ.body.error.details[0].field).to.equal('sort');
  });

  it('filters by tag for the caller only, case-insensitively', async () => {
    const alice = await createUser();
    const bob = await createUser();
    await createNote(alice, { title: 'a1', tags: ['work'] });
    await createNote(alice, { title: 'a2', tags: ['personal'] });
    await createNote(bob, { title: 'b1', tags: ['work'] });

    const lower = await listNotes(alice, { tag: 'work' });
    expect(lower.body.data.map((note) => note.title)).to.deep.equal(['a1']);

    const upper = await listNotes(alice, { tag: 'WORK' });
    expect(upper.body.data.map((note) => note.title)).to.deep.equal(['a1']);

    const unknown = await listNotes(alice, { tag: 'nope' });
    expect(unknown.body.data).to.deep.equal([]);
    expect(unknown.body.meta.total).to.equal(0);
  });

  it('filters by pinned status', async () => {
    const user = await createUser();
    await createNote(user, { title: 'up', isPinned: true });
    await createNote(user, { title: 'down' });

    const pinned = await listNotes(user, { pinned: 'true' });
    expect(pinned.body.data.map((note) => note.title)).to.deep.equal(['up']);

    const unpinned = await listNotes(user, { pinned: 'false' });
    expect(unpinned.body.data.map((note) => note.title)).to.deep.equal(['down']);
  });

  it('includes tag names on list items', async () => {
    const user = await createUser();
    await createNote(user, { title: 'tagged', tags: ['work', 'meetings'] });

    const res = await listNotes(user);
    expect(res.body.data[0].tags).to.have.members(['work', 'meetings']);
  });

  it('rejects invalid query parameters with 400 VALIDATION_ERROR', async () => {
    const user = await createUser();
    const invalid = [
      { limit: '51' },
      { limit: '0' },
      { page: '0' },
      { page: 'abc' },
      { sort: 'bogus' },
      { pinned: 'maybe' },
      { q: 'x'.repeat(101) },
      { foo: '1' },
      { tag: '' },
    ];

    for (const query of invalid) {
      const res = await request(app).get(API).query(query).set(authHeader(user)).expect(400);
      expect(res.body.error.code, JSON.stringify(query)).to.equal('VALIDATION_ERROR');
      expect(res.body.error.details, JSON.stringify(query)).to.be.an('array').that.is.not.empty;
    }
  });

  it('requires a token', async () => {
    const res = await request(app).get(API).expect(401);
    expect(res.body.error.code).to.equal('UNAUTHENTICATED');
  });
});
