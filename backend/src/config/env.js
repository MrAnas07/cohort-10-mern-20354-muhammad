'use strict';

require('dotenv').config({ quiet: true });
const { z } = require('zod');

const postgresUrl = z
  .string()
  .min(1)
  .refine((value) => /^postgres(ql)?:\/\/\S+$/.test(value), {
    message: 'must be a postgresql:// or postgres:// connection URL',
  });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().min(1).max(65535),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']),
  DATABASE_URL: postgresUrl,
  TEST_DATABASE_URL: postgresUrl.optional(),
  CLIENT_ORIGIN: z.string().min(1).optional(),
  // HS256 signing secret for access tokens (architecture 6.2). Required and
  // long: a short secret is brute-forceable, and a missing one must fail fast
  // instead of silently signing with an empty key.
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment variables: ${details}`);
}

module.exports = Object.freeze(parsed.data);
