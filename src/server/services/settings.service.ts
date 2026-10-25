import type { NutritionTarget, ThemeMode, UserSettings } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';
import { badRequest, conflict, notFound } from '../lib/http';
import { fromDbDate, toDbDate, todayIn } from '../lib/dates';
import { recomputeUserReminders } from './reminders.service';
import { invalidateUserSessions } from './session';

export function targetView(t: NutritionTarget) {
  const { userId: _userId, effectiveFrom, ...rest } = t;
  return { ...rest, effectiveFrom: fromDbDate(effectiveFrom) };
}

export function settingsView(s: UserSettings) {
  return {
    timezone: s.timezone,
    theme: s.theme,
    gymWeekdays: [...s.gymWeekdays].sort((a, b) => a - b),
    defaultSnoozeMinutes: s.defaultSnoozeMinutes,
    notificationsEnabled: s.notificationsEnabled,
    profileMediaId: s.profileMediaId,
    defaultsSeededAt: s.defaultsSeededAt,
  };
}

/** Creates the settings row if it is missing (older accounts); one statement, safe under concurrency. */
function ensureSettings(userId: string) {
  return prisma.userSettings.upsert({ where: { userId }, create: { userId, timezone: env.DEFAULT_TIMEZONE }, update: {} });
}

/**
 * Builds { current, history } from the full history (newest first) without another query.
 * Same rule as `getTargetForDate`: the latest version effective on or before today, else the earliest one.
 */
function targetsBundle(historyDesc: NutritionTarget[], timezone: string) {
  const today = toDbDate(todayIn(timezone)).getTime();
  const current = historyDesc.find((t) => t.effectiveFrom.getTime() <= today) ?? historyDesc.at(-1) ?? null;
  return { current: current ? targetView(current) : null, history: historyDesc.map(targetView) };
}

const targetHistory = (userId: string) => prisma.nutritionTarget.findMany({ where: { userId }, orderBy: { effectiveFrom: 'desc' } });

export async function getTargets(userId: string, timezone: string) {
  return targetsBundle(await targetHistory(userId), timezone);
}

/** One round trip: user, settings and the target history run in parallel. */
export async function getSettingsBundle(userId: string) {
  // Three independent single-table queries in parallel (a nested `settings` select would add a sequential query).
  const [user, found, history] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, role: true } }),
    prisma.userSettings.findUnique({ where: { userId } }),
    targetHistory(userId),
  ]);
  const settings = found ?? (await ensureSettings(userId));
  return {
    settings: settingsView(settings),
    targets: targetsBundle(history, settings.timezone),
    account: { name: user.name, email: user.email, role: user.role },
  };
}

export interface SettingsPatch {
  timezone?: string;
  theme?: ThemeMode;
  gymWeekdays?: number[];
  defaultSnoozeMinutes?: number;
  notificationsEnabled?: boolean;
  profileMediaId?: string | null;
}

// Background reminder recomputes, chained per user so consecutive saves apply in order.
const pendingRecompute = new Map<string, Promise<void>>();

/** Recomputes alarm times without holding up the response (4 round trips); failures are logged. */
export function scheduleReminderRecompute(userId: string): Promise<void> {
  const run = (pendingRecompute.get(userId) ?? Promise.resolve())
    .then(() => recomputeUserReminders(userId))
    .then(
      () => undefined,
      (err: unknown) => console.error(`[settings] reminder recompute failed for user ${userId}:`, err),
    )
    .finally(() => {
      if (pendingRecompute.get(userId) === run) pendingRecompute.delete(userId);
    });
  pendingRecompute.set(userId, run);
  return run;
}

/** Resolves once background recomputes for the user have finished (tests). */
export function reminderRecomputeSettled(userId: string) {
  return pendingRecompute.get(userId) ?? Promise.resolve();
}

export async function updateSettings(userId: string, patch: SettingsPatch) {
  if (patch.profileMediaId) {
    const media = await prisma.mediaAsset.findFirst({ where: { id: patch.profileMediaId, userId, deletedAt: null }, select: { id: true } });
    if (!media) throw notFound('Media');
  }
  const data = { ...patch, ...(patch.gymWeekdays && { gymWeekdays: [...patch.gymWeekdays].sort((a, b) => a - b) }) };
  // Single statement; also creates the row for accounts that predate settings.
  const s = await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, timezone: env.DEFAULT_TIMEZONE, ...data },
    update: data,
  });
  invalidateUserSessions(userId);
  // Alarm times depend on timezone and gym weekdays; refresh them in the background.
  if (patch.timezone || patch.gymWeekdays) void scheduleReminderRecompute(userId);
  return settingsView(s);
}

export async function updateProfile(userId: string, name: string) {
  const u = await prisma.user.update({ where: { id: userId }, data: { name: name.trim() } });
  invalidateUserSessions(userId);
  return { name: u.name, email: u.email, role: u.role };
}

// ───────────── Nutrition targets ─────────────

export interface TargetInput {
  effectiveFrom?: string;
  calories: number;
  caloriesMin?: number | null;
  caloriesMax?: number | null;
  protein: number;
  proteinMin?: number | null;
  proteinMax?: number | null;
  carbs: number;
  carbsMin?: number | null;
  carbsMax?: number | null;
  fat: number;
  fatMin?: number | null;
  fatMax?: number | null;
  fiber: number;
  fiberMin?: number | null;
  fiberMax?: number | null;
  waterMl: number;
  waterMinMl?: number | null;
  waterMaxMl?: number | null;
  notes?: string | null;
}

const RANGES = [
  ['calories', 'caloriesMin', 'caloriesMax'],
  ['protein', 'proteinMin', 'proteinMax'],
  ['carbs', 'carbsMin', 'carbsMax'],
  ['fat', 'fatMin', 'fatMax'],
  ['fiber', 'fiberMin', 'fiberMax'],
  ['waterMl', 'waterMinMl', 'waterMaxMl'],
] as const;

/** Returns field → message for every range where min ≤ target ≤ max is violated. */
export function targetRangeErrors(t: TargetInput): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, minKey, maxKey] of RANGES) {
    const v = t[key];
    const min = t[minKey];
    const max = t[maxKey];
    if (min != null && min > v) errors[minKey] = 'Minimum must not exceed the target';
    if (max != null && max < v) errors[maxKey] = 'Maximum must not be below the target';
  }
  return errors;
}

/** Creates a new target version, or replaces the one with the same effective date. Older versions are untouched. */
export async function upsertTarget(userId: string, timezone: string, input: TargetInput) {
  const errors = targetRangeErrors(input);
  if (Object.keys(errors).length) throw badRequest('Each minimum must be ≤ target ≤ maximum', { fieldErrors: errors });
  const { effectiveFrom: date = todayIn(timezone), ...values } = input;
  const data = {
    calories: values.calories,
    caloriesMin: values.caloriesMin ?? null,
    caloriesMax: values.caloriesMax ?? null,
    protein: values.protein,
    proteinMin: values.proteinMin ?? null,
    proteinMax: values.proteinMax ?? null,
    carbs: values.carbs,
    carbsMin: values.carbsMin ?? null,
    carbsMax: values.carbsMax ?? null,
    fat: values.fat,
    fatMin: values.fatMin ?? null,
    fatMax: values.fatMax ?? null,
    fiber: values.fiber,
    fiberMin: values.fiberMin ?? null,
    fiberMax: values.fiberMax ?? null,
    waterMl: values.waterMl,
    waterMinMl: values.waterMinMl ?? null,
    waterMaxMl: values.waterMaxMl ?? null,
    notes: values.notes?.trim() || null,
  };
  const effectiveFrom = toDbDate(date);
  const t = await prisma.nutritionTarget.upsert({
    where: { userId_effectiveFrom: { userId, effectiveFrom } },
    create: { userId, effectiveFrom, ...data },
    update: data,
  });
  return targetView(t);
}

export async function deleteTarget(userId: string, id: string) {
  // One statement: delete only if it belongs to the user and isn't their last version.
  const deleted = await prisma.$executeRaw`
    DELETE FROM "NutritionTarget"
    WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid
      AND (SELECT count(*) FROM "NutritionTarget" WHERE "userId" = ${userId}::uuid) > 1`;
  if (deleted === 1) return;
  // Error path only: tell "not yours / missing" apart from "last one".
  const exists = await prisma.nutritionTarget.findFirst({ where: { id, userId }, select: { id: true } });
  if (!exists) throw notFound('Target');
  throw conflict('You need at least one nutrition target. Edit it instead of deleting it.');
}

// ───────────── Sessions ─────────────

export async function listSessions(userId: string, currentSessionId: string) {
  const rows = await prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, createdAt: true, lastSeenAt: true, expiresAt: true, userAgent: true, ip: true },
  });
  return rows.map((s) => ({ ...s, current: s.id === currentSessionId }));
}

export async function revokeSession(userId: string, currentSessionId: string, id: string) {
  if (id === currentSessionId) throw badRequest('Use “Sign out” to end the current session');
  const { count } = await prisma.session.deleteMany({ where: { id, userId } });
  if (!count) throw notFound('Session');
  invalidateUserSessions(userId);
}

