'use strict';

const { expect } = require('chai');

const { knex, resolveConnectionUrl, pingDatabase } = require('../../../src/config/db');
const knexfile = require('../../../knexfile');
const repositories = require('../../../src/repositories');

describe('unit: database config', () => {
  after(async () => {
    // Release the pool so the mocha process can exit even when a real
    // database accepted the health ping in the integration tests.
    await knex.destroy();
  });

  it('exports a reusable knex instance wired to pg', () => {
    expect(typeof knex).to.equal('function'); // knex instances are callable
    expect(typeof knex.raw).to.equal('function');
    expect(knex.client.config.client).to.equal('pg');
  });

  it('repositories share the same knex instance', () => {
    expect(repositories.knex).to.equal(knex);
  });

  it('resolves TEST_DATABASE_URL for tests and DATABASE_URL elsewhere', () => {
    expect(resolveConnectionUrl()).to.equal(process.env.TEST_DATABASE_URL);
    expect(resolveConnectionUrl('test')).to.equal(process.env.TEST_DATABASE_URL);
    expect(resolveConnectionUrl('development')).to.equal(process.env.DATABASE_URL);
    expect(resolveConnectionUrl('production')).to.equal(process.env.DATABASE_URL);
  });

  it('knexfile provides development, test and production configs', () => {
    for (const name of ['development', 'test', 'production']) {
      expect(knexfile[name], name).to.be.an('object');
      expect(knexfile[name].client, name).to.equal('pg');
      expect(knexfile[name].migrations.directory, name).to.equal('./db/migrations');
      expect(knexfile[name].seeds.directory, name).to.equal('./db/seeds');
    }
    expect(knexfile.development.connection).to.equal(process.env.DATABASE_URL);
    expect(knexfile.test.connection).to.equal(process.env.TEST_DATABASE_URL);
  });

  it('pingDatabase never throws and reports up or down', async () => {
    const state = await pingDatabase();
    expect(state).to.be.oneOf(['up', 'down']);
  });
});
