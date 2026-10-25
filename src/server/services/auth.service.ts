import crypto from 'node:crypto';
import argon2 from 'argon2';
import type { User, UserRole } from '@prisma/client';
import { prisma, type Db, type Tx } from '../db';
import { env, isProd } from '../env';
import { AppError, conflict, forbidden, notFound, unauthorized } from '../lib/http';
import { hashToken, invalidateUserSessions, randomToken } from './session';
import { seedUserDefaults } from './defaults';
import { recomputeUserReminders } from './reminders.service';

export const PASSWORD_MIN = 10;
export const INVITE_TTL_DAYS = 7;
// Account creation seeds the full default plan; allow for slow (cross-region) database links.
const TX_OPTS = { timeout: 120_000, maxWait: 20_000 };

// argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
const ARGON_OPTS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
const ARGON_COST = { memoryCost: ARGON_OPTS.memoryCost, timeCost: ARGON_OPTS.timeCost, parallelism: ARGON_OPTS.parallelism };

export const hashPassword = (password: string) => argon2.hash(password, ARGON_OPTS);

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

// Lazily computed hash used to equalise timing for unknown emails.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomToken(16)));

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export function publicUser(u: Pick<User, 'id' | 'email' | 'name' | 'role'>) {
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/** Indirection so tests can simulate an empty database (the test DB is shared). */
export const setupGuard = {
  userCount: (db: Db) => db.user.count(),
};

export async function isSetupRequired(db: Db = prisma) {
  return (await setupGuard.userCount(db)) === 0;
}

/** Constant-time comparison of two strings of any length. */
export function safeEqual(a: string, b: string) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/** In production, an optional SETUP_TOKEN must be supplied to create the first account. */
export function checkSetupToken(provided: string | undefined, expected = env.SETUP_TOKEN, production = isProd) {
  if (!production || !expected) return;
  if (!provided || !safeEqual(provided, expected)) throw forbidden('Invalid setup token');
}

interface AccountInput {
  name: string;
  email: string;
  password: string;
  timezone?: string;
}

/** Creates user + settings + default data inside an existing transaction. */
export async function createAccount(tx: Tx, input: AccountInput & { role: UserRole; passwordHash: string }) {
  const user = await tx.user.create({
    data: {
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      passwordHash: input.passwordHash,
      role: input.role,
      settings: { create: { timezone: input.timezone ?? env.DEFAULT_TIMEZONE } },
    },
  });
  await seedUserDefaults(tx, user.id);
  // Give the seeded reminders their first trigger time now, so the next alarm shows immediately.
  await recomputeUserReminders(user.id, tx);
  return user;
}

export async function setupOwner(input: AccountInput & { setupToken?: string }) {
  checkSetupToken(input.setupToken);
  if (!(await isSetupRequired())) throw conflict('Setup has already been completed');
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    // Serialise concurrent first-run attempts, then re-check inside the lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72710001)`;
    if ((await setupGuard.userCount(tx)) !== 0) throw conflict('Setup has already been completed');
    return createAccount(tx, { ...input, role: 'OWNER', passwordHash });
  }, TX_OPTS);
}

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user) {
    await verifyPassword(await getDummyHash(), password);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }
  // Transparently upgrade hashes created with weaker parameters.
  if (argon2.needsRehash(user.passwordHash, ARGON_COST)) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } }).catch(() => undefined);
  }
  return user;
}

export async function changePassword(userId: string, sessionId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw unauthorized();
  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Current password is incorrect');
  }
  const passwordHash = await hashPassword(newPassword);
  const [, revoked] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId, id: { not: sessionId } } }),
  ]);
  invalidateUserSessions(userId);
  return { otherSessionsRevoked: revoked.count };
}

// ───────────── Invitations ─────────────

function invitationStatus(inv: { usedAt: Date | null; expiresAt: Date }) {
  if (inv.usedAt) return 'USED' as const;
  if (inv.expiresAt.getTime() <= Date.now()) return 'EXPIRED' as const;
  return 'PENDING' as const;
}

const invitationView = (inv: { id: string; email: string; createdAt: Date; expiresAt: Date; usedAt: Date | null }) => ({
  id: inv.id,
  email: inv.email,
  createdAt: inv.createdAt,
  expiresAt: inv.expiresAt,
  usedAt: inv.usedAt,
  status: invitationStatus(inv),
});

export async function createInvitation(ownerId: string, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  if (await prisma.user.findUnique({ where: { email } })) throw conflict('An account with this email already exists');
  const token = randomToken(32);
  const inv = await prisma.invitation.create({
    data: {
      email,
      tokenHash: hashToken(token),
      invitedById: ownerId,
      expiresAt: new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  // The raw token is only ever returned here.
  return { ...invitationView(inv), path: `/invite/${token}` };
}

export async function listInvitations(ownerId: string) {
  const rows = await prisma.invitation.findMany({ where: { invitedById: ownerId }, orderBy: { createdAt: 'desc' } });
  return rows.map(invitationView);
}

export async function revokeInvitation(ownerId: string, id: string) {
  const inv = await prisma.invitation.findFirst({ where: { id, invitedById: ownerId } });
  if (!inv) throw notFound('Invitation');
  await prisma.invitation.delete({ where: { id } });
}

async function findUsableInvitation(db: Db, token: string) {
  const inv = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!inv || inv.usedAt || inv.expiresAt.getTime() <= Date.now()) throw notFound('Invitation');
  return inv;
}

export async function checkInvitation(token: string) {
  const inv = await findUsableInvitation(prisma, token);
  return { email: inv.email, expiresAt: inv.expiresAt };
}

export async function acceptInvitation(input: { token: string; name: string; password: string; timezone?: string }) {
  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const inv = await findUsableInvitation(tx, input.token);
    // Claim atomically so a token can be used once even under concurrency.
    const claimed = await tx.invitation.updateMany({ where: { id: inv.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw notFound('Invitation');
    if (await tx.user.findUnique({ where: { email: inv.email } })) throw conflict('An account with this email already exists');
    return createAccount(tx, { name: input.name, email: inv.email, password: input.password, timezone: input.timezone, role: 'MEMBER', passwordHash });
  }, TX_OPTS);
}
