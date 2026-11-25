'use strict';

const { expect } = require('chai');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('node:path');

const app = require('../../src/app');
const env = require('../../src/config/env');
const { knex } = require('../../src/config/db');
const userRepository = require('../../src/repositories/user.repository');
const tokenService = require('../../src/services/token.service');

const API = '/api/v1/auth';
const CSRF = { 'X-Requested-With': 'notes-app' };
const VALID_PASSWORD = 'Str0ngPass1';

// Every email flows through here so afterEach can remove exactly what a test
// created — the suite may share its database with dev seed data.
const createdEmails = [];
let sequence = 0;

function uniqueEmail() {
  sequence += 1;
  const email = `auth-test-${Date.now()}-${sequence}@example.com`;
  createdEmails.push(email);
  return email;
}

function cookieMap(setCookieHeaders) {
  const map = {};
  for (const header of setCookieHeaders || []) {
    const [pair] = header.split(';');
    const idx = pair.indexOf('=');
    map[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
  }
  return map;
}

// Fixture user created straight through the repository: these tests exercise
// login/refresh/logout, not register, so they must not consume the register
// rate-limit budget. The fixture hashes at bcrypt cost 4 to stay fast — the
// production path (cost 12) is asserted by the register tests.
async function createUser() {
  const email = uniqueEmail();
  const passwordHash = bcrypt.hashSync(VALID_PASSWORD, 4);
  const user = await userRepository.create({ fullName: 'Auth Fixture', email, passwordHash });
  return { email, user };
}

async function login(email, password) {
  const res = await request(app).post(`${API}/login`).set(CSRF).send({ email, password });
  return { res, cookies: cookieMap(res.headers['set-cookie']) };
}

async function loginOk(email) {
  const { res, cookies } = await login(email, VALID_PASSWORD);
  expect(res.status, JSON.stringify(res.body)).to.equal(200);
  return cookies;
}

describe('integration: authentication', function () {
  // Supabase-backed runs need more headroom than the default 5s.
  this.timeout(15000);

  before(async () => {
    // Self-contained: applies any missing versioned migrations (a no-op when
    // the test database is already migrated). The shared knex instance is
    // built without knexfile's options, so the directory is passed explicitly.
    await knex.migrate.latest({
      directory: path.resolve(__dirname, '../../db/migrations'),
    });
  });

  afterEach(async () => {
    while (createdEmails.length > 0) {
      const emails = createdEmails.splice(0);
      await knex('users').whereIn('email', emails).delete();
    }
  });

  describe('POST /auth/register', () => {
    it('creates the user, normalises input and never returns the password', async () => {
      const email = uniqueEmail();
      const res = await request(app)
        .post(`${API}/register`)
        .set(CSRF)
        .send({ fullName: '  Anas User  ', email: email.toUpperCase(), password: VALID_PASSWORD })
        .expect(201);

      expect(res.body.success).to.equal(true);
      const user = res.body.data.user;
      expect(user.id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      expect(user.fullName).to.equal('Anas User');
      expect(user.email).to.equal(email); // lowercased
      expect(user.createdAt).to.be.a('string');
      expect(user).to.not.have.property('password');
      expect(user).to.not.have.property('passwordHash');

      const raw = JSON.stringify(res.body);
      expect(raw).to.not.include(VALID_PASSWORD);
      expect(raw).to.not.include('$2'); // bcrypt hash prefix
      // Registration does not log the user in (5.3 #1).
      expect(res.headers['set-cookie']).to.equal(undefined);

      // The stored password really is a cost-12 bcrypt hash, not plaintext.
      const row = await knex('users').where('email', email).first();
      expect(row.password_hash).to.match(/^\$2[aby]\$12\$/);
      expect(row.password_hash).to.not.include(VALID_PASSWORD);
    });

    it('rejects a duplicate email with 409 EMAIL_ALREADY_REGISTERED (case-insensitive)', async () => {
      const email = uniqueEmail();
      await request(app)
        .post(`${API}/register`)
        .set(CSRF)
        .send({ fullName: 'First User', email, password: VALID_PASSWORD })
        .expect(201);

      const res = await request(app)
        .post(`${API}/register`)
        .set(CSRF)
        .send({ fullName: 'Second User', email: email.toUpperCase(), password: VALID_PASSWORD })
        .expect(409);

      expect(res.body.error.code).to.equal('EMAIL_ALREADY_REGISTERED');
    });

    it('rejects a weak password with 400 VALIDATION_ERROR naming the field', async () => {
      const res = await request(app)
        .post(`${API}/register`)
        .set(CSRF)
        .send({ fullName: 'Weak Password', email: uniqueEmail(), password: 'abcdefgh' })
        .expect(400);

      expect(res.body.error.code).to.equal('VALIDATION_ERROR');
      expect(res.body.error.details).to.be.an('array');
      expect(res.body.error.details.some((d) => d.field === 'password')).to.equal(true);
    });

    it('rejects unknown fields (strict schema)', async () => {
      const res = await request(app)
        .post(`${API}/register`)
        .set(CSRF)
        .send({
          fullName: 'Sneaky User',
          email: uniqueEmail(),
          password: VALID_PASSWORD,
          admin: true,
        })
        .expect(400);

      expect(res.body.error.code).to.equal('VALIDATION_ERROR');
    });
  });

  describe('POST /auth/login', () => {
    it('sets two httpOnly cookies and returns no token in the body', async () => {
      const { email } = await createUser();
      const { res, cookies } = await login(email, VALID_PASSWORD);

      expect(res.status).to.equal(200);
      expect(res.body.success).to.equal(true);
      expect(res.body.data.user.email).to.equal(email);

      const setCookie = res.headers['set-cookie'].join(' ');
      expect(res.headers['set-cookie']).to.have.length(2);
      expect(setCookie).to.include('access_token=');
      expect(setCookie).to.include('refresh_token=');
      expect(setCookie).to.match(/HttpOnly/);
      expect(setCookie).to.include('Path=/api/v1;');
      expect(setCookie).to.include('Path=/api/v1/auth');
      expect(setCookie).to.include('SameSite=Lax');
      expect(setCookie).to.not.include('Secure'); // production-only flag (6.3)

      const raw = JSON.stringify(res.body);
      expect(raw).to.not.include('eyJ'); // JWTs start with eyJ
      expect(raw).to.not.include(cookies.refresh_token);
      expect(raw).to.not.include(VALID_PASSWORD);
    });

    it('returns 401 INVALID_CREDENTIALS with the same message for a wrong password and an unknown email', async () => {
      const { email } = await createUser();

      const wrongPassword = await login(email, 'WrongPass1');
      expect(wrongPassword.res.status).to.equal(401);
      expect(wrongPassword.res.body.error.code).to.equal('INVALID_CREDENTIALS');
      expect(wrongPassword.res.headers['set-cookie']).to.equal(undefined);

      const unknownEmail = await login('ghost-no-such-user@example.com', 'WrongPass1');
      expect(unknownEmail.res.status).to.equal(401);
      expect(unknownEmail.res.body.error.code).to.equal('INVALID_CREDENTIALS');

      // Identical message: the response must not reveal which half was wrong.
      expect(unknownEmail.res.body.error.message).to.equal(wrongPassword.res.body.error.message);
      expect(unknownEmail.res.headers['set-cookie']).to.equal(undefined);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 401 UNAUTHENTICATED without a cookie', async () => {
      const res = await request(app).get(`${API}/me`).expect(401);
      expect(res.body.error.code).to.equal('UNAUTHENTICATED');
    });

    it('returns 401 TOKEN_EXPIRED for an expired access token', async () => {
      const { user } = await createUser();
      const now = Math.floor(Date.now() / 1000);
      const expired = jwt.sign(
        { sub: user.id, iat: now - 1200, exp: now - 900, iss: tokenService.ISSUER },
        env.JWT_ACCESS_SECRET,
        { algorithm: 'HS256' },
      );

      const res = await request(app)
        .get(`${API}/me`)
        .set('Cookie', `access_token=${expired}`)
        .expect(401);

      expect(res.body.error.code).to.equal('TOKEN_EXPIRED');
    });

    it('returns the current user for a valid session', async () => {
      const { email, user } = await createUser();
      const cookies = await loginOk(email);

      const res = await request(app)
        .get(`${API}/me`)
        .set('Cookie', `access_token=${cookies.access_token}`)
        .expect(200);

      expect(res.body.data.user.id).to.equal(user.id);
      expect(res.body.data.user.email).to.equal(email);
      expect(res.body.data.user).to.not.have.property('passwordHash');
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh token: new cookie works, old one is rejected', async () => {
      const { email } = await createUser();
      const cookies = await loginOk(email);

      const first = await request(app)
        .post(`${API}/refresh`)
        .set(CSRF)
        .set('Cookie', `refresh_token=${cookies.refresh_token}`)
        .expect(200);

      const rotated = cookieMap(first.headers['set-cookie']).refresh_token;
      expect(rotated).to.be.a('string').and.not.equal(cookies.refresh_token);

      // The rotated token opens sessions while the family is intact.
      const again = await request(app)
        .post(`${API}/refresh`)
        .set(CSRF)
        .set('Cookie', `refresh_token=${rotated}`)
        .expect(200);
      expect(again.body.data.user.email).to.equal(email);

      // The presented token was revoked: replaying it fails with 401 (and,
      // per 6.2, revokes the whole family — proven by the next test).
      const replay = await request(app)
        .post(`${API}/refresh`)
        .set(CSRF)
        .set('Cookie', `refresh_token=${cookies.refresh_token}`)
        .expect(401);
      expect(replay.body.error.code).to.equal('UNAUTHENTICATED');
    });

    it('revokes the whole family when a revoked token is presented again (reuse detection)', async () => {
      const { email } = await createUser();
      const sessionA = await loginOk(email);
      const sessionB = await loginOk(email); // second device for the same user

      // Rotate session A — this revokes token A.
      await request(app)
        .post(`${API}/refresh`)
        .set(CSRF)
        .set('Cookie', `refresh_token=${sessionA.refresh_token}`)
        .expect(200);

      // Presenting the already-revoked token A is the theft signal.
      const reuse = await request(app)
        .post(`${API}/refresh`)
        .set(CSRF)
        .set('Cookie', `refresh_token=${sessionA.refresh_token}`)
        .expect(401);
      expect(reuse.body.error.code).to.equal('UNAUTHENTICATED');

      // Session B was never used — it must be dead too (family revocation).
      const afterFamilyRevocation = await request(app)
        .post(`${API}/refresh`)
        .set(CSRF)
        .set('Cookie', `refresh_token=${sessionB.refresh_token}`)
        .expect(401);
      expect(afterFamilyRevocation.body.error.code).to.equal('UNAUTHENTICATED');
    });

    it('returns 401 and clears both cookies when the refresh cookie is missing', async () => {
      const res = await request(app).post(`${API}/refresh`).set(CSRF).expect(401);

      expect(res.body.error.code).to.equal('UNAUTHENTICATED');
      const setCookie = (res.headers['set-cookie'] || []).join(' ');
      expect(setCookie).to.include('access_token=;');
      expect(setCookie).to.include('refresh_token=;');
    });
  });

  describe('POST /auth/logout', () => {
    it('revokes the refresh token, clears cookies and is idempotent (204)', async () => {
      const { email } = await createUser();
      const cookies = await loginOk(email);

      const out = await request(app)
        .post(`${API}/logout`)
        .set(CSRF)
        .set(
          'Cookie',
          `access_token=${cookies.access_token}; refresh_token=${cookies.refresh_token}`,
        )
        .expect(204);
      expect(out.text).to.equal('');

      const cleared = (out.headers['set-cookie'] || []).join(' ');
      expect(cleared).to.include('access_token=;');
      expect(cleared).to.include('refresh_token=;');

      // The revoked refresh token can no longer open a session.
      await request(app)
        .post(`${API}/refresh`)
        .set(CSRF)
        .set('Cookie', `refresh_token=${cookies.refresh_token}`)
        .expect(401);

      // Calling logout again with the same (already revoked) cookies is a
      // no-op that still answers 204.
      const again = await request(app)
        .post(`${API}/logout`)
        .set(CSRF)
        .set(
          'Cookie',
          `access_token=${cookies.access_token}; refresh_token=${cookies.refresh_token}`,
        )
        .expect(204);
      expect(again.text).to.equal('');
    });

    it('returns 401 UNAUTHENTICATED without an access token', async () => {
      const res = await request(app).post(`${API}/logout`).set(CSRF).expect(401);
      expect(res.body.error.code).to.equal('UNAUTHENTICATED');
    });
  });

  describe('CSRF guard', () => {
    it('rejects a mutating request without X-Requested-With with 403 CSRF_REJECTED', async () => {
      const res = await request(app)
        .post(`${API}/login`)
        .send({ email: 'anyone@example.com', password: VALID_PASSWORD })
        .expect(403);

      expect(res.body.error.code).to.equal('CSRF_REJECTED');
    });
  });

  // Kept last: both tests drive their limiter to the breaking point and must
  // not interfere with the flows above.
  describe('rate limits (architecture 6.7)', () => {
    it('register answers 429 RATE_LIMITED once the hourly budget is spent', async () => {
      let res;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        res = await request(app)
          .post(`${API}/register`)
          .set(CSRF)
          .send({ fullName: 'Rate Limited', email: uniqueEmail(), password: 'weak' });
        if (res.status === 429) break;
      }

      expect(res.status).to.equal(429);
      expect(res.body.error.code).to.equal('RATE_LIMITED');
    });

    it('login answers 429 RATE_LIMITED once the 15-minute budget is spent', async () => {
      let res;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        res = await request(app)
          .post(`${API}/login`)
          .set(CSRF)
          .send({ email: 'nobody@example.com' }); // invalid body: cheap, still counted
        if (res.status === 429) break;
      }

      expect(res.status).to.equal(429);
      expect(res.body.error.code).to.equal('RATE_LIMITED');
    });
  });
});
