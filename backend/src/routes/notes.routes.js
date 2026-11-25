'use strict';

const express = require('express');
const authenticate = require('../middleware/authenticate');
const {
  createNoteSchema,
  updateNoteSchema,
  listQuerySchema,
  noteIdParamSchema,
  validate,
  validateQuery,
  validateParams,
} = require('../validators/note.schemas');
const notesController = require('../controllers/notes.controller');

const router = express.Router();

// Endpoints 6-10 of architecture 5.3. The whole router sits behind
// authenticate (6.6); the CSRF guard and global rate limiter are mounted
// once in routes/index.js, so POST/PATCH/DELETE here already require the
// X-Requested-With header before any handler runs.
router.use(authenticate);

router.get('/', validateQuery(listQuerySchema), notesController.list);
router.post('/', validate(createNoteSchema), notesController.create);
router.get('/:id', validateParams(noteIdParamSchema), notesController.get);
router.patch(
  '/:id',
  validateParams(noteIdParamSchema),
  validate(updateNoteSchema),
  notesController.update,
);
router.delete('/:id', validateParams(noteIdParamSchema), notesController.remove);

module.exports = router;
