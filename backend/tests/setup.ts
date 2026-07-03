import dotenv from 'dotenv';
dotenv.config({ path: '.env.development' });

// Test environment — must be set before app import so background jobs don't start
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-jest-testing-only-32-chars-min';
process.env.USE_DUMMY_DATA = 'true';
process.env.API_VERSION = 'v1';
process.env.CORS_ORIGIN = '*';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://bloodlink:password@localhost:5432/bloodlink_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';
