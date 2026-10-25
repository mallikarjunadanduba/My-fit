import { env } from './env';
import { prisma } from './db';
import { createApp } from './app';
import { startScheduler, stopScheduler } from './scheduler';
import { stopDbKeepAlive, warmPool } from './dbWarmup';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[server] MyFit Routine listening on :${env.PORT} (${env.NODE_ENV})`);
  void warmPool();
  if (env.SCHEDULER_ENABLED) startScheduler();
  else console.log('[scheduler] disabled via SCHEDULER_ENABLED=false');
});

async function shutdown(signal: string) {
  console.log(`[server] ${signal} received, shutting down`);
  stopScheduler();
  stopDbKeepAlive();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
