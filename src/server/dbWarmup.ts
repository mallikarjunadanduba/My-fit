import type { NextFunction, Request, Response } from 'express';
import { prisma } from './db';

/**
 * Keeps a few database connections open while the app is being used.
 *
 * Opening a connection to Neon from far away costs several round trips (TLS + auth, plus waking a
 * suspended compute), i.e. seconds, while a query on an open connection costs one round trip.
 * Prisma opens connections lazily and drops idle ones, so screens that fire parallel queries after a
 * pause would each pay that setup. We pre-open POOL_TARGET connections on startup and on the first
 * request after a pause, and ping them while there is activity. After IDLE_STOP_MS without requests
 * the pings stop, so the database can still auto-suspend when nobody is using the app.
 */
const POOL_TARGET = 6;
const PING_EVERY_MS = 60_000;
const IDLE_STOP_MS = 10 * 60_000;

let lastActivity = 0;
let timer: NodeJS.Timeout | null = null;
let warming: Promise<void> | null = null;

export function warmPool(): Promise<void> {
  if (warming) return warming;
  // Parallel queries force the pool to open (or keep) POOL_TARGET connections.
  warming = Promise.all(Array.from({ length: POOL_TARGET }, () => prisma.$queryRaw`SELECT 1`))
    .then(() => undefined)
    .catch((e) => console.warn('[db] warm-up failed:', e instanceof Error ? e.message : e))
    .finally(() => {
      warming = null;
    });
  return warming;
}

function startPinging() {
  if (timer) return;
  timer = setInterval(() => {
    if (Date.now() - lastActivity > IDLE_STOP_MS) {
      clearInterval(timer!);
      timer = null;
      return;
    }
    void warmPool();
  }, PING_EVERY_MS);
  timer.unref();
}

/** Express middleware: marks activity and warms the pool on the first request after a pause. */
export function dbKeepAlive(_req: Request, _res: Response, next: NextFunction) {
  const idle = Date.now() - lastActivity > PING_EVERY_MS * 2;
  lastActivity = Date.now();
  if (idle) void warmPool();
  startPinging();
  next();
}

export function stopDbKeepAlive() {
  if (timer) clearInterval(timer);
  timer = null;
}
