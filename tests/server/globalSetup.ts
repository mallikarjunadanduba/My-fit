import { execSync } from 'node:child_process';
import 'dotenv/config';

/** Applies migrations to the dedicated test database before the server suite runs. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL must be set for server tests (never point it at production).');
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}
