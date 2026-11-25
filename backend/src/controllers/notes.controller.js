'use strict';

const asyncHandler = require('../utils/asyncHandler');
const notesService = require('../services/notes.service');

// Thin controllers (architecture layering): translate HTTP to service calls
// and shape the success envelope, nothing else. Ownership and validation
// already ran below/above, so these only ever pass req.user.id through.
const notesController = {
  // 5.3 #6 - 200 with the list envelope: data is the page array, meta the
  // pagination block. Full content is never part of a list response.
  list: asyncHandler(async (req, res) => {
    const { data, meta } = await notesService.list(req.user.id, req.query);
    res.status(200).json({ success: true, data, meta });
  }),

  // 5.3 #7 - 201 plus a Location header pointing at the new resource.
  create: asyncHandler(async (req, res) => {
    const note = await notesService.create(req.user.id, req.body);
    res.status(201).location(`/api/v1/notes/${note.id}`).json({ success: true, data: { note } });
  }),

  // 5.3 #8 - 200 with the full note, or 404 for missing/foreign ids alike.
  get: asyncHandler(async (req, res) => {
    const note = await notesService.get(req.user.id, req.params.id);
    res.status(200).json({ success: true, data: { note } });
  }),

  // 5.3 #9 - 200 with the updated full note.
  update: asyncHandler(async (req, res) => {
    const note = await notesService.update(req.user.id, req.params.id, req.body);
    res.status(200).json({ success: true, data: { note } });
  }),

  // 5.3 #10 - 204, no body.
  remove: asyncHandler(async (req, res) => {
    await notesService.remove(req.user.id, req.params.id);
    res.status(204).end();
  }),
};

module.exports = notesController;
