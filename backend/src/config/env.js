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
  JWT_ACCESS_SECRET: z.string().min(1).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment variables: ${details}`);
}

module.exports = Object.freeze(parsed.data);
