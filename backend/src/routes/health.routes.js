'use strict';

const express = require('express');
const db = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

// status stays 'ok' (the process is alive); database reports connectivity
// so a down database degrades the payload instead of failing the endpoint.
router.get(
  '/health',
  asyncHandler(async (req, res) => {
    const database = await db.pingDatabase();
    res.status(200).json({
      success: true,
      data: { status: 'ok', database, uptime: process.uptime() },
    });
  }),
);

module.exports = router;
