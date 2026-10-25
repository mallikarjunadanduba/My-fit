import 'dotenv/config';

// Point Prisma at the test database before any server module is imported.
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL must be set for server tests');
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
process.env.NODE_ENV = 'test';
process.env.SCHEDULER_ENABLED = 'false';
process.env.SESSION_SECRET ||= 'test-secret-test-secret-test-secret-0123456789';
