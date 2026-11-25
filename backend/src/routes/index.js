'use strict';

const express = require('express');

const healthRoutes = require('./health.routes');
const authRoutes = require('./auth.routes');
const csrfGuard = require('../middleware/csrfGuard');
const { globalLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// Cross-cutting layers first: the global budget counts everything that
// reaches the API, then the CSRF guard rejects mutating requests that lack
// the custom header before any handler runs.
router.use(globalLimiter);
router.use(csrfGuard);

router.use('/auth', authRoutes);
router.use('/', healthRoutes);

module.exports = router;
