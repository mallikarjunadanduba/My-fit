import crypto from 'node:crypto';
import request from 'supertest';
import type { UserRole } from '@prisma/client';
import { createApp } from '../../src/server/app';
import { prisma } from '../../src/server/db';
import { createSession } from '../../src/server/services/session';

export const app = createApp();

export interface TestUserOptions {
  role?: UserRole;
  timezone?: string;
  gymWeekdays?: number[];
}

/**
 * Creates an isolated user (unique email) with settings and a live session.
 * Returns `api`, a set of supertest helpers that send the session cookie and CSRF header.
 */
export async function createTestUser(opts: TestUserOptions = {}) {
  const email = `test-${crypto.randomUUID()}@example.test`;
  const user = await prisma.user.create({
    data: {
      email,
      name: 'Test User',
      passwordHash: 'not-a-real-hash',
      role: opts.role ?? 'OWNER',
      settings: { create: { timezone: opts.timezone ?? 'Asia/Kolkata', gymWeekdays: opts.gymWeekdays ?? [1, 2, 3, 4, 5, 6] } },
    },
  });
  const { token } = await createSession(user.id);
  const csrf = crypto.randomBytes(16).toString('hex');
  const cookie = `mf_session=${token}; mf_csrf=${csrf}`;
  const withAuth = (t: request.Test) => t.set('Cookie', cookie).set('X-CSRF-Token', csrf);
  const api = {
    get: (url: string) => withAuth(request(app).get(url)),
    post: (url: string) => withAuth(request(app).post(url)),
    put: (url: string) => withAuth(request(app).put(url)),
    patch: (url: string) => withAuth(request(app).patch(url)),
    delete: (url: string) => withAuth(request(app).delete(url)),
  };
  return { user, token, api };
}

/** Unauthenticated client (no cookies). */
export const anon = () => request(app);
