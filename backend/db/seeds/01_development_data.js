'use strict';

/**
 * Development-only sample data — docs/architecture.md §11 (db/seeds).
 * Never run via a production script; `npm run seed` targets development.
 * Fixed UUIDs keep re-seeding idempotent (children are deleted first).
 */
exports.seed = async function seed(knex) {
  // Safety guard: this seed deletes every row first. Only ever allow it
  // against a development database, no matter how the CLI was invoked.
  if (process.env.NODE_ENV !== 'development') {
    throw new Error(
      `Refusing to seed: NODE_ENV must be "development" (got "${process.env.NODE_ENV || 'unset'}"); no tables were touched.`,
    );
  }

  await knex('note_tags').del();
  await knex('notes').del();
  await knex('tags').del();
  await knex('users').del();

  await knex('users').insert([
    {
      id: '11111111-1111-4111-8111-111111111111',
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      // Placeholder until Phase 05 seeds real bcrypt hashes (dev only).
      password_hash: 'dev_only_placeholder_not_a_real_hash',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      full_name: 'Alan Turing',
      email: 'alan@example.com',
      password_hash: 'dev_only_placeholder_not_a_real_hash',
    },
  ]);

  await knex('notes').insert([
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      user_id: '11111111-1111-4111-8111-111111111111',
      title: 'Welcome to Notes',
      content: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'This is a seeded development note.' }],
          },
        ],
      }),
      content_text: 'This is a seeded development note.',
      is_pinned: true,
    },
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      user_id: '11111111-1111-4111-8111-111111111111',
      title: 'Shopping list',
      content: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Milk, eggs, coffee.' }] }],
      }),
      content_text: 'Milk, eggs, coffee.',
      is_pinned: false,
    },
    {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      user_id: '22222222-2222-4222-8222-222222222222',
      title: 'Computing notes',
      content: JSON.stringify({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Machines think, but do they?' }] },
        ],
      }),
      content_text: 'Machines think, but do they?',
      is_pinned: false,
    },
  ]);

  await knex('tags').insert([
    {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      user_id: '11111111-1111-4111-8111-111111111111',
      name: 'personal',
    },
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      user_id: '22222222-2222-4222-8222-222222222222',
      name: 'work',
    },
  ]);

  await knex('note_tags').insert([
    {
      note_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      tag_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    },
    {
      note_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      tag_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    },
  ]);
};
