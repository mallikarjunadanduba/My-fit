// Benchmarks the main API endpoints: wall time and number of DB queries per request.
// Usage: BENCH_DATABASE_URL=postgres://… npx tsx scripts/bench-api.ts
// Uses a dedicated benchmark database (never production). Creates/reuses user bench@example.test.
import crypto from 'node:crypto';

const url = process.env.BENCH_DATABASE_URL;
if (!url) throw new Error('Set BENCH_DATABASE_URL to a disposable database');
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
process.env.PRISMA_QUERY_STATS = '1';
process.env.SCHEDULER_ENABLED = 'false';
process.env.SESSION_SECRET ||= 'bench-secret-bench-secret-bench-secret-123456';

const { default: request } = await import('supertest');
const { createApp } = await import('../src/server/app');
const { prisma, queryStats } = await import('../src/server/db');
const { createSession } = await import('../src/server/services/session');
const { seedUserDefaults } = await import('../src/server/services/defaults');
const { recomputeUserReminders } = await import('../src/server/services/reminders.service');
const { todayIn } = await import('../src/server/lib/dates');

const app = createApp();
const email = 'bench@example.test';
let user = await prisma.user.findUnique({ where: { email } });
if (!user) {
  user = await prisma.user.create({
    data: { email, name: 'Bench', passwordHash: 'x', role: 'OWNER', settings: { create: { timezone: 'Asia/Kolkata' } } },
  });
  await prisma.$transaction(async (tx) => {
    await seedUserDefaults(tx, user!.id);
    await recomputeUserReminders(user!.id, tx);
  }, { timeout: 600_000 });
}
const { token } = await createSession(user.id);
const csrf = crypto.randomBytes(8).toString('hex');
const cookie = `mf_session=${token}; mf_csrf=${csrf}`;
const today = todayIn('Asia/Kolkata');
const month = today.slice(0, 7);

// A little data so pages aren't empty.
if (process.argv.includes('--populate')) {
  await request(app).post('/api/water').set('Cookie', cookie).set('X-CSRF-Token', csrf).send({ date: today, amountMl: 250 });
}

const endpoints = [
  '/api/auth/status',
  '/api/dashboard',
  `/api/food-diary?date=${today}`,
  `/api/meals/plan?date=${today}`,
  '/api/meals/slots',
  '/api/foods?page=1&pageSize=50',
  `/api/water?date=${today}`,
  `/api/workouts/schedule?date=${today}`,
  `/api/workouts/week?date=${today}`,
  '/api/workouts/plans',
  `/api/routines/day?date=${today}`,
  '/api/reminders',
  '/api/reminders/next',
  '/api/reminders/overdue',
  '/api/notifications/config',
  '/api/settings',
  '/api/measurements/latest',
  `/api/reports/weekly?date=${today}`,
  `/api/reports/monthly?month=${month}`,
  `/api/reports/calendar?month=${month}`,
];

// --only=dashboard,water limits the run to endpoints containing any of the given substrings.
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const rows: string[] = [];
for (const ep of endpoints.filter((e) => !only || only.some((o) => e.includes(o)))) {
  // Warm (prepares statements on pooled connections), then report the best of 3 runs.
  await request(app).get(ep).set('Cookie', cookie);
  let best = Infinity;
  let queries = 0;
  let status = 0;
  for (let i = 0; i < 3; i++) {
    queryStats.count = 0;
    const t = performance.now();
    const res = await request(app).get(ep).set('Cookie', cookie);
    const ms = Math.round(performance.now() - t);
    status = res.status;
    if (ms < best) {
      best = ms;
      queries = queryStats.count;
    }
  }
  rows.push(`${String(status).padEnd(4)} ${String(best).padStart(6)} ms ${String(queries).padStart(4)} q  ${ep}`);
}
console.log(rows.join('\n'));
await prisma.$disconnect();
process.exit(0);
