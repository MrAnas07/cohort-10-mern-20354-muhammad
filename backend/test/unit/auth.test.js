'use strict';

const { expect } = require('chai');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const sinon = require('sinon');

const env = require('../../src/config/env');
const tokenService = require('../../src/services/token.service');
const authService = require('../../src/services/auth.service');
const authenticate = require('../../src/middleware/authenticate');
const csrfGuard = require('../../src/middleware/csrfGuard');
const { LIMITS } = require('../../src/middleware/rateLimiters');
const userRepository = require('../../src/repositories/user.repository');
const refreshTokenRepository = require('../../src/repositories/refreshToken.repository');
const { registerSchema, loginSchema } = require('../../src/validators/auth.schemas');

const VALID_PASSWORD = 'Str0ngPass1';

function runMiddleware(middleware, req) {
  let outcome = null;
  middleware(req, {}, (err) => {
    outcome = err || 'next';
  });
  return outcome;
}

describe('unit: token service', () => {
  it('access tokens carry only sub/iat/exp/iss — no email or role', () => {
    const token = tokenService.issueAccessToken('user-123');
    const payload = jwt.decode(token);

    expect(payload.sub).to.equal('user-123');
    expect(payload.iss).to.equal(tokenService.ISSUER);
    expect(payload.exp - payload.iat).to.equal(15 * 60);
    expect(payload).to.not.have.property('email');
    expect(payload).to.not.have.property('role');
  });

  it('verifies its own tokens and rejects tampered signatures', () => {
    const token = tokenService.issueAccessToken('user-123');
    expect(tokenService.verifyAccessToken(token).sub).to.equal('user-123');

    const forged = jwt.sign({ sub: 'user-123' }, 'a-different-secret-of-sufficient-length-123', {
      algorithm: 'HS256',
      issuer: tokenService.ISSUER,
      expiresIn: 900,
    });
    expect(() => tokenService.verifyAccessToken(forged)).to.throw();
  });

  it('refresh tokens are opaque 256-bit values stored only as a sha-256 hash', () => {
    const { token, hash, expiresAt } = tokenService.createRefreshToken();

    expect(token).to.be.a('string').and.have.length.at.least(43); // base64url(32 bytes)
    expect(token).to.not.match(/^[0-9a-f]{64}$/); // not pre-hexed, just random
    expect(hash).to.match(/^[0-9a-f]{64}$/);
    expect(hash).to.equal(tokenService.hashRefreshToken(token));
    expect(hash).to.not.include(token);
    expect(expiresAt).to.be.a('date');
    expect(expiresAt.getTime() - Date.now()).to.be.closeTo(7 * 24 * 60 * 60 * 1000, 10000);
  });
});

describe('unit: authenticate middleware', () => {
  it('attaches req.user from a valid access cookie', () => {
    const token = tokenService.issueAccessToken('user-42');
    const req = { cookies: { access_token: token } };

    expect(runMiddleware(authenticate, req)).to.equal('next');
    expect(req.user).to.deep.equal({ id: 'user-42' });
  });

  it('rejects a missing cookie with UNAUTHENTICATED', () => {
    const err = runMiddleware(authenticate, { cookies: {} });
    expect(err.code).to.equal('UNAUTHENTICATED');
    expect(err.statusCode).to.equal(401);
  });

  it('rejects an expired token with TOKEN_EXPIRED so the client can refresh once', () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = jwt.sign(
      { sub: 'user-42', iat: now - 1200, exp: now - 900, iss: tokenService.ISSUER },
      env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256' },
    );

    const err = runMiddleware(authenticate, { cookies: { access_token: expired } });
    expect(err.code).to.equal('TOKEN_EXPIRED');
    expect(err.statusCode).to.equal(401);
  });

  it('rejects a token signed with the wrong secret with UNAUTHENTICATED', () => {
    const forged = jwt.sign({ sub: 'user-42' }, 'not-the-real-secret-value-at-all-123456', {
      algorithm: 'HS256',
      issuer: tokenService.ISSUER,
      expiresIn: 900,
    });

    const err = runMiddleware(authenticate, { cookies: { access_token: forged } });
    expect(err.code).to.equal('UNAUTHENTICATED');
  });
});

describe('unit: csrf guard', () => {
  it('lets non-mutating requests through untouched', () => {
    expect(runMiddleware(csrfGuard, { method: 'GET', headers: {} })).to.equal('next');
    expect(runMiddleware(csrfGuard, { method: 'HEAD', headers: {} })).to.equal('next');
  });

  it('rejects a mutating request without the custom header with 403 CSRF_REJECTED', () => {
    const err = runMiddleware(csrfGuard, { method: 'POST', headers: {} });
    expect(err.code).to.equal('CSRF_REJECTED');
    expect(err.statusCode).to.equal(403);
  });

  it('rejects a wrong header value and accepts notes-app', () => {
    const wrong = runMiddleware(csrfGuard, {
      method: 'POST',
      headers: { 'x-requested-with': 'evil' },
    });
    expect(wrong.code).to.equal('CSRF_REJECTED');

    const right = runMiddleware(csrfGuard, {
      method: 'POST',
      headers: { 'x-requested-with': 'notes-app' },
    });
    expect(right).to.equal('next');
  });
});

describe('unit: auth schemas', () => {
  it('register trims the name, lowercases the email and rejects unknown fields', () => {
    const ok = registerSchema.safeParse({
      fullName: '  Anas User  ',
      email: ' Anas@Example.COM ',
      password: VALID_PASSWORD,
    });
    expect(ok.success).to.equal(true);
    expect(ok.data.fullName).to.equal('Anas User');
    expect(ok.data.email).to.equal('anas@example.com');

    const unknown = registerSchema.safeParse({
      fullName: 'Anas',
      email: 'anas@example.com',
      password: VALID_PASSWORD,
      admin: true,
    });
    expect(unknown.success).to.equal(false);
  });

  it('register enforces the 8-72 character letter+number password rule', () => {
    expect(
      registerSchema.safeParse({ fullName: 'Anas', email: 'a@b.co', password: 'short1' }).success,
    ).to.equal(false);
    expect(
      registerSchema.safeParse({ fullName: 'Anas', email: 'a@b.co', password: 'allletters' })
        .success,
    ).to.equal(false);
    expect(
      registerSchema.safeParse({ fullName: 'Anas', email: 'a@b.co', password: 'Str0ngPass1' })
        .success,
    ).to.equal(true);
  });

  it('login requires both fields but applies no complexity rules', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'whatever' }).success).to.equal(true);
    expect(loginSchema.safeParse({ email: 'a@b.co' }).success).to.equal(false);
    expect(loginSchema.safeParse({ email: 'not-an-email', password: 'x' }).success).to.equal(false);
  });
});

describe('unit: auth service', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('register stores a cost-12 bcrypt hash and returns only the public user', async () => {
    sinon.stub(userRepository, 'findByEmail').resolves(null);
    const create = sinon
      .stub(userRepository, 'create')
      .resolves({ id: 'u1', fullName: 'Anas', email: 'anas@example.com', createdAt: new Date() });

    const { user } = await authService.register({
      fullName: 'Anas',
      email: 'anas@example.com',
      password: VALID_PASSWORD,
    });

    const inserted = create.firstCall.args[0];
    expect(inserted.passwordHash).to.match(/^\$2[aby]\$12\$/);
    expect(inserted.passwordHash).to.not.equal(VALID_PASSWORD);
    expect(bcrypt.compareSync(VALID_PASSWORD, inserted.passwordHash)).to.equal(true);
    expect(user).to.not.have.property('passwordHash');
  });

  it('register rejects a duplicate email with EMAIL_ALREADY_REGISTERED before hashing', async () => {
    sinon
      .stub(userRepository, 'findByEmail')
      .resolves({ id: 'existing', email: 'anas@example.com' });
    const create = sinon.stub(userRepository, 'create');

    try {
      await authService.register({
        fullName: 'Anas',
        email: 'anas@example.com',
        password: VALID_PASSWORD,
      });
      throw new Error('expected register to throw');
    } catch (err) {
      expect(err.statusCode).to.equal(409);
      expect(err.code).to.equal('EMAIL_ALREADY_REGISTERED');
    }
    expect(create.called).to.equal(false);
  });

  it('login answers INVALID_CREDENTIALS with an identical message for unknown email and wrong password', async () => {
    const findByEmail = sinon.stub(userRepository, 'findByEmail');
    sinon.stub(refreshTokenRepository, 'create').resolves({});

    findByEmail.onFirstCall().resolves(null); // unknown email
    findByEmail.onSecondCall().resolves({
      id: 'u1',
      fullName: 'Anas',
      email: 'anas@example.com',
      passwordHash: bcrypt.hashSync('RightPass1', 4),
    });

    let unknownError;
    try {
      await authService.login({ email: 'ghost@example.com', password: VALID_PASSWORD });
    } catch (err) {
      unknownError = err;
    }

    let wrongError;
    try {
      await authService.login({ email: 'anas@example.com', password: VALID_PASSWORD });
    } catch (err) {
      wrongError = err;
    }

    expect(unknownError.code).to.equal('INVALID_CREDENTIALS');
    expect(wrongError.code).to.equal('INVALID_CREDENTIALS');
    expect(unknownError.message).to.equal(wrongError.message);
  });

  it('login returns a session with tokens and no password hash', async () => {
    sinon.stub(userRepository, 'findByEmail').resolves({
      id: 'u1',
      fullName: 'Anas',
      email: 'anas@example.com',
      passwordHash: bcrypt.hashSync(VALID_PASSWORD, 4),
    });
    const create = sinon.stub(refreshTokenRepository, 'create').resolves({});

    const { user, session } = await authService.login({
      email: 'anas@example.com',
      password: VALID_PASSWORD,
    });

    expect(session.accessToken.split('.')).to.have.length(3); // JWT
    expect(session.refreshToken).to.be.a('string');
    expect(session.refreshExpiresAt).to.be.a('date');
    expect(create.firstCall.args[0].tokenHash).to.match(/^[0-9a-f]{64}$/);
    expect(user).to.not.have.property('passwordHash');
    expect(session).to.not.have.property('passwordHash');
  });

  it('refresh rotates: revokes the old hash and issues a new session', async () => {
    sinon.stub(refreshTokenRepository, 'findByHash').resolves({
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: null,
    });
    sinon
      .stub(userRepository, 'findById')
      .resolves({ id: 'u1', fullName: 'Anas', email: 'anas@example.com', createdAt: new Date() });
    const revoke = sinon.stub(refreshTokenRepository, 'revoke').resolves();
    const create = sinon.stub(refreshTokenRepository, 'create').resolves({});

    const { user, session } = await authService.refresh('presented-refresh-token');

    expect(revoke.calledWith(tokenService.hashRefreshToken('presented-refresh-token'))).to.equal(
      true,
    );
    expect(create.called).to.equal(true);
    expect(user.id).to.equal('u1');
    expect(session.refreshToken).to.be.a('string');
  });

  it('refresh reuse of a revoked token revokes the whole family', async () => {
    sinon.stub(refreshTokenRepository, 'findByHash').resolves({
      id: 't1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 1000),
      revokedAt: new Date(), // already revoked — the theft signal
    });
    const revokeAll = sinon.stub(refreshTokenRepository, 'revokeAllForUser').resolves();

    try {
      await authService.refresh('revoked-refresh-token');
      throw new Error('expected refresh to throw');
    } catch (err) {
      expect(err.statusCode).to.equal(401);
      expect(err.code).to.equal('UNAUTHENTICATED');
    }
    expect(revokeAll.calledWith('u1')).to.equal(true);
  });

  it('logout revokes the presented token and stays silent without one', async () => {
    const revoke = sinon.stub(refreshTokenRepository, 'revoke').resolves();

    await authService.logout('u1', 'presented-refresh-token');
    expect(revoke.calledWith(tokenService.hashRefreshToken('presented-refresh-token'))).to.equal(
      true,
    );

    await authService.logout('u1', undefined); // idempotent path: nothing presented
    expect(revoke.calledOnce).to.equal(true);
  });

  it('getMe returns the public user or 401 when the account is gone', async () => {
    const findById = sinon.stub(userRepository, 'findById');

    findById.resolves({
      id: 'u1',
      fullName: 'Anas',
      email: 'anas@example.com',
      createdAt: new Date(),
    });
    const { user } = await authService.getMe('u1');
    expect(user).to.deep.equal({
      id: 'u1',
      fullName: 'Anas',
      email: 'anas@example.com',
      createdAt: user.createdAt,
    });

    findById.resolves(null);
    try {
      await authService.getMe('u1');
      throw new Error('expected getMe to throw');
    } catch (err) {
      expect(err.code).to.equal('UNAUTHENTICATED');
    }
  });
});

describe('unit: rate limiter configuration (architecture 6.7)', () => {
  it('matches the documented starting limits', () => {
    expect(LIMITS.global).to.deep.equal({ limit: 100, windowMs: 15 * 60 * 1000 });
    expect(LIMITS.register).to.deep.equal({ limit: 5, windowMs: 60 * 60 * 1000 });
    expect(LIMITS.login).to.deep.equal({ limit: 10, windowMs: 15 * 60 * 1000 });
    expect(LIMITS.refresh).to.deep.equal({ limit: 30, windowMs: 15 * 60 * 1000 });
  });
});
