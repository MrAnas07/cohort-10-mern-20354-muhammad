'use strict';

const { z } = require('zod');

// Strict request schemas (architecture 6.8): unknown fields are rejected,
// strings trimmed, emails lowercased. Password rules from 6.1 — 8-72
// characters with at least one letter and one number (72 is bcrypt's limit).
// Passwords are never trimmed: bcrypt hashes exactly what was typed.
const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Invalid email address').max(255));

const registerSchema = z.strictObject({
  fullName: z
    .string()
    .trim()
    .min(2, 'Full name must be at least 2 characters')
    .max(100, 'Full name must be at most 100 characters'),
  email: emailSchema,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(72, 'Password must be at most 72 characters')
    .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), {
      message: 'Password must contain at least one letter and one number',
    }),
});

// Login keeps only length limits — no complexity rules on the way in (5.3 #2).
const loginSchema = z.strictObject({
  email: emailSchema,
  password: z
    .string()
    .min(1, 'Password is required')
    .max(72, 'Password must be at most 72 characters'),
});

// Per-route body validation. A failed parse surfaces as a ZodError and the
// central error handler maps it to the 400 VALIDATION_ERROR envelope with one
// detail entry per field; a successful parse replaces req.body with the
// trimmed, lowercased values so downstream code sees normalised input.
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

module.exports = { registerSchema, loginSchema, validate };
