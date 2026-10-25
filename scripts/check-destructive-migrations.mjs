// Fails (exit 1) if any migration not yet applied to DATABASE_URL contains destructive SQL.
// Used by CI before `prisma migrate deploy` so production data is never dropped by accident.
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';

const DESTRUCTIVE = /\b(DROP\s+(TABLE|COLUMN|SCHEMA|TYPE|INDEX\s+CONCURRENTLY)|TRUNCATE|DELETE\s+FROM|ALTER\s+TABLE\s+\S+\s+DROP)\b/i;
const dir = path.resolve('prisma/migrations');

const prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL });
let applied = new Set();
try {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  applied = new Set(rows.map((r) => r.migration_name));
} catch {
  console.log('No _prisma_migrations table yet — treating every migration as pending.');
} finally {
  await prisma.$disconnect();
}

const pending = fs
  .readdirSync(dir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !applied.has(d.name))
  .map((d) => d.name)
  .sort();

console.log(`Pending migrations: ${pending.length ? pending.join(', ') : 'none'}`);

const offenders = pending.filter((m) => DESTRUCTIVE.test(fs.readFileSync(path.join(dir, m, 'migration.sql'), 'utf8')));
if (offenders.length) {
  console.error(
    `::error::Destructive SQL found in: ${offenders.join(', ')}. Back up the database, then re-run the workflow manually with allow_destructive_migrations=true.`,
  );
  process.exit(1);
}
