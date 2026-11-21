'use strict';

// Loaded by Mocha before any test file (see .mocharc.cjs) so the app's
// strict env validation always sees test values, with or without a .env file.
process.env.NODE_ENV = 'test';
process.env.PORT = '4000';
process.env.LOG_LEVEL = 'silent';
// Strict env validation now requires DATABASE_URL; tests point at the
// compose-managed test database (connectivity itself is never assumed).
process.env.DATABASE_URL = 'postgresql://notes:notes_local_dev@127.0.0.1:5432/notes_test';
process.env.TEST_DATABASE_URL = 'postgresql://notes:notes_local_dev@127.0.0.1:5432/notes_test';
