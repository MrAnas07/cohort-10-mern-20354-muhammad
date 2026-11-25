'use strict';

const { expect } = require('chai');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const app = require('../../src/app');
const { knex } = require('../../src/config/db');
const userRepository = require('../../src/repositories/user.repository');
const tokenService = require('../../src/services/token.service');

const API = '/api/v1/tags';
const CSRF = { 'X-Requested-With': 'notes-app' };

const createdUserIds = [];
let sequence = 0;

async function createUser() {
  sequence += 1;
  const user = await userRepository.create({
    fullName: `Tags Tester ${sequence}`,
    email: `tags-test-${Date.now()}-${sequence}@example.com`,
    passwordHash: bcrypt.hashSync('Str0ngPass1', 4),
  });
  createdUserIds.push(user.id);
  return { id: user.id, token: tokenService.issueAccessToken(user.id) };
}

function authHeader(user) {
  return { Cookie: `access_token=${user.token}` };
}

function textNode(text) {
  return { type: 'text', text };
}

async function createNote(user, { title, tags }) {
  const res = await request(app)
    .post('/api/v1/notes')
    .set(authHeader(user))
    .set(CSRF)
    .send({
      title,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [textNode(title)] }] },
      ...(tags ? { tags } : {}),
    })
    .expect(201);
  return res.body.data.note;
}

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await knex('users').whereIn('id', createdUserIds).del();
    createdUserIds.length = 0;
  }
});

// Same Supabase headroom as the auth suite: every request here costs several
// round trips to a remote test database.
describe('integration: GET /tags', function () {
  this.timeout(30000);

  it('requires a token', async () => {
    const res = await request(app).get(API).expect(401);
    expect(res.body.error.code).to.equal('UNAUTHENTICATED');
  });

  it('returns in-use tags with counts, sorted by name (5.3 #11)', async () => {
    const user = await createUser();
    await createNote(user, { title: 'one', tags: ['work', 'meetings'] });
    await createNote(user, { title: 'two', tags: ['work'] });
    await createNote(user, { title: 'three', tags: ['Zebra'] });

    const res = await request(app).get(API).set(authHeader(user)).expect(200);
    expect(res.body.success).to.be.true;
    expect(res.body.data).to.deep.equal([
      { name: 'meetings', noteCount: 1 },
      { name: 'work', noteCount: 2 },
      { name: 'Zebra', noteCount: 1 },
    ]);
    expect(res.body.data[0]).to.have.all.keys('name', 'noteCount');
  });

  it('excludes tags that are not attached to any note', async () => {
    const user = await createUser();
    await createNote(user, { title: 'linked', tags: ['used'] });
    // A tag row with no note_tags link: created directly, never attached.
    await knex('tags').insert({ user_id: user.id, name: 'orphan' });

    const res = await request(app).get(API).set(authHeader(user)).expect(200);
    expect(res.body.data.map((tag) => tag.name)).to.deep.equal(['used']);
  });

  it("never lists another user's tags", async () => {
    const alice = await createUser();
    const bob = await createUser();
    await createNote(alice, { title: 'alice note', tags: ['alice-tag'] });
    await createNote(bob, { title: 'bob note', tags: ['bob-tag'] });

    const res = await request(app).get(API).set(authHeader(alice)).expect(200);
    expect(res.body.data.map((tag) => tag.name)).to.deep.equal(['alice-tag']);
  });

  it('returns an empty array when the user has no attached tags', async () => {
    const user = await createUser();
    const res = await request(app).get(API).set(authHeader(user)).expect(200);
    expect(res.body.data).to.deep.equal([]);
  });
});
