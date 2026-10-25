import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { env, isProd } from '../env';
import { auth, requireAuth, requireOwner } from '../middleware/auth';
import { authLimiter } from '../middleware/security';
import { created, idParam, noContent, ok, parseBody, parseParams } from '../lib/http';
import { timezoneString } from '../lib/dates';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  setCsrfCookie,
  setSessionCookie,
} from '../services/session';
import {
  PASSWORD_MIN,
  acceptInvitation,
  changePassword,
  checkInvitation,
  createInvitation,
  isSetupRequired,
  listInvitations,
  login,
  publicUser,
  revokeInvitation,
  setupOwner,
} from '../services/auth.service';

const router = Router();

const password = z.string().min(PASSWORD_MIN, `Password must be at least ${PASSWORD_MIN} characters`).max(200);
const email = z.string().trim().email('Enter a valid email').max(254);
const name = z.string().trim().min(1, 'Name is required').max(80);

const setupBody = z.object({ name, email, password, timezone: timezoneString.optional(), setupToken: z.string().max(500).optional() });
const loginBody = z.object({ email: z.string().trim().min(1).max(254), password: z.string().min(1).max(200) });
const changePasswordBody = z.object({ currentPassword: z.string().min(1).max(200), newPassword: password });
const inviteBody = z.object({ email });
const tokenParam = z.object({ token: z.string().min(16).max(200) });
const acceptBody = z.object({ token: z.string().min(16).max(200), name, password, timezone: timezoneString.optional() });

const settingsView = (s: { timezone: string; theme: string; gymWeekdays: number[]; defaultSnoozeMinutes: number; notificationsEnabled: boolean } | null) =>
  s
    ? { timezone: s.timezone, theme: s.theme, gymWeekdays: s.gymWeekdays, defaultSnoozeMinutes: s.defaultSnoozeMinutes, notificationsEnabled: s.notificationsEnabled }
    : null;

/** Starts a new session for `userId`, replacing any session presented with this request. */
async function startSession(req: Request, res: Response, userId: string) {
  const existing: string | undefined = req.cookies?.[SESSION_COOKIE];
  if (existing) await destroySession(existing);
  const { token, session } = await createSession(userId, { userAgent: req.get('user-agent'), ip: req.ip });
  setSessionCookie(res, token, session.expiresAt);
  setCsrfCookie(res);
}

router.get('/status', async (req, res) => {
  if (!req.cookies?.[CSRF_COOKIE]) setCsrfCookie(res);
  res.setHeader('Cache-Control', 'no-store');
  if (!req.auth) {
    const setupRequired = await isSetupRequired();
    // Tells the setup screen whether to ask for SETUP_TOKEN (never reveals the token itself).
    const setupTokenRequired = setupRequired && isProd && !!env.SETUP_TOKEN;
    return ok(res, { setupRequired, setupTokenRequired, user: null, settings: null });
  }
  const settings = await prisma.userSettings.findUnique({ where: { userId: req.auth.userId } });
  return ok(res, {
    setupRequired: false,
    user: { id: req.auth.userId, email: req.auth.email, name: req.auth.name, role: req.auth.role },
    settings: settingsView(settings),
  });
});

router.post('/setup', authLimiter, async (req, res) => {
  const body = parseBody(req, setupBody);
  const user = await setupOwner(body);
  await startSession(req, res, user.id);
  return created(res, { user: publicUser(user) });
});

router.post('/login', authLimiter, async (req, res) => {
  const body = parseBody(req, loginBody);
  const user = await login(body.email, body.password);
  await startSession(req, res, user.id);
  return ok(res, { user: publicUser(user) });
});

router.post('/logout', async (req, res) => {
  const token: string | undefined = req.cookies?.[SESSION_COOKIE];
  if (token) await destroySession(token);
  clearSessionCookie(res);
  setCsrfCookie(res);
  return noContent(res);
});

router.get('/me', requireAuth, async (req, res) => {
  const { userId } = auth(req);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { settings: true } });
  return ok(res, { user: publicUser(user), settings: settingsView(user.settings) });
});

router.post('/change-password', requireAuth, async (req, res) => {
  const { userId, sessionId } = auth(req);
  const body = parseBody(req, changePasswordBody);
  return ok(res, await changePassword(userId, sessionId, body.currentPassword, body.newPassword));
});

// Invitations — owner only (except the public check/accept endpoints).
router.get('/invitations', requireOwner, async (req, res) => ok(res, await listInvitations(auth(req).userId)));

router.post('/invitations', requireOwner, async (req, res) => {
  const body = parseBody(req, inviteBody);
  return created(res, await createInvitation(auth(req).userId, body.email));
});

router.delete('/invitations/:id', requireOwner, async (req, res) => {
  const { id } = parseParams(req, idParam);
  await revokeInvitation(auth(req).userId, id);
  return noContent(res);
});

router.get('/invitations/:token/check', authLimiter, async (req, res) => {
  const { token } = parseParams(req, tokenParam);
  return ok(res, await checkInvitation(token));
});

router.post('/accept-invite', authLimiter, async (req, res) => {
  const body = parseBody(req, acceptBody);
  const user = await acceptInvitation(body);
  await startSession(req, res, user.id);
  return created(res, { user: publicUser(user) });
});

export default router;
