'use strict';

const asyncHandler = require('../utils/asyncHandler');
const authService = require('../services/auth.service');
const tokenService = require('../services/token.service');

// Thin controllers (architecture 3.7): translate HTTP to service calls and
// back, nothing else. Tokens travel exclusively in httpOnly cookies — the
// response body only ever carries the public user shape.
const authController = {
  // 5.3 #1 — 201, no cookies: registration does not log anyone in.
  register: asyncHandler(async (req, res) => {
    const { user } = await authService.register(req.body);
    res.status(201).json({ success: true, data: { user } });
  }),

  // 5.3 #2 — 200 with both cookies set, no token in the body.
  login: asyncHandler(async (req, res) => {
    const { user, session } = await authService.login(req.body);
    tokenService.setAuthCookies(res, session);
    res.status(200).json({ success: true, data: { user } });
  }),

  // 5.3 #3 — 200 with rotated cookies. A rejected refresh (401) clears both
  // cookies so the browser stops presenting a dead token.
  refresh: asyncHandler(async (req, res) => {
    try {
      const { user, session } = await authService.refresh(req.cookies.refresh_token);
      tokenService.setAuthCookies(res, session);
      res.status(200).json({ success: true, data: { user } });
    } catch (err) {
      if (err && err.statusCode === 401) {
        tokenService.clearAuthCookies(res);
      }
      throw err;
    }
  }),

  // 5.3 #4 — 204, idempotent: revoke what was presented, always clear cookies.
  logout: asyncHandler(async (req, res) => {
    await authService.logout(req.user.id, req.cookies.refresh_token);
    tokenService.clearAuthCookies(res);
    res.status(204).end();
  }),

  // 5.3 #5 — 200 with the current user row (authenticate already ran).
  me: asyncHandler(async (req, res) => {
    const { user } = await authService.getMe(req.user.id);
    res.status(200).json({ success: true, data: { user } });
  }),
};

module.exports = authController;
