'use strict';

const { z } = require('zod');
const { validateEditorContent } = require('../utils/editorContent');

// Notes request schemas (architecture 5.3 #6-#10). Strict objects reject
// unknown fields, the title is trimmed before its length is checked, and
// content is verified against the editor whitelist in utils/editorContent.js.

const titleSchema = z
  .string()
  .trim()
  .min(1, 'Title must be at least 1 character')
  .max(200, 'Title must be at most 200 characters');

// z.any() keeps "field missing" and "field present" distinguishable: the
// superRefine below runs for every supplied value (including null), while an
// absent key simply passes - which is exactly the difference between create
// (content required) and PATCH (content optional).
const contentSchema = z.any().superRefine((value, ctx) => {
  for (const message of validateEditorContent(value)) {
    ctx.addIssue({ code: 'custom', message });
  }
});

const tagsSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'Tags must not be empty')
      .max(30, 'Tags must be at most 30 characters'),
  )
  .max(10, 'A note can have at most 10 tags');

const createNoteSchema = z.strictObject({
  title: titleSchema,
  content: contentSchema,
  tags: tagsSchema.optional(),
  isPinned: z.boolean().optional(),
});

const updateNoteSchema = z
  .strictObject({
    title: titleSchema.optional(),
    content: contentSchema.optional(),
    tags: tagsSchema.optional(),
    isPinned: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field is required',
  });

const SORTS = [
  'updated_desc',
  'updated_asc',
  'created_desc',
  'created_asc',
  'title_asc',
  'relevance',
];

const listQuerySchema = z
  .strictObject({
    q: z
      .string()
      .trim()
      .max(100, 'Search text must be at most 100 characters')
      .optional()
      .transform((value) => value || undefined),
    tag: z
      .string()
      .trim()
      .min(1, 'Tag must not be empty')
      .max(30, 'Tag must be at most 30 characters')
      .optional(),
    pinned: z
      .enum(['true', 'false'], 'pinned must be "true" or "false"')
      .optional()
      .transform((value) => (value === undefined ? undefined : value === 'true')),
    sort: z
      .enum(
        SORTS,
        'sort must be one of updated_desc, updated_asc, created_desc, created_asc, title_asc, relevance',
      )
      .default('updated_desc'),
    page: z.coerce
      .number('page must be a number')
      .int('page must be an integer')
      .min(1, 'page must be at least 1')
      .default(1),
    limit: z.coerce
      .number('limit must be a number')
      .int('limit must be an integer')
      .min(1, 'limit must be at least 1')
      .max(50, 'limit must be at most 50')
      .default(20),
  })
  .superRefine((data, ctx) => {
    // "relevance" is only meaningful with a search term (5.3 #6).
    if (data.sort === 'relevance' && !data.q) {
      ctx.addIssue({ code: 'custom', path: ['sort'], message: 'sort "relevance" requires q' });
    }
  });

const noteIdParamSchema = z.object({ id: z.uuid('id must be a valid UUID') });

// Per-route body validation, same contract as auth.schemas validate(): a
// failed parse surfaces as a ZodError, which the central error handler maps
// to the 400 VALIDATION_ERROR envelope with one detail per field.
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(result.error);
      return;
    }
    req.body = result.data;
    next();
  };
}

// Query validation. Express 5 exposes req.query through a non-configurable
// getter, so a plain assignment is silently dropped; redefining the property
// on this request instance is the supported way to hand the parsed values on.
function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      next(result.error);
      return;
    }
    Object.defineProperty(req, 'query', {
      value: result.data,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    next();
  };
}

// Route params are a plain object, so a straightforward replacement works.
function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      next(result.error);
      return;
    }
    req.params = result.data;
    next();
  };
}

module.exports = {
  createNoteSchema,
  updateNoteSchema,
  listQuerySchema,
  noteIdParamSchema,
  validate,
  validateQuery,
  validateParams,
};
