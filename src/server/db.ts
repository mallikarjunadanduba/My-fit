import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Set PRISMA_QUERY_STATS=1 to count queries (used by scripts/bench-api.ts); off in normal runs. */
export const queryStats = { count: 0 };

// Prisma's default interactive-transaction limit is 5 s. Over a high-latency link (~0.4 s per round trip
// from India to Neon us-east-2) a legitimate multi-step save can exceed that and gets cancelled (P2028),
// so allow more time. Callers can still pass tighter options per transaction.
const transactionOptions = { maxWait: 15_000, timeout: 60_000 };

function createClient() {
  if (process.env.PRISMA_QUERY_STATS !== '1') return new PrismaClient({ transactionOptions });
  const client = new PrismaClient({ transactionOptions, log: [{ emit: 'event', level: 'query' }] });
  client.$on('query', () => {
    queryStats.count++;
  });
  return client;
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type Db = PrismaClient | Tx;
