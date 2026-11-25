'use strict';

const { expect } = require('chai');
const request = require('supertest');
const sinon = require('sinon');

const app = require('../../src/app');
const db = require('../../src/config/db');

describe('integration: GET /api/v1/health', () => {
  it('returns 200 with the standard success envelope', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);

    expect(res.body.success).to.equal(true);
    expect(res.body.data.status).to.equal('ok');
    expect(res.body.data.uptime).to.be.a('number').and.to.be.greaterThan(0);
  });

  it('sets an X-Request-Id response header', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);

    expect(res.headers['x-request-id']).to.be.a('string').and.not.equal('');
  });

  it('reports database connectivity without failing the endpoint', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);

    // 'up' or 'down' depending on whether a database is reachable locally;
    // either way the endpoint answers instead of crashing.
    expect(res.body.data).to.have.property('database').that.is.oneOf(['up', 'down']);
  });

  it('stays healthy when the database is down (controlled failure)', async () => {
    const stub = sinon.stub(db, 'pingDatabase').resolves('down');

    try {
      const res = await request(app).get('/api/v1/health').expect(200);

      expect(res.body.success).to.equal(true);
      expect(res.body.data.status).to.equal('ok');
      expect(res.body.data.database).to.equal('down');
    } finally {
      stub.restore();
    }
  });
});
