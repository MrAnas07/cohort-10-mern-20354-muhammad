'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');

const migrationsDir = path.join(__dirname, '..', '..', '..', 'db', 'migrations');
const files = fs.readdirSync(migrationsDir).filter((file) => file.endsWith('.js'));

describe('unit: db migrations', () => {
  it('ships migrations for every core table plus the updated_at trigger', () => {
    expect(files).to.include.members([
      '20261121100001_create_users.js',
      '20261121100002_create_notes.js',
      '20261121100003_create_tags.js',
      '20261121100004_create_note_tags.js',
      '20261121100005_create_refresh_tokens.js',
      '20261121100006_create_updated_at_trigger.js',
    ]);
  });

  it('every migration exports up and down functions', () => {
    for (const file of files) {
      const migration = require(path.join(migrationsDir, file));
      expect(migration.up, `${file} up`).to.be.a('function');
      expect(migration.down, `${file} down`).to.be.a('function');
    }
  });

  it('filenames carry unique timestamps that sort chronologically', () => {
    expect(files.length).to.be.greaterThan(0);
    const stamps = files.map((file) => Number(file.slice(0, 14)));
    expect(stamps.every(Number.isInteger), 'numeric prefixes').to.equal(true);
    expect(new Set(stamps).size, 'unique timestamps').to.equal(stamps.length);

    const byName = [...files].sort();
    const byStamp = [...files].sort((a, b) => Number(a.slice(0, 14)) - Number(b.slice(0, 14)));
    expect(byName, 'name order matches timestamp order').to.deep.equal(byStamp);
  });
});
