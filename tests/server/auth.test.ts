import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'supertest';
import { anon, createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { checkSetupToken, hashPassword, setupGuard } from '../../src/server/services/auth.service';
import { hashToken } from '../../src/server/services/session';

const PASSWORD = 'correct-horse-battery';

/** Extracts cookie values from a response's Set-Cookie headers. */
function cookiesOf(res: Response): Record<string, string> {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const out: Record<string, string> = {};
  for (const c of raw ?? []) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
  }
  return out;
}

/** Fresh anonymous client with a CSRF cookie + header pair. */
function csrfClient() {
  const csrf = crypto.randomBytes(16).toString('hex');
  return {
    csrf,
    post: (url: string, cookie = '') => anon().post(url).set('Cookie', `mf_csrf=${csrf}${cookie ? `; ${cookie}` : ''}`).set('X-CSRF-Token', csrf),
  };
}

async function userWithPassword(role: 'OWNER' | 'MEMBER' = 'MEMBER') {
  const email = `login-${crypto.randomUUID()}@example.test`;
  const user = await prisma.user.create({
    data: { email, name: 'Login User', role, passwordHash: await hashPassword(PASSWORD), settings: { create: {} } },
  });
  return { user, email };
}

const unique = (p: string) => `${p}-${crypto.randomUUID()}@example.test`;

afterEach(() => vi.restoreAllMocks());

describe('GET /api/auth/status', () => {
  it('sets a CSRF cookie when absent and reports no user', async () => {
    const res = await anon().get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(cookiesOf(res).mf_csrf).toBeTruthy();
    expect(res.body.data).toMatchObject({ setupRequired: false, user: null, settings: null });
  });

  it('does not rotate an existing CSRF cookie and returns the user', async () => {
    const { user, token } = await createTestUser();
    const res = await anon().get('/api/auth/status').set('Cookie', `mf_session=${token}; mf_csrf=keepme`);
    expect(cookiesOf(res).mf_csrf).toBeUndefined();
    expect(res.body.data.user).toMatchObject({ id: user.id, email: user.email, role: 'OWNER' });
    expect(res.body.data.settings).toMatchObject({ timezone: 'Asia/Kolkata', theme: 'SYSTEM' });
  });
});

describe('first-run setup', () => {
  it('creates the owner with seeded defaults once, then refuses with 409', async () => {
    const spy = vi.spyOn(setupGuard, 'userCount').mockResolvedValue(0);
    const client = csrfClient();
    const email = unique('owner');
    const res = await client.post('/api/auth/setup').send({ name: 'Owner', email, password: PASSWORD, timezone: 'Europe/London' });
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ email, role: 'OWNER' });
    const cookies = cookiesOf(res);
    expect(cookies.mf_session).toBeTruthy();
    expect(cookies.mf_csrf).toBeTruthy();
    expect(cookies.mf_csrf).not.toBe(client.csrf);

    const created = await prisma.user.findUniqueOrThrow({ where: { email }, include: { settings: true } });
    expect(created.settings?.timezone).toBe('Europe/London');
    expect(created.settings?.defaultsSeededAt).not.toBeNull();
    expect(await prisma.mealSlot.count({ where: { userId: created.id } })).toBe(7);

    // New session works.
    const me = await anon().get('/api/auth/me').set('Cookie', `mf_session=${cookies.mf_session}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);

    spy.mockRestore();
    const again = await csrfClient().post('/api/auth/setup').send({ name: 'Other', email: unique('other'), password: PASSWORD });
    expect(again.status).toBe(409);
  });

  it('validates the setup body', async () => {
    vi.spyOn(setupGuard, 'userCount').mockResolvedValue(0);
    const res = await csrfClient().post('/api/auth/setup').send({ name: 'X', email: 'bad', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('enforces SETUP_TOKEN in production only', () => {
    expect(() => checkSetupToken(undefined, 'secret-token', false)).not.toThrow();
    expect(() => checkSetupToken(undefined, undefined, true)).not.toThrow();
    expect(() => checkSetupToken('secret-token', 'secret-token', true)).not.toThrow();
    expect(() => checkSetupToken('wrong', 'secret-token', true)).toThrow(/setup token/i);
    expect(() => checkSetupToken(undefined, 'secret-token', true)).toThrow(/setup token/i);
  });
});

describe('login / logout', () => {
  it('logs in with valid credentials and rotates the CSRF cookie', async () => {
    const { email } = await userWithPassword();
    const client = csrfClient();
    const res = await client.post('/api/auth/login').send({ email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
    const cookies = cookiesOf(res);
    expect(cookies.mf_session).toBeTruthy();
    expect(cookies.mf_csrf).not.toBe(client.csrf);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  it('returns the same generic error for a wrong password and an unknown email', async () => {
    const { email } = await userWithPassword();
    const wrong = await csrfClient().post('/api/auth/login').send({ email, password: 'not-the-password' });
    const unknown = await csrfClient().post('/api/auth/login').send({ email: unique('nobody'), password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe('Invalid email or password');
    expect(unknown.body.error).toEqual(wrong.body.error);
  });

  it('rejects login without a CSRF header (403)', async () => {
    const { email } = await userWithPassword();
    const res = await anon().post('/api/auth/login').set('Cookie', 'mf_csrf=abc').send({ email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_FAILED');
  });

  it('logout destroys the session', async () => {
    const { token, api } = await createTestUser();
    expect((await api.get('/api/auth/me')).status).toBe(200);
    const out = await api.post('/api/auth/logout');
    expect(out.status).toBe(204);
    expect((await api.get('/api/auth/me')).status).toBe(401);
    expect(await prisma.session.count({ where: { tokenHash: hashToken(token) } })).toBe(0);
  });

  it('protected endpoints return 401 without a cookie', async () => {
    expect((await anon().get('/api/auth/me')).status).toBe(401);
    expect((await anon().get('/api/settings')).status).toBe(401);
  });
});

describe('change password', () => {
  it('requires the current password and revokes other sessions', async () => {
    const { email } = await userWithPassword();
    const c1 = await csrfClient().post('/api/auth/login').send({ email, password: PASSWORD });
    const c2 = await csrfClient().post('/api/auth/login').send({ email, password: PASSWORD });
    const s1 = cookiesOf(c1).mf_session;
    const s2 = cookiesOf(c2).mf_session;
    const client = csrfClient();

    const bad = await client.post('/api/auth/change-password', `mf_session=${s1}`).send({ currentPassword: 'nope-nope-nope', newPassword: 'another-long-password' });
    expect(bad.status).toBe(400);
    const short = await client.post('/api/auth/change-password', `mf_session=${s1}`).send({ currentPassword: PASSWORD, newPassword: 'short' });
    expect(short.status).toBe(400);

    const res = await client.post('/api/auth/change-password', `mf_session=${s1}`).send({ currentPassword: PASSWORD, newPassword: 'another-long-password' });
    expect(res.status).toBe(200);
    expect(res.body.data.otherSessionsRevoked).toBeGreaterThanOrEqual(1);
    expect((await anon().get('/api/auth/me').set('Cookie', `mf_session=${s1}`)).status).toBe(200);
    expect((await anon().get('/api/auth/me').set('Cookie', `mf_session=${s2}`)).status).toBe(401);

    const relog = await csrfClient().post('/api/auth/login').send({ email, password: 'another-long-password' });
    expect(relog.status).toBe(200);
  });
});

describe('invitations', () => {
  it('owner invites, invitee checks and accepts once, gets seeded defaults', async () => {
    const owner = await createTestUser({ role: 'OWNER' });
    const email = unique('invitee');
    const inv = await owner.api.post('/api/auth/invitations').send({ email });
    expect(inv.status).toBe(201);
    expect(inv.body.data.path).toMatch(/^\/invite\/[\w-]+$/);
    const token = inv.body.data.path.split('/').pop();

    // Token is stored hashed only.
    const stored = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.body.data.id } });
    expect(stored.tokenHash).not.toBe(token);

    const list = await owner.api.get('/api/auth/invitations');
    expect(list.body.data.find((i: { id: string }) => i.id === inv.body.data.id)).toMatchObject({ email, status: 'PENDING' });

    const check = await anon().get(`/api/auth/invitations/${token}/check`);
    expect(check.status).toBe(200);
    expect(check.body.data.email).toBe(email);

    const weak = await csrfClient().post('/api/auth/accept-invite').send({ token, name: 'Invitee', password: 'short' });
    expect(weak.status).toBe(400);

    const accept = await csrfClient().post('/api/auth/accept-invite').send({ token, name: 'Invitee', password: PASSWORD });
    expect(accept.status).toBe(201);
    expect(accept.body.data.user).toMatchObject({ email, role: 'MEMBER' });
    expect(cookiesOf(accept).mf_session).toBeTruthy();
    const member = await prisma.user.findUniqueOrThrow({ where: { email }, include: { settings: true } });
    expect(member.settings?.defaultsSeededAt).not.toBeNull();

    const reuse = await csrfClient().post('/api/auth/accept-invite').send({ token, name: 'Again', password: PASSWORD });
    expect(reuse.status).toBe(404);
    expect((await anon().get(`/api/auth/invitations/${token}/check`)).status).toBe(404);

    // Login works with the new account.
    expect((await csrfClient().post('/api/auth/login').send({ email, password: PASSWORD })).status).toBe(200);
  });

  it('rejects expired tokens, lets the owner revoke, and is owner-only', async () => {
    const owner = await createTestUser({ role: 'OWNER' });
    const inv = await owner.api.post('/api/auth/invitations').send({ email: unique('exp') });
    const token = inv.body.data.path.split('/').pop();
    await prisma.invitation.update({ where: { id: inv.body.data.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await anon().get(`/api/auth/invitations/${token}/check`)).status).toBe(404);

    const other = await createTestUser({ role: 'OWNER' });
    expect((await other.api.delete(`/api/auth/invitations/${inv.body.data.id}`)).status).toBe(404);
    expect((await owner.api.delete(`/api/auth/invitations/${inv.body.data.id}`)).status).toBe(204);

    const member = await createTestUser({ role: 'MEMBER' });
    expect((await member.api.post('/api/auth/invitations').send({ email: unique('x') })).status).toBe(403);
    expect((await member.api.get('/api/auth/invitations')).status).toBe(403);
  });

  it('refuses to invite an existing account', async () => {
    const owner = await createTestUser({ role: 'OWNER' });
    const res = await owner.api.post('/api/auth/invitations').send({ email: owner.user.email });
    expect(res.status).toBe(409);
  });
});
