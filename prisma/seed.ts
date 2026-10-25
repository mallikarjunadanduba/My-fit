/**
 * Idempotent seed: creates the starter data for every user that has not been seeded yet.
 * Never overwrites or deletes anything, and never creates accounts or default credentials —
 * the first account is created through the web first-run setup (/setup).
 */
import { prisma } from '../src/server/db';
import { seedUserDefaults } from '../src/server/services/defaults';

async function main() {
  const total = await prisma.user.count();
  if (total === 0) {
    console.log('No users yet. Open the app and complete the first-run setup at /setup — defaults are seeded automatically.');
    return;
  }

  const pending = await prisma.user.findMany({
    where: { OR: [{ settings: null }, { settings: { defaultsSeededAt: null } }] },
    select: { id: true, email: true },
  });
  if (pending.length === 0) {
    console.log(`All ${total} user(s) already have default data. Nothing to do.`);
    return;
  }

  for (const u of pending) {
    const result = await prisma.$transaction((tx) => seedUserDefaults(tx, u.id), { timeout: 30_000, maxWait: 10_000 });
    console.log(result.seeded ? `Seeded defaults for ${u.email}: ${JSON.stringify(result.counts)}` : `Skipped ${u.email} (already seeded)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
