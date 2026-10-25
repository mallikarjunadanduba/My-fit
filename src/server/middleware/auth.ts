import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { env } from '../env';
import { forbidden, unauthorized } from '../lib/http';
import { SESSION_COOKIE, getSessionCached, setSessionCookie, touchSession, updateCachedExpiry } from '../services/session';

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: UserRole;
  email: string;
  name: string;
  timezone: string;
  gymWeekdays: number[];
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/** Loads the session if a valid cookie is present; never rejects. */
export async function loadSession(req: Request, res: Response, next: NextFunction) {
  const token: string | undefined = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  const session = await getSessionCached(token);
  if (!session) return next();
  // Only hits the database when the sliding expiry actually needs renewing.
  const renewed = await touchSession(session.id, session.expiresAt);
  if (renewed) {
    setSessionCookie(res, token, renewed);
    updateCachedExpiry(token, renewed);
  }
  req.auth = {
    userId: session.userId,
    sessionId: session.id,
    role: session.role,
    email: session.email,
    name: session.name,
    timezone: session.timezone ?? env.DEFAULT_TIMEZONE,
    gymWeekdays: session.gymWeekdays ?? [1, 2, 3, 4, 5, 6],
  };
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  next();
}

export function requireOwner(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(unauthorized());
  if (req.auth.role !== 'OWNER') return next(forbidden('Only the account owner can do this'));
  next();
}

/** Use inside handlers mounted behind requireAuth. */
export function auth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
