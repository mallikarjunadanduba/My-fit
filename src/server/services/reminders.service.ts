import { z } from 'zod';
import { ActivityCategory, DayType, Prisma, type Reminder, type ReminderOccurrence } from '@prisma/client';
import { prisma, type Db } from '../db';
import { env } from '../env';
import { conflict, notFound, badRequest } from '../lib/http';
import { addDays, dateString, fromDbDate, timeString, toDbDate, todayIn, weekdayOf, zonedToUtc } from '../lib/dates';
import { pokeScheduler } from '../scheduler/wake';
import { ALARM_ACTIONS, isPushConfigured, sendPushToUser, vapidPublicKey, type PushPayload } from './push.service';

// ───────────────────────────── Pure scheduling core ─────────────────────────────

/** Days searched ahead when looking for the next trigger. */
export const SEARCH_DAYS = 14;

export interface SchedulableReminder {
  enabled: boolean;
  time: string; // 'HH:mm' local
  weekdays: number[]; // empty = every day
  oneTimeDate: Date | string | null; // DATE column or 'YYYY-MM-DD'
  dayType: DayType;
}

export interface TriggerContext {
  timezone: string;
  gymWeekdays: number[];
  now: Date;
  /** Per-date GYM/REST overrides (DailyLog.dayType), keyed by 'YYYY-MM-DD'. */
  dayTypeOverrides?: Record<string, 'GYM' | 'REST'>;
}

const toDateStr = (d: Date | string) => (typeof d === 'string' ? d : fromDbDate(d));

/** GYM/REST for a local date given overrides + gym weekdays (pure mirror of getDayType). */
export function dayTypeFor(date: string, gymWeekdays: number[], overrides?: Record<string, 'GYM' | 'REST'>): 'GYM' | 'REST' {
  return overrides?.[date] ?? (gymWeekdays.includes(weekdayOf(date)) ? 'GYM' : 'REST');
}

/** Whether a recurring reminder applies on a local date. */
export function reminderAppliesOn(reminder: SchedulableReminder, date: string, gymWeekdays: number[], overrides?: Record<string, 'GYM' | 'REST'>): boolean {
  if (reminder.weekdays.length > 0 && !reminder.weekdays.includes(weekdayOf(date))) return false;
  if (reminder.dayType !== 'ANY' && dayTypeFor(date, gymWeekdays, overrides) !== reminder.dayType) return false;
  return true;
}

/**
 * Next UTC instant strictly after `now` at which the reminder should fire, or null.
 *  - disabled → null
 *  - oneTimeDate → that date at `time` if still in the future, else null (day type is ignored: the date was chosen explicitly)
 *  - recurring → first local date (today … today+14) matching weekdays (empty = every day) and day type
 * Wall-clock → instant conversion uses zonedToUtc, so DST transitions are handled per date.
 */
export function computeNextTrigger(reminder: SchedulableReminder, ctx: TriggerContext): Date | null {
  if (!reminder.enabled) return null;
  const nowMs = ctx.now.getTime();
  if (reminder.oneTimeDate) {
    const at = zonedToUtc(toDateStr(reminder.oneTimeDate), reminder.time, ctx.timezone);
    return at.getTime() > nowMs ? at : null;
  }
  // Start one day back so an instant just after local midnight in a far-behind zone is still covered.
  const start = addDays(todayIn(ctx.timezone, ctx.now), -1);
  for (let i = 0; i <= SEARCH_DAYS + 1; i++) {
    const date = addDays(start, i);
    if (!reminderAppliesOn(reminder, date, ctx.gymWeekdays, ctx.dayTypeOverrides)) continue;
    const at = zonedToUtc(date, reminder.time, ctx.timezone);
    if (at.getTime() > nowMs) return at;
  }
  return null;
}

// ───────────────────────────── User context ─────────────────────────────

export interface UserScheduleContext {
  timezone: string;
  gymWeekdays: number[];
  notificationsEnabled: boolean;
  defaultSnoozeMinutes: number;
}

export async function getUserScheduleContext(userId: string, db: Db = prisma): Promise<UserScheduleContext> {
  const s = await db.userSettings.findUnique({ where: { userId } });
  return {
    timezone: s?.timezone ?? env.DEFAULT_TIMEZONE,
    gymWeekdays: s?.gymWeekdays ?? [1, 2, 3, 4, 5, 6],
    notificationsEnabled: s?.notificationsEnabled ?? true,
    defaultSnoozeMinutes: s?.defaultSnoozeMinutes ?? 10,
  };
}

/** GYM/REST overrides from DailyLog for the scheduling window around `now`. */
export async function loadDayTypeOverrides(userId: string, timezone: string | null, now: Date, db: Db = prisma): Promise<Record<string, 'GYM' | 'REST'>> {
  // Without a timezone, widen the window by a day on each side of the UTC date (covers every zone).
  const today = todayIn(timezone ?? 'UTC', now);
  const margin = timezone ? 1 : 2;
  const logs = await db.dailyLog.findMany({
    where: { userId, dayType: { in: ['GYM', 'REST'] }, date: { gte: toDbDate(addDays(today, -margin)), lte: toDbDate(addDays(today, SEARCH_DAYS + margin)) } },
    select: { date: true, dayType: true },
  });
  const out: Record<string, 'GYM' | 'REST'> = {};
  for (const l of logs) if (l.dayType === 'GYM' || l.dayType === 'REST') out[fromDbDate(l.date)] = l.dayType;
  return out;
}

/** Settings + day-type overrides, loaded in parallel (one round trip). */
export async function triggerContextFor(userId: string, now = new Date(), db: Db = prisma): Promise<TriggerContext & UserScheduleContext> {
  const [ctx, dayTypeOverrides] = await Promise.all([getUserScheduleContext(userId, db), loadDayTypeOverrides(userId, null, now, db)]);
  return { ...ctx, now, dayTypeOverrides };
}

/** Recomputes and stores nextTriggerAt for a set of reminders of one user. */
export async function recomputeReminders(userId: string, where: Prisma.ReminderWhereInput = {}, db: Db = prisma, now = new Date()) {
  const [ctx, reminders] = await Promise.all([triggerContextFor(userId, now, db), db.reminder.findMany({ where: { userId, ...where } })]);
  const changed = reminders
    .map((r) => ({ id: r.id, next: computeNextTrigger(r, ctx), prev: r.nextTriggerAt }))
    .filter((c) => c.next?.getTime() !== c.prev?.getTime());
  if (changed.length) {
    // One statement instead of one UPDATE per reminder: matters on high-latency database links.
    const ids = changed.map((c) => c.id);
    const nexts = changed.map((c) => c.next?.toISOString() ?? null);
    await db.$executeRaw`
      UPDATE "Reminder" AS r
      SET "nextTriggerAt" = v.next::timestamptz, "updatedAt" = now()
      FROM unnest(${ids}::uuid[], ${nexts}::text[]) AS v(id, next)
      WHERE r.id = v.id AND r."userId" = ${userId}::uuid`;
    const earliest = changed.reduce<Date | null>((m, c) => (c.next && (!m || c.next < m) ? c.next : m), null);
    pokeScheduler(earliest);
  }
  return reminders.length;
}

const scheduleListeners = new Set<(userId: string) => void>();

/** Register a callback run whenever a user's schedule inputs change (used to drop in-process caches). */
export function onUserScheduleChanged(fn: (userId: string) => void) {
  scheduleListeners.add(fn);
}

/** Call after a user's timezone / gym weekdays / day-type overrides change. */
export async function recomputeUserReminders(userId: string, db: Db = prisma) {
  for (const fn of scheduleListeners) fn(userId);
  return recomputeReminders(userId, { enabled: true }, db);
}

// ───────────────────────────── Validation ─────────────────────────────

const weekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .refine((a) => new Set(a).size === a.length, 'Weekdays must be unique');

export const snoozeMinutesSchema = z.number().int().min(1, 'Snooze must be 1–120 minutes').max(120, 'Snooze must be 1–120 minutes');

export const reminderCreateSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(120),
    description: z.string().trim().max(1000).nullish(),
    category: z.nativeEnum(ActivityCategory).default('CUSTOM'),
    time: timeString,
    weekdays: weekdaysSchema.default([]),
    oneTimeDate: dateString.nullish(),
    dayType: z.nativeEnum(DayType).default('ANY'),
    enabled: z.boolean().default(true),
    snoozeMinutes: snoozeMinutesSchema.optional(),
    sound: z.boolean().default(true),
  })
  .refine((v) => !(v.oneTimeDate && v.weekdays.length > 0), { message: 'Choose either repeat weekdays or a one-time date, not both', path: ['oneTimeDate'] });

export const reminderUpdateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120).optional(),
  description: z.string().trim().max(1000).nullish(),
  category: z.nativeEnum(ActivityCategory).optional(),
  time: timeString.optional(),
  weekdays: weekdaysSchema.optional(),
  oneTimeDate: dateString.nullish(),
  dayType: z.nativeEnum(DayType).optional(),
  enabled: z.boolean().optional(),
  snoozeMinutes: snoozeMinutesSchema.optional(),
  sound: z.boolean().optional(),
});

export type ReminderCreateInput = z.infer<typeof reminderCreateSchema>;
export type ReminderUpdateInput = z.infer<typeof reminderUpdateSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

type ReminderWithLast = Reminder & { occurrences?: ReminderOccurrence[] };

export function reminderDto(r: ReminderWithLast) {
  const last = r.occurrences?.[0];
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    category: r.category,
    time: r.time,
    weekdays: r.weekdays,
    oneTimeDate: r.oneTimeDate ? fromDbDate(r.oneTimeDate) : null,
    dayType: r.dayType,
    enabled: r.enabled,
    snoozeMinutes: r.snoozeMinutes,
    sound: r.sound,
    lastTriggeredAt: r.lastTriggeredAt,
    nextTriggerAt: r.nextTriggerAt,
    routineItemId: r.routineItemId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    lastOccurrence: last ? { id: last.id, status: last.status, scheduledFor: last.scheduledFor, actedAt: last.actedAt } : null,
  };
}

type OccurrenceWithReminder = ReminderOccurrence & {
  reminder: Pick<Reminder, 'id' | 'title' | 'description' | 'category' | 'time' | 'sound' | 'snoozeMinutes' | 'routineItemId'>;
  deliveries?: { channel: string; status: string; statusCode: number | null; error: string | null; createdAt: Date; subscriptionId: string | null }[];
};

export function occurrenceDto(o: OccurrenceWithReminder) {
  const inApp = o.deliveries?.find((d) => d.channel === 'IN_APP');
  return {
    id: o.id,
    reminderId: o.reminderId,
    scheduledFor: o.scheduledFor,
    status: o.status,
    firedAt: o.firedAt,
    actedAt: o.actedAt,
    snoozedUntil: o.snoozedUntil,
    /** When the occurrence should ring now: snoozedUntil for snoozed ones, else scheduledFor. */
    dueAt: o.status === 'SNOOZED' && o.snoozedUntil ? o.snoozedUntil : o.scheduledFor,
    inAppShownAt: inApp?.createdAt ?? null,
    reminder: {
      id: o.reminder.id,
      title: o.reminder.title,
      description: o.reminder.description,
      category: o.reminder.category,
      time: o.reminder.time,
      sound: o.reminder.sound,
      snoozeMinutes: o.reminder.snoozeMinutes,
      routineItemId: o.reminder.routineItemId,
    },
  };
}

const reminderSelect = { id: true, title: true, description: true, category: true, time: true, sound: true, snoozeMinutes: true, routineItemId: true } as const;

// ───────────────────────────── CRUD ─────────────────────────────

const lastOccurrenceInclude = { occurrences: { orderBy: { scheduledFor: 'desc' as const }, take: 1 } };

export async function listReminders(userId: string) {
  const rows = await prisma.reminder.findMany({
    where: { userId },
    include: lastOccurrenceInclude,
    orderBy: [{ time: 'asc' }, { title: 'asc' }],
  });
  return rows.map(reminderDto);
}

export async function getReminder(userId: string, id: string, db: Db = prisma) {
  const r = await db.reminder.findFirst({ where: { id, userId }, include: lastOccurrenceInclude });
  if (!r) throw notFound('Reminder');
  return r;
}

function assertSchedulable(r: SchedulableReminder, next: Date | null) {
  if (r.enabled && !next) {
    if (r.oneTimeDate) throw badRequest('The one-time date and time are in the past. Pick a future date or time.');
    throw badRequest('This reminder never fires in the next two weeks with these weekday / gym-day settings.');
  }
}

export async function createReminder(userId: string, input: ReminderCreateInput) {
  const ctx = await triggerContextFor(userId);
  const data = {
    title: input.title,
    description: input.description ?? null,
    category: input.category,
    time: input.time,
    weekdays: [...input.weekdays].sort((a, b) => a - b),
    oneTimeDate: input.oneTimeDate ? toDbDate(input.oneTimeDate) : null,
    dayType: input.oneTimeDate ? ('ANY' as const) : input.dayType,
    enabled: input.enabled,
    snoozeMinutes: input.snoozeMinutes ?? ctx.defaultSnoozeMinutes,
    sound: input.sound,
  };
  const next = computeNextTrigger(data, ctx);
  assertSchedulable(data, next);
  // A new reminder has no occurrences yet: skip the relation load (saves a round trip).
  const r = await prisma.reminder.create({ data: { ...data, userId, nextTriggerAt: next } });
  pokeScheduler(next);
  return reminderDto({ ...r, occurrences: [] });
}

export async function updateReminder(userId: string, id: string, input: ReminderUpdateInput) {
  const [existing, ctx] = await Promise.all([prisma.reminder.findFirst({ where: { id, userId } }), triggerContextFor(userId)]);
  if (!existing) throw notFound('Reminder');
  const merged = {
    title: input.title ?? existing.title,
    description: input.description === undefined ? existing.description : input.description,
    category: input.category ?? existing.category,
    time: input.time ?? existing.time,
    weekdays: input.weekdays ? [...input.weekdays].sort((a, b) => a - b) : existing.weekdays,
    oneTimeDate: input.oneTimeDate === undefined ? existing.oneTimeDate : input.oneTimeDate ? toDbDate(input.oneTimeDate) : null,
    dayType: input.dayType ?? existing.dayType,
    enabled: input.enabled ?? existing.enabled,
    snoozeMinutes: input.snoozeMinutes ?? existing.snoozeMinutes,
    sound: input.sound ?? existing.sound,
  };
  if (merged.oneTimeDate && merged.weekdays.length > 0) {
    if (input.oneTimeDate) merged.weekdays = [];
    else merged.oneTimeDate = null;
  }
  if (merged.oneTimeDate) merged.dayType = 'ANY';
  const next = computeNextTrigger(merged, ctx);
  const scheduleChanged =
    input.time !== undefined || input.weekdays !== undefined || input.oneTimeDate !== undefined || input.dayType !== undefined || input.enabled === true;
  if (scheduleChanged) assertSchedulable(merged, next);
  const r = await prisma.reminder.update({ where: { id }, data: { ...merged, nextTriggerAt: next }, include: lastOccurrenceInclude });
  pokeScheduler(next);
  return reminderDto(r);
}

export async function setReminderEnabled(userId: string, id: string, enabled: boolean) {
  return updateReminder(userId, id, { enabled });
}

export async function deleteReminder(userId: string, id: string) {
  const { count } = await prisma.reminder.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound('Reminder');
}

/**
 * Next upcoming enabled reminder (by nextTriggerAt). `withLast: false` skips loading the last occurrence
 * (a second, sequential query) and returns `lastOccurrence: null` — used by the alarm summary poll.
 */
export async function nextReminder(userId: string, now = new Date(), opts: { withLast?: boolean } = {}) {
  const where = { userId, enabled: true, nextTriggerAt: { gt: now } };
  const orderBy = { nextTriggerAt: 'asc' as const };
  if (opts.withLast === false) {
    const r = await prisma.reminder.findFirst({ where, orderBy });
    return r ? reminderDto({ ...r, occurrences: [] }) : null;
  }
  const r = await prisma.reminder.findFirst({ where, orderBy, include: lastOccurrenceInclude });
  return r ? reminderDto(r) : null;
}

// ───────────────────────────── Occurrences ─────────────────────────────

const OVERDUE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Open (fired / snoozed and due) occurrences of the last 24 h plus today's overdue routine entries.
 * Both queries run in parallel; pass `timezone` (from the session) to avoid a settings lookup.
 */
export async function overdue(userId: string, now = new Date(), timezone?: string) {
  const since = new Date(now.getTime() - OVERDUE_WINDOW_MS);
  const tz = timezone ?? (await getUserScheduleContext(userId)).timezone;
  const today = todayIn(tz, now);
  const [occ, entries] = await Promise.all([
    prisma.reminderOccurrence.findMany({
      where: {
        userId,
        OR: [
          { status: { in: ['PENDING', 'SENT'] }, scheduledFor: { gte: since, lte: now } },
          { status: 'SNOOZED', snoozedUntil: { gte: since, lte: now } },
        ],
      },
      include: { reminder: { select: reminderSelect }, deliveries: { where: { channel: 'IN_APP' } } },
      orderBy: { scheduledFor: 'asc' },
    }),
    overdueRoutineEntries(userId, today, now),
  ]);
  return {
    occurrences: occ.map(occurrenceDto),
    routineEntries: entries.map((e) => ({
      id: e.id,
      date: fromDbDate(e.date),
      title: e.title,
      category: e.category,
      scheduledTime: e.scheduledTime,
      scheduledAt: e.scheduledAt,
      status: e.status,
      snoozedUntil: e.snoozedUntil,
      routineItemId: e.routineItemId,
    })),
  };
}

function overdueRoutineEntries(userId: string, today: string, now: Date) {
  return prisma.dailyRoutineEntry.findMany({
    where: {
      userId,
      date: toDbDate(today),
      OR: [
        { status: 'PENDING', scheduledAt: { lte: now } },
        { status: 'SNOOZED', snoozedUntil: { lte: now } },
      ],
    },
    orderBy: [{ scheduledAt: 'asc' }, { sortOrder: 'asc' }],
  });
}

/**
 * Everything the always-mounted AlarmProvider needs in one request: next alarm, overdue items and
 * push configuration. All queries run in one parallel wave.
 */
export async function alarmSummary(userId: string, timezone: string, now = new Date()) {
  const [next, od] = await Promise.all([nextReminder(userId, now, { withLast: false }), overdue(userId, now, timezone)]);
  return { next, overdue: od, pushConfigured: isPushConfigured(), vapidPublicKey: vapidPublicKey() };
}

// ───────────── Occurrence actions: one SQL statement (one round trip) each ─────────────

type OccAction = 'complete' | 'dismiss' | 'snooze';

interface OccActionRow {
  id: string;
  reminderId: string;
  scheduledFor: Date;
  status: ReminderOccurrence['status'];
  firedAt: Date | null;
  actedAt: Date | null;
  snoozedUntil: Date | null;
  title: string;
  description: string | null;
  category: ActivityCategory;
  time: string;
  sound: boolean;
  snoozeMinutes: number;
  routineItemId: string | null;
  inAppShownAt: Date | null;
  updated: boolean;
  newSnoozedUntil: Date | null;
}

/**
 * Loads the occurrence (scoped to the user), applies the action and — for routine-linked reminders —
 * updates the matching DailyRoutineEntry of that local day, all in one statement. Data-modifying CTEs
 * see the pre-update snapshot in `o`, so the returned row carries the previous status for error handling.
 */
async function actOnOccurrence(userId: string, id: string, action: OccAction, now: Date, minutes?: number) {
  const tz = env.DEFAULT_TIMEZONE;
  const occUpdate =
    action === 'complete'
      ? Prisma.sql`UPDATE "ReminderOccurrence" ro SET status = 'COMPLETED', "actedAt" = ${now}, "updatedAt" = now()
          FROM o WHERE ro.id = o.id AND o.status <> 'COMPLETED' RETURNING ro.id, ro."snoozedUntil"`
      : action === 'dismiss'
        ? Prisma.sql`UPDATE "ReminderOccurrence" ro SET status = 'DISMISSED', "actedAt" = ${now}, "updatedAt" = now()
          FROM o WHERE ro.id = o.id AND o.status NOT IN ('COMPLETED', 'DISMISSED') RETURNING ro.id, ro."snoozedUntil"`
        : Prisma.sql`UPDATE "ReminderOccurrence" ro SET status = 'SNOOZED', "snoozedUntil" = o."snoozeUntil", "actedAt" = ${now}, "updatedAt" = now()
          FROM o WHERE ro.id = o.id AND o.status NOT IN ('COMPLETED', 'DISMISSED') RETURNING ro.id, ro."snoozedUntil"`;
  const entryUpdate =
    action === 'complete'
      ? Prisma.sql`, ent AS (
          UPDATE "DailyRoutineEntry" e SET status = 'COMPLETED', "completedAt" = ${now}, "snoozedUntil" = NULL, "updatedAt" = now()
          FROM o WHERE o."routineItemId" IS NOT NULL AND e."userId" = ${userId}::uuid AND e."routineItemId" = o."routineItemId"
            AND e.date = o."localDate" AND e.status <> 'COMPLETED'
          RETURNING e.id)`
      : action === 'snooze'
        ? Prisma.sql`, ent AS (
          UPDATE "DailyRoutineEntry" e SET status = 'SNOOZED', "snoozedUntil" = o."snoozeUntil", "updatedAt" = now()
          FROM o WHERE o."routineItemId" IS NOT NULL AND o.status NOT IN ('COMPLETED', 'DISMISSED') AND e."userId" = ${userId}::uuid
            AND e."routineItemId" = o."routineItemId" AND e.date = o."localDate" AND e.status IN ('PENDING', 'SNOOZED')
          RETURNING e.id)`
        : Prisma.empty;
  const rows = await prisma.$queryRaw<OccActionRow[]>`
    WITH o AS (
      SELECT ro.id, ro."reminderId", ro."scheduledFor", ro.status::text AS status, ro."firedAt", ro."actedAt", ro."snoozedUntil",
             r.title, r.description, r.category::text AS category, r.time, r.sound, r."snoozeMinutes", r."routineItemId",
             (ro."scheduledFor" AT TIME ZONE COALESCE(s.timezone, ${tz}))::date AS "localDate",
             ${now}::timestamptz + make_interval(mins => COALESCE(${minutes ?? null}::int, r."snoozeMinutes")) AS "snoozeUntil",
             (SELECT max(d."createdAt") FROM "NotificationDeliveryLog" d WHERE d."occurrenceId" = ro.id AND d.channel = 'IN_APP') AS "inAppShownAt"
      FROM "ReminderOccurrence" ro
      JOIN "Reminder" r ON r.id = ro."reminderId"
      LEFT JOIN "UserSettings" s ON s."userId" = ro."userId"
      WHERE ro.id = ${id}::uuid AND ro."userId" = ${userId}::uuid
    ), upd AS (${occUpdate})${entryUpdate}
    SELECT o.id, o."reminderId", o."scheduledFor", o.status, o."firedAt", o."actedAt", o."snoozedUntil",
           o.title, o.description, o.category, o.time, o.sound, o."snoozeMinutes", o."routineItemId", o."inAppShownAt",
           (upd.id IS NOT NULL) AS updated, upd."snoozedUntil" AS "newSnoozedUntil"
    FROM o LEFT JOIN upd ON true`;
  const row = rows[0];
  if (!row) throw notFound('Occurrence');
  return row;
}

function actedDto(row: OccActionRow, status: ReminderOccurrence['status'], actedAt: Date | null, snoozedUntil: Date | null) {
  return occurrenceDto({
    id: row.id,
    reminderId: row.reminderId,
    userId: '',
    scheduledFor: row.scheduledFor,
    status,
    firedAt: row.firedAt,
    actedAt,
    snoozedUntil,
    createdAt: row.scheduledFor,
    updatedAt: actedAt ?? row.scheduledFor,
    reminder: {
      id: row.reminderId,
      title: row.title,
      description: row.description,
      category: row.category,
      time: row.time,
      sound: row.sound,
      snoozeMinutes: row.snoozeMinutes,
      routineItemId: row.routineItemId,
    },
    deliveries: row.inAppShownAt
      ? [{ channel: 'IN_APP', status: 'SENT', statusCode: null, error: null, createdAt: row.inAppShownAt, subscriptionId: null }]
      : [],
  });
}

export async function completeOccurrence(userId: string, id: string, now = new Date()) {
  const row = await actOnOccurrence(userId, id, 'complete', now);
  return actedDto(row, 'COMPLETED', row.updated ? now : row.actedAt, row.snoozedUntil);
}

export async function dismissOccurrence(userId: string, id: string, now = new Date()) {
  const row = await actOnOccurrence(userId, id, 'dismiss', now);
  if (row.status === 'COMPLETED') throw conflict('This reminder was already completed');
  return actedDto(row, 'DISMISSED', row.updated ? now : row.actedAt, row.snoozedUntil);
}

export async function snoozeOccurrence(userId: string, id: string, minutes: number | undefined, now = new Date()) {
  const row = await actOnOccurrence(userId, id, 'snooze', now, minutes);
  if (row.status === 'COMPLETED' || row.status === 'DISMISSED') throw conflict(`This reminder was already ${row.status.toLowerCase()}`);
  pokeScheduler(row.newSnoozedUntil);
  return actedDto(row, 'SNOOZED', now, row.newSnoozedUntil);
}

const occurrenceInclude = { reminder: { select: reminderSelect }, deliveries: { where: { channel: 'IN_APP' as const } } };

/**
 * Called by an open app tab when its in-page timer reaches a reminder's nextTriggerAt, so the
 * in-app alarm can ring on time (the scheduler may run up to one interval later). Creates the
 * occurrence as PENDING (idempotent via the unique key); the scheduler still claims it and sends push.
 */
export async function ringReminder(userId: string, id: string, scheduledFor: Date, now = new Date()) {
  const [r, existing] = await Promise.all([
    prisma.reminder.findFirst({ where: { id, userId }, select: { enabled: true, nextTriggerAt: true } }),
    prisma.reminderOccurrence.findFirst({ where: { reminderId: id, userId, scheduledFor }, include: occurrenceInclude }),
  ]);
  if (!r) throw notFound('Reminder');
  if (existing) return occurrenceDto(existing);
  const matchesNext = r.enabled && r.nextTriggerAt?.getTime() === scheduledFor.getTime();
  const delta = now.getTime() - scheduledFor.getTime();
  if (!matchesNext) throw conflict('This reminder is not scheduled for that time');
  if (delta < -60_000 || delta > 30 * 60_000) throw conflict('This reminder is not due yet');
  // Upsert keeps it idempotent if the scheduler created the row in the meantime.
  const o = await prisma.reminderOccurrence.upsert({
    where: { reminderId_scheduledFor: { reminderId: id, scheduledFor } },
    create: { reminderId: id, userId, scheduledFor, status: 'PENDING' },
    update: {},
    include: occurrenceInclude,
  });
  return occurrenceDto(o);
}

/** Pass `timezone` (from the session) to skip the settings lookup. */
export async function history(userId: string, q: { from?: string; to?: string; page: number; pageSize: number }, timezone?: string) {
  const tz = timezone ?? (await getUserScheduleContext(userId)).timezone;
  const where: Prisma.ReminderOccurrenceWhereInput = { userId };
  if (q.from || q.to) {
    where.scheduledFor = {
      ...(q.from ? { gte: zonedToUtc(q.from, '00:00', tz) } : {}),
      ...(q.to ? { lt: zonedToUtc(addDays(q.to, 1), '00:00', tz) } : {}),
    };
  }
  // Flat queries in two parallel waves (nested includes would cost one sequential round trip per level).
  const [total, page, subs] = await Promise.all([
    prisma.reminderOccurrence.count({ where }),
    prisma.reminderOccurrence.findMany({ where, orderBy: { scheduledFor: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    prisma.pushSubscription.findMany({ where: { userId }, select: { id: true, userAgent: true } }),
  ]);
  const [reminders, deliveries] = page.length
    ? await Promise.all([
        prisma.reminder.findMany({ where: { id: { in: [...new Set(page.map((o) => o.reminderId))] } }, select: reminderSelect }),
        prisma.notificationDeliveryLog.findMany({ where: { occurrenceId: { in: page.map((o) => o.id) } }, orderBy: { createdAt: 'asc' } }),
      ])
    : [[], []];
  const reminderById = new Map(reminders.map((r) => [r.id, r]));
  const rows = page.map((o) => ({ ...o, reminder: reminderById.get(o.reminderId)!, deliveries: deliveries.filter((d) => d.occurrenceId === o.id) }));
  const deviceById = new Map(subs.map((x) => [x.id, x.userAgent]));
  return {
    total,
    items: rows.map((o) => ({
      ...occurrenceDto(o),
      deliveries: o.deliveries.map((d) => ({
        id: d.id,
        channel: d.channel,
        status: d.status,
        statusCode: d.statusCode,
        error: d.error,
        createdAt: d.createdAt,
        subscriptionId: d.subscriptionId,
        device: d.subscriptionId ? (deviceById.get(d.subscriptionId) ?? null) : null,
      })),
    })),
  };
}

// ───────────────────────────── Payloads ─────────────────────────────

export function alarmPayload(
  r: Pick<Reminder, 'id' | 'title' | 'description' | 'category' | 'time'>,
  occurrenceId: string | null,
  opts: { test?: boolean; snoozed?: boolean } = {},
): PushPayload {
  const body = r.description?.trim() || (opts.snoozed ? `Snoozed reminder · ${r.time}` : `Scheduled for ${r.time}`);
  return {
    title: opts.test ? `Test: ${r.title}` : r.title,
    body,
    tag: occurrenceId ?? `test-${r.id}`,
    url: occurrenceId ? `/alarms?occurrence=${occurrenceId}` : '/alarms',
    category: r.category,
    reminderId: r.id,
    occurrenceId,
    requireInteraction: !opts.test,
    actions: occurrenceId ? ALARM_ACTIONS : [],
    test: opts.test ?? false,
  };
}

/** POST /reminders/:id/test — immediate TEST push + the payload the app shows in-page. */
export async function testReminder(userId: string, id: string) {
  const r = await getReminder(userId, id);
  const payload = alarmPayload(r, null, { test: true });
  const deliveries = await sendPushToUser(payload, { userId, reminderId: r.id, channel: 'TEST' });
  return { payload, deliveries };
}
