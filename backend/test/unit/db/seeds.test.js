'use strict';

const { expect } = require('chai');

const seed = require('../../../db/seeds/01_development_data').seed;

describe('unit: development seed', () => {
  it('refuses to run outside development before touching any table', async () => {
    // Mocha runs with NODE_ENV=test, so the guard must reject here.
    expect(process.env.NODE_ENV).to.equal('test');

    let knexCalled = false;
    const fakeKnex = () => {
      knexCalled = true;
      throw new Error('no table may be touched');
    };

    let error = null;
    try {
      await seed(fakeKnex);
    } catch (err) {
      error = err;
    }

    expect(error, 'seed must reject').to.be.an('error');
    expect(error.message).to.include('NODE_ENV');
    expect(error.message).to.include('development');
    expect(knexCalled, 'knex must never be invoked').to.equal(false);
  });
});
