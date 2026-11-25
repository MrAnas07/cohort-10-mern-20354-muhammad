'use strict';

const express = require('express');
const authenticate = require('../middleware/authenticate');
const tagsController = require('../controllers/tags.controller');

const router = express.Router();

// Endpoint 11 of architecture 5.3 - behind authenticate like /notes (6.6).
router.use(authenticate);

router.get('/', tagsController.list);

module.exports = router;
