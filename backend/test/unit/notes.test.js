'use strict';

const { expect } = require('chai');
const sinon = require('sinon');

const { knex } = require('../../src/config/db');
const { NotFoundError } = require('../../src/errors/AppError');
const noteRepository = require('../../src/repositories/note.repository');
const tagRepository = require('../../src/repositories/tag.repository');
const notesService = require('../../src/services/notes.service');
const { validateEditorContent, extractPlainText } = require('../../src/utils/editorContent');
const { buildMeta } = require('../../src/utils/pagination');
const {
  createNoteSchema,
  updateNoteSchema,
  listQuerySchema,
  noteIdParamSchema,
} = require('../../src/validators/note.schemas');

const USER = '11111111-1111-4111-8111-111111111111';

function paragraph(text, marks) {
  const node = { type: 'paragraph' };
  if (text !== undefined) node.content = [{ type: 'text', text, ...(marks ? { marks } : {}) }];
  return node;
}

function textNode(text, marks) {
  return { type: 'text', text, ...(marks ? { marks } : {}) };
}

function para(...content) {
  const node = { type: 'paragraph' };
  if (content.length > 0) node.content = content;
  return node;
}

function doc(...content) {
  return { type: 'doc', content };
}

async function captureError(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the promise to reject');
}

describe('unit: editor content', () => {
  it('accepts a document with every whitelisted node and mark', () => {
    const content = doc(
      { type: 'heading', attrs: { level: 1 }, content: [textNode('Sprint')] },
      para(
        textNode('bold', [{ type: 'bold' }]),
        textNode(' and '),
        textNode('link', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
      ),
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [paragraph('one')] }],
      },
      {
        type: 'orderedList',
        content: [{ type: 'listItem', content: [paragraph('first')] }],
      },
      { type: 'blockquote', content: [paragraph('quoted')] },
      { type: 'codeBlock', content: [textNode('const x = 1;')] },
      para(textNode('i', [{ type: 'italic' }])),
      para(
        textNode('u', [{ type: 'underline' }]),
        textNode('mail', [{ type: 'link', attrs: { href: 'mailto:a@b.c' } }]),
      ),
    );
    expect(validateEditorContent(content)).to.deep.equal([]);
  });

  it('rejects anything that is not a plain object', () => {
    for (const bad of ['text', 42, null, undefined, [paragraph('x')]]) {
      expect(validateEditorContent(bad)).to.deep.equal(['content must be an object']);
    }
  });

  it('rejects a root that is not a doc', () => {
    const problems = validateEditorContent({ type: 'paragraph', content: [] });
    expect(problems).to.include('content root must have type "doc"');
  });

  it('rejects unsupported node types and fields', () => {
    expect(validateEditorContent(doc({ type: 'script', content: [] }))).to.include(
      'content contains an unsupported node type "script"',
    );
    expect(validateEditorContent(doc({ type: 'image', attrs: { src: 'x' } }))).to.include(
      'content contains an unsupported node type "image"',
    );
    expect(validateEditorContent(doc({ type: 'paragraph', onmouseover: 'steal()' }))).to.include(
      'content contains an unsupported field "onmouseover"',
    );
  });

  it('enforces heading levels 1-3', () => {
    expect(
      validateEditorContent(doc({ type: 'heading', attrs: { level: 4 }, content: [] })),
    ).to.include('headings must have a level between 1 and 3');
    expect(validateEditorContent(doc({ type: 'heading', content: [] }))).to.include(
      'headings must have a level between 1 and 3',
    );
    expect(
      validateEditorContent(doc({ type: 'heading', attrs: { level: 2 }, content: [] })),
    ).to.deep.equal([]);
  });

  it('rejects unsupported marks', () => {
    const strike = doc(paragraph('x', [{ type: 'strike' }]));
    expect(validateEditorContent(strike)).to.include(
      'content contains an unsupported mark type "strike"',
    );
  });

  it('limits link protocols to http, https and mailto', () => {
    const link = (href) => doc(paragraph('x', [{ type: 'link', attrs: { href } }]));
    expect(validateEditorContent(link('javascript:alert(1)'))).to.include(
      'links must use http, https or mailto',
    );
    expect(validateEditorContent(link('data:text/html,x'))).to.include(
      'links must use http, https or mailto',
    );
    expect(validateEditorContent(link('/relative/path'))).to.include(
      'links must use http, https or mailto',
    );
    expect(validateEditorContent(link('https://ok.example'))).to.deep.equal([]);
    expect(validateEditorContent(link('http://ok.example'))).to.deep.equal([]);
    expect(validateEditorContent(link('mailto:a@b.c'))).to.deep.equal([]);
  });

  it('rejects marks inside code blocks', () => {
    const content = doc({
      type: 'codeBlock',
      content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }] }],
    });
    expect(validateEditorContent(content)).to.include('code blocks cannot contain marks');
  });

  it('rejects serialized content over 256 KB', () => {
    const huge = doc(paragraph('x'.repeat(256 * 1024 + 1)));
    expect(validateEditorContent(huge)).to.include(
      'content must be at most 256 KB when serialized',
    );
  });

  it('rejects documents nested deeper than 100 levels', () => {
    let node = paragraph('deep');
    for (let i = 0; i < 105; i += 1) node = { type: 'blockquote', content: [node] };
    expect(validateEditorContent(doc(node))).to.include('content is nested too deeply');
  });

  it('extracts plain text with block breaks and no duplicated marks', () => {
    const content = doc(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
      paragraph('Body'),
      paragraph('A'),
      paragraph(),
      paragraph('B'),
    );
    expect(extractPlainText(content)).to.equal('Title\nBody\nA\nB');
    expect(extractPlainText(doc(paragraph('bold', [{ type: 'bold' }])))).to.equal('bold');
    expect(extractPlainText(doc())).to.equal('');
    expect(extractPlainText(doc(paragraph()))).to.equal('');
  });
});

describe('unit: pagination', () => {
  it('never reports zero pages, even for an empty list', () => {
    expect(buildMeta({ page: 1, limit: 20, total: 0 })).to.deep.equal({
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 1,
    });
  });

  it('rounds partial pages up', () => {
    expect(buildMeta({ page: 1, limit: 20, total: 40 }).totalPages).to.equal(2);
    expect(buildMeta({ page: 2, limit: 20, total: 41 }).totalPages).to.equal(3);
  });
});

describe('unit: note schemas', () => {
  describe('createNoteSchema', () => {
    const content = doc(paragraph('hello'));

    it('accepts a minimal note and trims the title', () => {
      const result = createNoteSchema.safeParse({ title: '  Sprint  ', content });
      expect(result.success).to.be.true;
      expect(result.data.title).to.equal('Sprint');
      expect(result.data.isPinned).to.equal(undefined);
    });

    it('accepts optional tags and isPinned', () => {
      const result = createNoteSchema.safeParse({
        title: 'x',
        content,
        tags: ['work'],
        isPinned: false,
      });
      expect(result.success).to.be.true;
      expect(result.data.tags).to.deep.equal(['work']);
      expect(result.data.isPinned).to.equal(false);
    });

    it('rejects boundary titles (0 and 201 characters)', () => {
      expect(createNoteSchema.safeParse({ title: '   ', content }).success).to.be.false;
      expect(createNoteSchema.safeParse({ title: 'a'.repeat(201), content }).success).to.be.false;
      expect(createNoteSchema.safeParse({ title: 'a'.repeat(200), content }).success).to.be.true;
    });

    it('rejects unknown fields, missing content and null content', () => {
      expect(createNoteSchema.safeParse({ title: 'x', content, extra: 1 }).success).to.be.false;
      expect(createNoteSchema.safeParse({ title: 'x' }).success).to.be.false;
      expect(createNoteSchema.safeParse({ title: 'x', content: null }).success).to.be.false;
      expect(createNoteSchema.safeParse({ title: 'x', content: '<p>html</p>' }).success).to.be
        .false;
    });

    it('rejects content with disallowed structure', () => {
      expect(createNoteSchema.safeParse({ title: 'x', content: doc({ type: 'script' }) }).success)
        .to.be.false;
      expect(
        createNoteSchema.safeParse({
          title: 'x',
          content: doc({ type: 'heading', attrs: { level: 9 }, content: [] }),
        }).success,
      ).to.be.false;
      expect(
        createNoteSchema.safeParse({
          title: 'x',
          content: doc(paragraph('x', [{ type: 'link', attrs: { href: 'javascript:1' } }])),
        }).success,
      ).to.be.false;
    });

    it('enforces the tag rules: 10 max, 30 characters, non-empty', () => {
      expect(createNoteSchema.safeParse({ title: 'x', content, tags: Array(11).fill('t') }).success)
        .to.be.false;
      expect(createNoteSchema.safeParse({ title: 'x', content, tags: ['x'.repeat(31)] }).success).to
        .be.false;
      expect(createNoteSchema.safeParse({ title: 'x', content, tags: ['  '] }).success).to.be.false;
      expect(createNoteSchema.safeParse({ title: 'x', content, tags: Array(10).fill('t') }).success)
        .to.be.true;
    });

    it('rejects a non-boolean isPinned', () => {
      expect(createNoteSchema.safeParse({ title: 'x', content, isPinned: 'true' }).success).to.be
        .false;
    });
  });

  describe('updateNoteSchema', () => {
    const content = doc(paragraph('hello'));

    it('requires at least one field', () => {
      expect(updateNoteSchema.safeParse({}).success).to.be.false;
    });

    it('accepts any single field and rejects unknown ones', () => {
      expect(updateNoteSchema.safeParse({ title: 'new' }).success).to.be.true;
      expect(updateNoteSchema.safeParse({ isPinned: true }).success).to.be.true;
      expect(updateNoteSchema.safeParse({ content }).success).to.be.true;
      expect(updateNoteSchema.safeParse({ tags: [] }).success).to.be.true;
      expect(updateNoteSchema.safeParse({ nope: 1 }).success).to.be.false;
      expect(updateNoteSchema.safeParse({ title: 'x', nope: 1 }).success).to.be.false;
    });

    it('validates supplied fields with the same rules as create', () => {
      expect(updateNoteSchema.safeParse({ title: '' }).success).to.be.false;
      expect(updateNoteSchema.safeParse({ content: { type: 'nope' } }).success).to.be.false;
      expect(updateNoteSchema.safeParse({ content: null }).success).to.be.false;
    });
  });

  describe('listQuerySchema', () => {
    it('applies defaults for an empty query', () => {
      const result = listQuerySchema.safeParse({});
      expect(result.success).to.be.true;
      expect(result.data).to.deep.equal({ sort: 'updated_desc', page: 1, limit: 20 });
    });

    it('coerces page and limit from query strings', () => {
      const result = listQuerySchema.safeParse({ page: '3', limit: '10' });
      expect(result.success).to.be.true;
      expect(result.data.page).to.equal(3);
      expect(result.data.limit).to.equal(10);
    });

    it('rejects out-of-range or malformed pagination', () => {
      expect(listQuerySchema.safeParse({ page: '0' }).success).to.be.false;
      expect(listQuerySchema.safeParse({ page: 'abc' }).success).to.be.false;
      expect(listQuerySchema.safeParse({ limit: '51' }).success).to.be.false;
      expect(listQuerySchema.safeParse({ limit: '0' }).success).to.be.false;
    });

    it('coerces pinned to a boolean and rejects other values', () => {
      expect(listQuerySchema.safeParse({ pinned: 'true' }).data.pinned).to.equal(true);
      expect(listQuerySchema.safeParse({ pinned: 'false' }).data.pinned).to.equal(false);
      expect(listQuerySchema.safeParse({ pinned: 'maybe' }).success).to.be.false;
    });

    it('trims q, drops it when empty and caps it at 100 characters', () => {
      expect(listQuerySchema.safeParse({ q: '  hi  ' }).data.q).to.equal('hi');
      expect(listQuerySchema.safeParse({ q: '   ' }).data.q).to.equal(undefined);
      expect(listQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).to.be.false;
    });

    it('only allows relevance together with q', () => {
      expect(listQuerySchema.safeParse({ sort: 'relevance' }).success).to.be.false;
      expect(listQuerySchema.safeParse({ sort: 'relevance', q: 'find me' }).success).to.be.true;
      expect(listQuerySchema.safeParse({ sort: 'bogus' }).success).to.be.false;
    });

    it('rejects unknown query parameters', () => {
      expect(listQuerySchema.safeParse({ foo: '1' }).success).to.be.false;
    });
  });

  describe('noteIdParamSchema', () => {
    it('accepts a uuid and rejects anything else', () => {
      expect(noteIdParamSchema.safeParse({ id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }).success).to
        .be.true;
      expect(noteIdParamSchema.safeParse({ id: 'not-a-uuid' }).success).to.be.false;
      expect(noteIdParamSchema.safeParse({ id: '1' }).success).to.be.false;
    });
  });
});

describe('unit: notes service', () => {
  afterEach(() => sinon.restore());

  describe('list', () => {
    it('maps rows to list items with a 200-character excerpt and no content', async () => {
      const rows = [
        {
          id: 'n1',
          title: 'First',
          contentText: 'x'.repeat(250),
          isPinned: false,
          createdAt: 'c1',
          updatedAt: 'u1',
        },
        {
          id: 'n2',
          title: 'Second',
          contentText: 'short',
          isPinned: true,
          createdAt: 'c2',
          updatedAt: 'u2',
        },
      ];
      sinon.stub(noteRepository, 'list').resolves({ rows, total: 42 });
      sinon.stub(noteRepository, 'findTagsForNotes').resolves(
        new Map([
          ['n1', ['work']],
          ['n2', []],
        ]),
      );

      const { data, meta } = await notesService.list(USER, { page: 1, limit: 20 });

      expect(data[0]).to.deep.equal({
        id: 'n1',
        title: 'First',
        excerpt: 'x'.repeat(200),
        isPinned: false,
        tags: ['work'],
        createdAt: 'c1',
        updatedAt: 'u1',
      });
      expect(data[0]).to.not.have.property('content');
      expect(data[0]).to.not.have.property('contentText');
      expect(data[1].tags).to.deep.equal([]);
      expect(meta).to.deep.equal({ page: 1, limit: 20, total: 42, totalPages: 3 });
      expect(noteRepository.findTagsForNotes.firstCall.args[0]).to.deep.equal(['n1', 'n2']);
    });
  });

  describe('get', () => {
    it('returns the full note with tags', async () => {
      sinon.stub(noteRepository, 'findByIdForUser').resolves({
        id: 'n1',
        title: 'T',
        content: doc(paragraph('body')),
        contentText: 'body',
        isPinned: false,
        createdAt: 'c',
        updatedAt: 'u',
      });
      sinon.stub(noteRepository, 'findTagsForNotes').resolves(new Map([['n1', ['work']]]));

      const note = await notesService.get(USER, 'n1');
      expect(note).to.deep.equal({
        id: 'n1',
        title: 'T',
        content: doc(paragraph('body')),
        isPinned: false,
        tags: ['work'],
        createdAt: 'c',
        updatedAt: 'u',
      });
      expect(note).to.not.have.property('contentText');
    });

    it('throws 404 NOT_FOUND when the note does not exist', async () => {
      sinon.stub(noteRepository, 'findByIdForUser').resolves(null);
      const err = await captureError(notesService.get(USER, 'missing'));
      expect(err).to.be.instanceOf(NotFoundError);
      expect(err.statusCode).to.equal(404);
      expect(err.code).to.equal('NOT_FOUND');
    });
  });

  describe('create', () => {
    let transactionStub;
    let createStub;
    let replaceStub;
    const fakeTrx = { marker: 'fake-trx' };

    beforeEach(() => {
      transactionStub = sinon.stub(knex, 'transaction').callsFake(async (fn) => fn(fakeTrx));
      createStub = sinon.stub(noteRepository, 'create').resolves({
        id: 'new-id',
        title: 'T',
        content: doc(paragraph('derived')),
        contentText: 'derived',
        isPinned: false,
        createdAt: 'c',
        updatedAt: 'u',
      });
      replaceStub = sinon.stub(tagRepository, 'replaceTagsForNote').resolves();
      sinon.stub(noteRepository, 'findTagsForNotes').resolves(new Map([['new-id', ['Work']]]));
    });

    it('derives content_text, defaults isPinned and dedupes tags', async () => {
      const content = doc(
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        paragraph('Body'),
      );
      const note = await notesService.create(USER, {
        title: 'T',
        content,
        tags: ['Work', 'work', 'meetings'],
      });

      expect(transactionStub.calledOnce).to.be.true;
      const [usedUserId, row, usedTrx] = createStub.firstCall.args;
      expect(usedUserId).to.equal(USER);
      expect(usedTrx).to.equal(fakeTrx);
      expect(row).to.deep.equal({
        title: 'T',
        content,
        contentText: 'Title\nBody',
        isPinned: false,
      });
      const [, noteId, tagNames] = replaceStub.firstCall.args;
      expect(noteId).to.equal('new-id');
      expect(tagNames).to.deep.equal(['Work', 'meetings']);
      expect(note.tags).to.deep.equal(['Work']);
    });

    it('skips tag writes entirely when no tags were supplied', async () => {
      await notesService.create(USER, { title: 'T', content: doc(paragraph('x')) });
      expect(replaceStub.called).to.be.false;
      expect(createStub.firstCall.args[1].isPinned).to.equal(false);
    });

    it('passes isPinned through only when explicitly true', async () => {
      await notesService.create(USER, { title: 'T', content: doc(paragraph('x')), isPinned: true });
      expect(createStub.firstCall.args[1].isPinned).to.equal(true);
    });
  });

  describe('update', () => {
    let updateStub;
    let findByIdStub;
    let replaceStub;
    const fakeTrx = { marker: 'fake-trx' };
    const existing = {
      id: 'n1',
      title: 'Old',
      content: doc(paragraph('old')),
      contentText: 'old',
      isPinned: false,
      createdAt: 'c',
      updatedAt: 'u',
    };

    beforeEach(() => {
      sinon.stub(knex, 'transaction').callsFake(async (fn) => fn(fakeTrx));
      updateStub = sinon.stub(noteRepository, 'update').resolves({ ...existing, title: 'New' });
      findByIdStub = sinon.stub(noteRepository, 'findByIdForUser').resolves(existing);
      replaceStub = sinon.stub(tagRepository, 'replaceTagsForNote').resolves();
      sinon.stub(noteRepository, 'findTagsForNotes').resolves(new Map([['n1', ['work']]]));
    });

    it('re-derives content_text when content changes', async () => {
      const content = doc(paragraph('fresh words'));
      await notesService.update(USER, 'n1', { content });

      const [, , row] = updateStub.firstCall.args;
      expect(row).to.deep.equal({ content, content_text: 'fresh words' });
      expect(findByIdStub.called).to.be.false;
      expect(replaceStub.called).to.be.false;
    });

    it('updates title without touching content', async () => {
      await notesService.update(USER, 'n1', { title: 'New' });
      const [, , row] = updateStub.firstCall.args;
      expect(row).to.deep.equal({ title: 'New' });
    });

    it('a tags-only patch skips the notes update but replaces the tag set', async () => {
      await notesService.update(USER, 'n1', { tags: [] });
      expect(updateStub.called).to.be.false;
      expect(findByIdStub.calledWith('n1', USER, fakeTrx)).to.be.true;
      expect(replaceStub.calledWith(USER, 'n1', [], fakeTrx)).to.be.true;
    });

    it('throws 404 when the note update matches no owned row', async () => {
      updateStub.resolves(null);
      const err = await captureError(notesService.update(USER, 'n1', { title: 'New' }));
      expect(err).to.be.instanceOf(NotFoundError);
      expect(err.statusCode).to.equal(404);
    });

    it('throws 404 when a tags-only patch targets a missing note', async () => {
      findByIdStub.resolves(null);
      const err = await captureError(notesService.update(USER, 'n1', { tags: ['x'] }));
      expect(err).to.be.instanceOf(NotFoundError);
      expect(replaceStub.called).to.be.false;
    });
  });

  describe('remove', () => {
    it('resolves when a row was deleted', async () => {
      sinon.stub(noteRepository, 'remove').resolves(true);
      await notesService.remove(USER, 'n1');
    });

    it('throws 404 when nothing was deleted (missing or foreign note)', async () => {
      sinon.stub(noteRepository, 'remove').resolves(false);
      const err = await captureError(notesService.remove(USER, 'n1'));
      expect(err).to.be.instanceOf(NotFoundError);
      expect(err.statusCode).to.equal(404);
    });
  });
});
