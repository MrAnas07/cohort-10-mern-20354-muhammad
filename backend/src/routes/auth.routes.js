'use strict';

const express = require('express');
const authenticate = require('../middleware/authenticate');
const { registerLimiter, loginLimiter, refreshLimiter } = require('../middleware/rateLimiters');
const { registerSchema, loginSchema, validate } = require('../validators/auth.schemas');
const authController = require('../controllers/auth.controller');

const router = express.Router();

// Endpoints 1-5 of architecture 5.3. Every request here also passes the CSRF
// guard and global limiter mounted in routes/index.js; logout and me run
// behind authenticate (6.6), while register/login/refresh deliberately do not.
router.post('/register', registerLimiter, validate(registerSchema), authController.register);
router.post('/login', loginLimiter, validate(loginSchema), authController.login);
router.post('/refresh', refreshLimiter, authController.refresh);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

module.exports = router;
