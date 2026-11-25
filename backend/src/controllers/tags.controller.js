'use strict';

const asyncHandler = require('../utils/asyncHandler');
const tagsService = require('../services/tags.service');

// Endpoint 11 (5.3 #11): 200 with the caller's in-use tags and note counts.
const tagsController = {
  list: asyncHandler(async (req, res) => {
    const tags = await tagsService.list(req.user.id);
    res.status(200).json({ success: true, data: tags });
  }),
};

module.exports = tagsController;
