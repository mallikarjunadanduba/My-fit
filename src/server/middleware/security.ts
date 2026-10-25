import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { isTest } from '../env';
import { AppError } from '../lib/http';
import { CSRF_COOKIE, CSRF_HEADER } from '../services/session';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Double-submit CSRF check for every state-changing /api request. */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookie: string | undefined = req.cookies?.[CSRF_COOKIE];
  const header = req.get(CSRF_HEADER);
  if (!cookie || !header || cookie.length !== header.length || !crypto.timingSafeEqual(Buffer.from(cookie), Buffer.from(header))) {
    return next(new AppError(403, 'CSRF_FAILED', 'Missing or invalid CSRF token. Reload the page and try again.'));
  }
  next();
}

const limitHandler = (_req: Request, _res: Response, next: NextFunction) =>
  next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down and try again shortly.'));

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: isTest ? 10_000 : 600,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: limitHandler,
});

/** Brute-force protection for login / setup / invitation acceptance. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isTest ? 10_000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: limitHandler,
});
