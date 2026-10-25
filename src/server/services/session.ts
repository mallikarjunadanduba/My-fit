import crypto from 'node:crypto';
import type { Response } from 'express';
import { prisma } from '../db';
import { env, isProd } from '../env';

export const SESSION_COOKIE = 'mf_session';
export const CSRF_COOKIE = 'mf_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const DAY_MS = 24 * 60 * 60 * 1000;

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Session tokens are never stored in plaintext; HMAC with SESSION_SECRET. */
export function hashToken(token: string): string {
  return crypto.createHmac('sha256', env.SESSION_SECRET).update(token).digest('hex');
}

export function sessionTtlMs() {
  return env.SESSION_TTL_DAYS * DAY_MS;
}

export async function createSession(userId: string, meta: { userAgent?: string; ip?: string } = {}) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  const session = await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: meta.userAgent?.slice(0, 300), ip: meta.ip },
  });
  return { token, session };
}

// ── Short-lived in-process cache of validated sessions ──
// Every authenticated request needs the session + user + settings. On a high-latency DB link that
// lookup costs a full round trip per request, so validated sessions are cached briefly.
// Entries are dropped on logout, password change, session revocation and settings/profile edits.
const SESSION_CACHE_TTL_MS = 30_000;

export interface CachedSession {
  id: string;
  userId: string;
  expiresAt: Date;
  role: 'OWNER' | 'MEMBER';
  email: string;
  name: string;
  timezone: string | null;
  gymWeekdays: number[] | null;
}

const sessionCache = new Map<string, { value: CachedSession; cachedAt: number }>();

export function invalidateUserSessions(userId: string) {
  for (const [key, entry] of sessionCache) if (entry.value.userId === userId) sessionCache.delete(key);
}

/** Validated session for a cookie token, served from cache when fresh. */
export async function getSessionCached(token: string): Promise<CachedSession | null> {
  const key = hashToken(token);
  const hit = sessionCache.get(key);
  if (hit && Date.now() - hit.cachedAt < SESSION_CACHE_TTL_MS && hit.value.expiresAt.getTime() > Date.now()) return hit.value;
  sessionCache.delete(key);
  const s = await findValidSession(token);
  if (!s) return null;
  const value: CachedSession = {
    id: s.id,
    userId: s.userId,
    expiresAt: s.expiresAt,
    role: s.user.role,
    email: s.user.email,
    name: s.user.name,
    timezone: s.user.settings?.timezone ?? null,
    gymWeekdays: s.user.settings?.gymWeekdays ?? null,
  };
  if (sessionCache.size > 1000) sessionCache.clear();
  sessionCache.set(key, { value, cachedAt: Date.now() });
  return value;
}

/** Records a renewed expiry in the cache so the next request doesn't renew again. */
export function updateCachedExpiry(token: string, expiresAt: Date) {
  const hit = sessionCache.get(hashToken(token));
  if (hit) hit.value.expiresAt = expiresAt;
}

export async function findValidSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { settings: true } } },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session;
}

/** Sliding expiry: extend once more than half of the TTL has elapsed. */
export async function touchSession(sessionId: string, expiresAt: Date) {
  const remaining = expiresAt.getTime() - Date.now();
  if (remaining < sessionTtlMs() / 2) {
    const next = new Date(Date.now() + sessionTtlMs());
    await prisma.session.update({ where: { id: sessionId }, data: { expiresAt: next, lastSeenAt: new Date() } });
    return next;
  }
  return null;
}

export async function destroySession(token: string) {
  sessionCache.delete(hashToken(token));
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

const baseCookie = () => ({ secure: isProd, sameSite: 'strict' as const, path: '/' });

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, { ...baseCookie(), httpOnly: true, expires: expiresAt });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { ...baseCookie(), httpOnly: true });
}

/** CSRF double-submit token: readable cookie echoed back in the X-CSRF-Token header. */
export function setCsrfCookie(res: Response, token = randomToken(24)) {
  res.cookie(CSRF_COOKIE, token, { ...baseCookie(), httpOnly: false });
  return token;
}
