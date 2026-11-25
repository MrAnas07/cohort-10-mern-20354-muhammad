'use strict';

// Loaded by Mocha before any test file (see .mocharc.cjs) so the app's
// strict env validation always sees test values, with or without a .env file.
// A local .env (or CI secrets) wins for the database URLs and the JWT secret,
// so the suite can run against a real test database; the compose defaults
// below keep the zero-config path working.
require('dotenv').config({ quiet: true });

process.env.NODE_ENV = 'test';
process.env.PORT = '4000';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://notes:notes_local_dev@127.0.0.1:5432/notes_test';
process.env.TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgresql://notes:notes_local_dev@127.0.0.1:5432/notes_test';
// Test-only HS256 secret (>=32 chars); a real .env overrides it. Never use
// this value outside the suite.
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || 'test_only_secret_do_not_use_in_production_0123456789';
