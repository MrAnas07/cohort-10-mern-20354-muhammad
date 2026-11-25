'use strict';

const { expect } = require('chai');
const { execFile } = require('node:child_process');
const path = require('node:path');
const sinon = require('sinon');

const { knex, resolveConnectionUrl, pingDatabase } = require('../../../src/config/db');
const knexfile = require('../../../knexfile');
const repositories = require('../../../src/repositories');

const backendRoot = path.resolve(__dirname, '../../..');

// Runs a snippet in a fresh Node process so each scenario gets its own
// environment: the in-process env was already validated by the mocha setup
// helper, so a missing TEST_DATABASE_URL can only be simulated in a child.
function runInFreshEnv(code, envOverrides) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return new Promise((resolve) => {
    execFile(process.execPath, ['-e', code], { cwd: backendRoot, env }, (error, stdout, stderr) => {
      resolve({ exitCode: error ? Number(error.code) || 1 : 0, stdout, stderr });
    });
  });
}

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

  it('keeps working for non-test environments without TEST_DATABASE_URL', async () => {
    const { exitCode, stdout } = await runInFreshEnv(
      "const cfg = require('./knexfile'); if (cfg.development.client !== 'pg') process.exit(2); console.log('DEV_OK');",
      { NODE_ENV: 'development', TEST_DATABASE_URL: undefined },
    );
    expect(exitCode, stdout).to.equal(0);
    expect(stdout).to.include('DEV_OK');
  });

  it('fails fast when the test config is selected without TEST_DATABASE_URL', async () => {
    const { stdout } = await runInFreshEnv(
      "const cfg = require('./knexfile'); try { void cfg.test; console.log('NO_THROW'); } catch (err) { console.log('THREW: ' + err.message); }",
      { NODE_ENV: 'development', TEST_DATABASE_URL: undefined },
    );
    expect(stdout).to.include('THREW: TEST_DATABASE_URL is required');
    expect(stdout).to.not.include('NO_THROW');
  });

  it('fails fast when NODE_ENV is test without TEST_DATABASE_URL', async () => {
    const { stdout } = await runInFreshEnv(
      "try { require('./knexfile'); console.log('LOADED'); } catch (err) { console.log('THREW: ' + err.message); }",
      { NODE_ENV: 'test', TEST_DATABASE_URL: undefined },
    );
    expect(stdout).to.include('THREW:');
    expect(stdout).to.include('TEST_DATABASE_URL');
    expect(stdout).to.not.include('LOADED');
  });

  it('pingDatabase never throws and reports up or down', async () => {
    const state = await pingDatabase();
    expect(state).to.be.oneOf(['up', 'down']);
  });

  it('pingDatabase answers down within the hard deadline when the query hangs', async () => {
    const clock = sinon.useFakeTimers();
    // Simulate a database that accepts the connection but never responds:
    // the probe promise never settles on its own.
    const rawStub = sinon.stub(knex, 'raw').returns(new Promise(() => {}));
    let settled = false;
    try {
      const probe = pingDatabase().then((state) => {
        settled = true;
        return state;
      });

      await clock.tickAsync(2999);
      expect(settled, 'must not answer before the 3s floor').to.equal(false);

      await clock.tickAsync(2001); // 5s total: past any allowed deadline
      expect(await probe).to.equal('down');
      expect(settled).to.equal(true);
    } finally {
      rawStub.restore();
      clock.restore();
    }
  });
});
