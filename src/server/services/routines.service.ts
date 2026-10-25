import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ActivityCategory, DayType, Prisma, type DailyRoutineEntry, type RoutineItem, type RoutineTemplate } from '@prisma/client';
import { prisma, type Db } from '../db';
import { env } from '../env';
import { badRequest, notFound } from '../lib/http';
import { fromDbDate, timeString, toDbDate, todayIn, weekdayOf } from '../lib/dates';
import { getDayType } from './dayContext';
import { pokeScheduler } from '../scheduler/wake';
import { computeNextTrigger, getUserScheduleContext, onUserScheduleChanged, snoozeMinutesSchema, triggerContextFor } from './reminders.service';

/**
 * Daily routine: reusable templates (Gym day / Rest day / custom weekdays) → per-day snapshot rows.
 *
 * History policy:
 *  - DailyRoutineEntry rows snapshot title / category / time when materialised.
 *  - Editing a template item refreshes only PENDING entries dated today or later, and only the fields
 *    the user has not overridden for that day (a per-day time change is kept). Past rows are never rewritten.
 *  - Dates before today are never back-filled from the current templates; they only show what was recorded.
 */

export interface DayCtx {
  timezone: string;
  gymWeekdays: number[];
}


/** Whether a template applies to a date with the given GYM/REST day type. */
export function templateAppliesOn(t: Pick<RoutineTemplate, 'isActive' | 'weekdays' | 'dayType'>, date: string, dayType: 'GYM' | 'REST'): boolean {
  if (!t.isActive) return false;
  if (t.weekdays.length > 0) return t.weekdays.includes(weekdayOf(date));
  return t.dayType === 'ANY' || t.dayType === dayType;
}

/**
 * In-process memo of (user, date, schedule) combinations materialised recently, so repeated views of
 * the same day (routine page, dashboard, polling) skip the INSERT round trip. Invalidated whenever the
 * user's templates/items change, entries are dropped, or their schedule (day-type overrides) changes.
 */
const MATERIALISED_TTL_MS = 5 * 60_000;
const materialised = new Map<string, number>();

function memoKey(userId: string, date: string, ctx: DayCtx) {
  return `${userId}|${date}|${ctx.timezone}|${ctx.gymWeekdays.join(',')}`;
}

/** Forget memoised materialisations for a user (after template/item/day-type changes). */
export function invalidateRoutineDays(userId: string) {
  const prefix = `${userId}|`;
  for (const k of materialised.keys()) if (k.startsWith(prefix)) materialised.delete(k);
}

onUserScheduleChanged(invalidateRoutineDays);

/**
 * Idempotently materialises DailyRoutineEntry rows for `date` in ONE SQL statement:
 * INSERT … SELECT from the user's active templates that apply to the date (weekdays, else GYM/REST via the
 * DailyLog override or gym weekdays) … ON CONFLICT (userId, date, routineItemId) DO NOTHING.
 * Dates before today in the user's timezone are not back-filled. Returns the number of rows created.
 */
export async function ensureDailyRoutineEntries(userId: string, date: string, ctx: DayCtx, db: Db = prisma, now = new Date()) {
  if (date < todayIn(ctx.timezone, now)) return 0;
  const key = memoKey(userId, date, ctx);
  const at = materialised.get(key);
  if (at !== undefined && now.getTime() - at < MATERIALISED_TTL_MS && now.getTime() >= at) return 0;
  const weekday = weekdayOf(date);
  const defaultDayType = ctx.gymWeekdays.includes(weekday) ? 'GYM' : 'REST';
  const count = await db.$executeRaw`
    INSERT INTO "DailyRoutineEntry"
      (id, "userId", date, "routineItemId", title, category, "scheduledTime", "scheduledAt", "sortOrder", status, "createdAt", "updatedAt")
    SELECT gen_random_uuid(), ${userId}::uuid, ${date}::date, i.id, i.title, i.category, i.time,
           ((${date}::date + i.time::time) AT TIME ZONE ${ctx.timezone}), i."sortOrder", 'PENDING'::"RoutineStatus", now(), now()
    FROM "RoutineItem" i
    JOIN "RoutineTemplate" t ON t.id = i."templateId"
    WHERE t."userId" = ${userId}::uuid AND t."isActive"
      AND CASE
        WHEN cardinality(t.weekdays) > 0 THEN ${weekday}::int = ANY (t.weekdays)
        ELSE t."dayType" = 'ANY' OR t."dayType"::text = COALESCE(
          (SELECT l."dayType"::text FROM "DailyLog" l
            WHERE l."userId" = ${userId}::uuid AND l.date = ${date}::date AND l."dayType" IN ('GYM', 'REST')),
          ${defaultDayType})
      END
    ON CONFLICT ("userId", date, "routineItemId") DO NOTHING`;
  if (materialised.size > 5000) materialised.clear();
  materialised.set(key, now.getTime());
  return count;
}

// ───────────────────────────── Day view ─────────────────────────────

export function entryDto(e: DailyRoutineEntry) {
  return {
    id: e.id,
    date: fromDbDate(e.date),
    routineItemId: e.routineItemId,
    title: e.title,
    category: e.category,
    scheduledTime: e.scheduledTime,
    scheduledAt: e.scheduledAt,
    sortOrder: e.sortOrder,
    status: e.status,
    completedAt: e.completedAt,
    snoozedUntil: e.snoozedUntil,
    skipReason: e.skipReason,
    notes: e.notes,
  };
}

export function dayProgress(entries: Pick<DailyRoutineEntry, 'status'>[]) {
  const count = (s: string) => entries.filter((e) => e.status === s).length;
  const total = entries.length;
  const completed = count('COMPLETED');
  return {
    total,
    completed,
    skipped: count('SKIPPED'),
    missed: count('MISSED'),
    pending: count('PENDING') + count('SNOOZED'),
    percent: total === 0 ? null : Math.round((completed / total) * 100),
  };
}

export async function getDay(userId: string, date: string, ctx: DayCtx) {
  await ensureDailyRoutineEntries(userId, date, ctx);
  const [entries, dayType] = await Promise.all([
    prisma.dailyRoutineEntry.findMany({ where: { userId, date: toDbDate(date) }, orderBy: [{ scheduledAt: 'asc' }, { sortOrder: 'asc' }] }),
    getDayType(userId, date, ctx.gymWeekdays),
  ]);
  return { date, dayType, entries: entries.map(entryDto), progress: dayProgress(entries) };
}

export const entryUpdateSchema = z
  .object({
    status: z.enum(['PENDING', 'COMPLETED', 'SKIPPED', 'MISSED']).optional(),
    skipReason: z.string().trim().max(500).nullish(),
    notes: z.string().trim().max(1000).nullish(),
    scheduledTime: timeString.optional(),
    snoozeMinutes: snoozeMinutesSchema.optional(),
  })
  .refine((v) => !(v.status && v.snoozeMinutes), 'Send either a status or snoozeMinutes, not both');

/**
 * Updates one entry in ONE SQL statement (one round trip): ownership via userId, the per-day time is
 * converted with the entry's own date, and — when the entry is completed or skipped — the linked
 * reminder occurrences of that local day are settled in a data-modifying CTE.
 * Pass `timezone` (from the session) to skip the settings lookup.
 */
export async function updateEntry(userId: string, id: string, input: z.infer<typeof entryUpdateSchema>, now = new Date(), timezone?: string) {
  const tz = timezone ?? (await getUserScheduleContext(userId)).timezone;
  const sets: Prisma.Sql[] = [Prisma.sql`"updatedAt" = now()`];
  if (input.notes !== undefined) sets.push(Prisma.sql`notes = ${input.notes || null}`);
  if (input.scheduledTime) {
    sets.push(Prisma.sql`"scheduledTime" = ${input.scheduledTime}`);
    sets.push(Prisma.sql`"scheduledAt" = ((e.date + ${input.scheduledTime}::time) AT TIME ZONE ${tz})`);
  }
  if (input.snoozeMinutes) {
    sets.push(Prisma.sql`status = 'SNOOZED'::"RoutineStatus"`);
    sets.push(Prisma.sql`"snoozedUntil" = ${new Date(now.getTime() + input.snoozeMinutes * 60_000)}`);
  }
  if (input.status) {
    sets.push(Prisma.sql`status = ${input.status}::"RoutineStatus"`);
    sets.push(Prisma.sql`"completedAt" = ${input.status === 'COMPLETED' ? now : null}::timestamptz`);
    sets.push(Prisma.sql`"snoozedUntil" = NULL`);
    sets.push(Prisma.sql`"skipReason" = ${input.status === 'SKIPPED' ? input.skipReason || null : null}`);
  } else if (input.skipReason !== undefined) {
    sets.push(Prisma.sql`"skipReason" = CASE WHEN e.status = 'SKIPPED' THEN ${input.skipReason || null} ELSE e."skipReason" END`);
  }
  const guard = input.snoozeMinutes ? Prisma.sql`AND e.status IN ('PENDING', 'SNOOZED')` : Prisma.empty;
  const settle =
    input.status === 'COMPLETED' || input.status === 'SKIPPED'
      ? Prisma.sql`, occ AS (
          UPDATE "ReminderOccurrence" ro SET status = 'COMPLETED', "actedAt" = ${now}, "updatedAt" = now()
          FROM upd, "Reminder" r
          WHERE upd."routineItemId" IS NOT NULL AND r.id = ro."reminderId" AND r."routineItemId" = upd."routineItemId"
            AND ro."userId" = ${userId}::uuid AND ro.status IN ('PENDING', 'SENT', 'SNOOZED')
            AND ro."scheduledFor" >= (upd.date::timestamp AT TIME ZONE ${tz})
            AND ro."scheduledFor" < ((upd.date + 1)::timestamp AT TIME ZONE ${tz})
          RETURNING ro.id)`
      : Prisma.empty;
  const rows = await prisma.$queryRaw<DailyRoutineEntry[]>`
    WITH upd AS (
      UPDATE "DailyRoutineEntry" e SET ${Prisma.join(sets, ', ')}
      WHERE e.id = ${id}::uuid AND e."userId" = ${userId}::uuid ${guard}
      RETURNING e.*
    )${settle}
    SELECT * FROM upd`;
  const updated = rows[0];
  if (!updated) {
    // Error path only: tell "not found" from "not snoozable".
    const exists = input.snoozeMinutes ? await prisma.dailyRoutineEntry.count({ where: { id, userId } }) : 0;
    if (exists) throw badRequest('Only pending items can be snoozed');
    throw notFound('Routine entry');
  }
  return entryDto(updated);
}

/** Scheduler maintenance: PENDING/SNOOZED entries from days before today become MISSED. */
export async function markPastRoutineEntriesMissed(now = new Date()) {
  const users = await prisma.userSettings.findMany({ select: { userId: true, timezone: true } });
  let count = 0;
  for (const u of users) {
    const res = await prisma.dailyRoutineEntry.updateMany({
      where: { userId: u.userId, date: { lt: toDbDate(todayIn(u.timezone, now)) }, status: { in: ['PENDING', 'SNOOZED'] } },
      data: { status: 'MISSED', snoozedUntil: null },
    });
    count += res.count;
  }
  return count;
}

/** Scheduler maintenance: materialise today's entries for every user so history exists even if the app is not opened. */
export async function ensureTodayForAllUsers(now = new Date()) {
  const users = await prisma.userSettings.findMany({ select: { userId: true, timezone: true, gymWeekdays: true } });
  let count = 0;
  for (const u of users) {
    count += await ensureDailyRoutineEntries(u.userId, todayIn(u.timezone, now), { timezone: u.timezone, gymWeekdays: u.gymWeekdays }, prisma, now);
  }
  return count;
}

// ───────────────────────────── Templates & items ─────────────────────────────

const weekdaysSchema = z
  .array(z.number().int().min(0).max(6))
  .max(7)
  .refine((a) => new Set(a).size === a.length, 'Weekdays must be unique');

export const templateCreateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  dayType: z.nativeEnum(DayType).default('ANY'),
  weekdays: weekdaysSchema.default([]),
  isActive: z.boolean().default(true),
});
export const templateUpdateSchema = templateCreateSchema.partial();

export const itemCreateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120),
  category: z.nativeEnum(ActivityCategory).default('CUSTOM'),
  time: timeString,
  notes: z.string().trim().max(1000).nullish(),
  reminderEnabled: z.boolean().default(true),
  snoozeMinutes: snoozeMinutesSchema.default(10),
});
export const itemUpdateSchema = itemCreateSchema.partial();
export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1) });
export const copySchema = z.object({ name: z.string().trim().min(1, 'Name is required').max(80), weekdays: weekdaysSchema.refine((a) => a.length > 0, 'Pick at least one weekday') });

type ItemWithReminders = RoutineItem & { reminders: { id: string; enabled: boolean; nextTriggerAt: Date | null }[] };

function itemDto(i: ItemWithReminders) {
  const r = i.reminders[0];
  return {
    id: i.id,
    templateId: i.templateId,
    title: i.title,
    category: i.category,
    time: i.time,
    sortOrder: i.sortOrder,
    notes: i.notes,
    reminderEnabled: i.reminderEnabled,
    snoozeMinutes: i.snoozeMinutes,
    reminder: r ? { id: r.id, enabled: r.enabled, nextTriggerAt: r.nextTriggerAt } : null,
  };
}

function templateDto(t: RoutineTemplate & { items: ItemWithReminders[] }) {
  return {
    id: t.id,
    name: t.name,
    dayType: t.dayType,
    weekdays: t.weekdays,
    isActive: t.isActive,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    items: t.items.map(itemDto),
  };
}

/**
 * Templates with items and linked reminders as three flat queries fired in parallel (one round trip
 * outside a transaction) instead of three nested include levels (three sequential round trips).
 */
async function loadTemplates(
  userId: string,
  db: Db = prisma,
  filter: { templateId?: string; itemId?: string } = {},
): Promise<(RoutineTemplate & { items: ItemWithReminders[] })[]> {
  const { templateId, itemId } = filter;
  const templateWhere: Prisma.RoutineTemplateWhereInput = {
    userId,
    ...(templateId ? { id: templateId } : {}),
    ...(itemId ? { items: { some: { id: itemId } } } : {}),
  };
  const [templates, items, reminders] = await Promise.all([
    db.routineTemplate.findMany({ where: templateWhere, orderBy: [{ createdAt: 'asc' }] }),
    db.routineItem.findMany({ where: { template: templateWhere }, orderBy: [{ sortOrder: 'asc' }, { time: 'asc' }] }),
    db.reminder.findMany({
      where: { userId, routineItemId: { not: null }, ...(templateId || itemId ? { routineItem: { template: templateWhere } } : {}) },
      select: { id: true, enabled: true, nextTriggerAt: true, routineItemId: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const remindersByItem = new Map<string, ItemWithReminders['reminders']>();
  for (const r of reminders) {
    const list = remindersByItem.get(r.routineItemId!) ?? [];
    list.push({ id: r.id, enabled: r.enabled, nextTriggerAt: r.nextTriggerAt });
    remindersByItem.set(r.routineItemId!, list);
  }
  const itemsByTemplate = new Map<string, ItemWithReminders[]>();
  for (const i of items) {
    const list = itemsByTemplate.get(i.templateId) ?? [];
    list.push({ ...i, reminders: remindersByItem.get(i.id) ?? [] });
    itemsByTemplate.set(i.templateId, list);
  }
  return templates.map((t) => ({ ...t, items: itemsByTemplate.get(t.id) ?? [] }));
}

export async function listTemplates(userId: string) {
  return (await loadTemplates(userId)).map(templateDto);
}

async function loadTemplate(userId: string, id: string, db: Db = prisma) {
  const [t] = await loadTemplates(userId, db, { templateId: id });
  if (!t) throw notFound('Routine template');
  return t;
}

export async function getTemplate(userId: string, id: string) {
  return templateDto(await loadTemplate(userId, id));
}

// ───────────── Template / item writes ─────────────
//
// Each write is: one parallel read wave (template + items + linked reminders + schedule context, all
// user-scoped), then ONE SQL statement whose data-modifying CTEs perform every change atomically (item,
// linked reminders, today+ pending entries) without BEGIN/COMMIT round trips. The response DTO is built
// from data already in hand instead of re-querying. Typical cost: 2 sequential round trips (deletes: 1).

type ReminderCtx = Awaited<ReturnType<typeof triggerContextFor>>;
type LoadedTemplate = RoutineTemplate & { items: ItemWithReminders[] };
type ItemFields = Pick<RoutineItem, 'title' | 'category' | 'time' | 'snoozeMinutes' | 'reminderEnabled'>;
type TemplateSchedule = Pick<RoutineTemplate, 'isActive' | 'weekdays' | 'dayType'>;

/**
 * The linked Reminder an item should have: reminderEnabled + active template → enabled reminder with the
 * item's title/category/time and the template's weekdays/day type; otherwise disabled.
 */
function reminderPlan(item: ItemFields, template: TemplateSchedule, ctx: ReminderCtx) {
  const schedule = {
    title: item.title,
    category: item.category,
    time: item.time,
    weekdays: template.weekdays,
    dayType: template.weekdays.length > 0 ? ('ANY' as const) : template.dayType,
    oneTimeDate: null,
    snoozeMinutes: item.snoozeMinutes,
    enabled: item.reminderEnabled && template.isActive,
  };
  return { ...schedule, nextTriggerAt: computeNextTrigger(schedule, ctx) };
}
type ReminderPlan = ReturnType<typeof reminderPlan>;

const sortDays = (d: number[]) => [...d].sort((a, b) => a - b);
const cte = (name: string, body: Prisma.Sql) => Prisma.sql`${Prisma.raw(`"${name}"`)} AS (${body})`;

/** Runs a list of CTEs as one statement (atomic, one round trip). */
async function runStatement(ctes: Prisma.Sql[]) {
  if (ctes.length === 0) return;
  await prisma.$queryRaw`WITH ${Prisma.join(ctes, ', ')} SELECT 1 AS ok`;
}

/** UPDATE every reminder linked to one item with its plan. */
function updateItemRemindersSql(userId: string, itemId: string, p: ReminderPlan) {
  return Prisma.sql`
    UPDATE "Reminder" SET title = ${p.title}, category = ${p.category}::"ActivityCategory", time = ${p.time}, weekdays = ${p.weekdays}::int[],
      "dayType" = ${p.dayType}::"DayType", "oneTimeDate" = NULL, "snoozeMinutes" = ${p.snoozeMinutes}, enabled = ${p.enabled},
      "nextTriggerAt" = ${p.nextTriggerAt}::timestamptz, "updatedAt" = now()
    WHERE "userId" = ${userId}::uuid AND "routineItemId" = ${itemId}::uuid
    RETURNING id`;
}

interface NewReminder {
  id: string;
  itemId: string;
  description: string | null;
  plan: ReminderPlan;
}

/** INSERT enabled reminders for items of ONE template (shared weekdays / day type). */
function insertRemindersSql(userId: string, rows: NewReminder[]) {
  const { weekdays, dayType } = rows[0].plan;
  return Prisma.sql`
    INSERT INTO "Reminder" (id, "userId", title, description, category, time, weekdays, "dayType", enabled, "snoozeMinutes", "nextTriggerAt", "routineItemId", "updatedAt")
    SELECT v.id, ${userId}::uuid, v.title, v.descr, v.cat::"ActivityCategory", v.time, ${weekdays}::int[], ${dayType}::"DayType", true, v.snooze,
           v.next::timestamptz, v.item, now()
    FROM unnest(
      ${rows.map((r) => r.id)}::uuid[], ${rows.map((r) => r.plan.title)}::text[], ${rows.map((r) => r.description)}::text[],
      ${rows.map((r) => r.plan.category)}::text[], ${rows.map((r) => r.plan.time)}::text[], ${rows.map((r) => r.plan.snoozeMinutes)}::int[],
      ${rows.map((r) => r.plan.nextTriggerAt?.toISOString() ?? null)}::text[], ${rows.map((r) => r.itemId)}::uuid[]
    ) AS v(id, title, descr, cat, time, snooze, next, item)
    RETURNING id`;
}

/** DELETE today-and-future PENDING entries of the given items (they are re-materialised on next view). */
function dropFutureEntriesSql(userId: string, itemIds: string[], timezone: string) {
  return Prisma.sql`
    DELETE FROM "DailyRoutineEntry"
    WHERE "userId" = ${userId}::uuid AND "routineItemId" = ANY (${itemIds}::uuid[])
      AND date >= ${toDbDate(todayIn(timezone))} AND status = 'PENDING'
    RETURNING id`;
}

/** Template (with items + linked reminders) containing an item, user-scoped; null when not found. */
async function loadTemplateOfItem(userId: string, itemId: string) {
  const [t] = await loadTemplates(userId, prisma, { itemId });
  return t ?? null;
}

const reminderRefs = (plan: ReminderPlan, ids: string[]) => ids.map((id) => ({ id, enabled: plan.enabled, nextTriggerAt: plan.nextTriggerAt }));
const sortItems = (items: ItemWithReminders[]) => [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.time.localeCompare(b.time));

/** Calls `fn`, then drops memoised day materialisations (after the write, so a concurrent view cannot re-memoise stale state). */
async function invalidatingAfter<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } finally {
    invalidateRoutineDays(userId);
  }
}

export async function createTemplate(userId: string, input: z.infer<typeof templateCreateSchema>) {
  return invalidatingAfter(userId, async () => {
    const t = await prisma.routineTemplate.create({
      data: { userId, name: input.name, dayType: input.dayType, weekdays: sortDays(input.weekdays), isActive: input.isActive },
    });
    return templateDto({ ...t, items: [] });
  });
}

export async function updateTemplate(userId: string, id: string, input: z.infer<typeof templateUpdateSchema>) {
  return invalidatingAfter(userId, async () => {
    const [before, ctx] = await Promise.all([loadTemplate(userId, id), triggerContextFor(userId)]);
    const after: LoadedTemplate = {
      ...before,
      ...input,
      weekdays: input.weekdays ? sortDays(input.weekdays) : before.weekdays,
      updatedAt: new Date(),
    };
    const ctes = [
      cte(
        'tpl',
        Prisma.sql`UPDATE "RoutineTemplate" SET name = ${after.name}, "dayType" = ${after.dayType}::"DayType", weekdays = ${after.weekdays}::int[],
          "isActive" = ${after.isActive}, "updatedAt" = now() WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid RETURNING id`,
      ),
    ];
    const scheduleChanged =
      after.isActive !== before.isActive || after.dayType !== before.dayType || after.weekdays.join() !== before.weekdays.join();
    if (scheduleChanged && before.items.length) {
      const plans = before.items.map((i) => ({ item: i, plan: reminderPlan(i, after, ctx) }));
      const withReminder = plans.filter((p) => p.item.reminders.length > 0);
      if (withReminder.length) {
        const { weekdays, dayType } = withReminder[0].plan;
        ctes.push(
          cte(
            'rem_upd',
            Prisma.sql`UPDATE "Reminder" r SET weekdays = ${weekdays}::int[], "dayType" = ${dayType}::"DayType", "oneTimeDate" = NULL,
              enabled = v.en, "nextTriggerAt" = v.next::timestamptz, "updatedAt" = now()
            FROM unnest(${withReminder.map((p) => p.item.id)}::uuid[], ${withReminder.map((p) => p.plan.enabled)}::boolean[],
                        ${withReminder.map((p) => p.plan.nextTriggerAt?.toISOString() ?? null)}::text[]) AS v(item, en, next)
            WHERE r."routineItemId" = v.item AND r."userId" = ${userId}::uuid
            RETURNING r.id`,
          ),
        );
      }
      const toCreate: NewReminder[] = plans
        .filter((p) => p.item.reminders.length === 0 && p.plan.enabled)
        .map((p) => ({ id: randomUUID(), itemId: p.item.id, description: p.item.notes, plan: p.plan }));
      if (toCreate.length) ctes.push(cte('rem_ins', insertRemindersSql(userId, toCreate)));
      // Today/future pending rows may no longer apply; they are re-materialised on next view.
      ctes.push(cte('ent_del', dropFutureEntriesSql(userId, before.items.map((i) => i.id), ctx.timezone)));
      await runStatement(ctes);
      const created = new Map(toCreate.map((r) => [r.itemId, r.id]));
      after.items = plans.map(({ item, plan }) => ({
        ...item,
        reminders: created.has(item.id) ? reminderRefs(plan, [created.get(item.id)!]) : reminderRefs(plan, item.reminders.map((r) => r.id)),
      }));
      const nexts = plans.map((p) => p.plan.nextTriggerAt).filter((d): d is Date => !!d);
      if (nexts.length) pokeScheduler(new Date(Math.min(...nexts.map((d) => d.getTime()))));
    } else {
      await runStatement(ctes);
    }
    return templateDto(after);
  });
}

export async function deleteTemplate(userId: string, id: string) {
  return invalidatingAfter(userId, async () => {
    // One statement: ownership check, today+ pending entries, linked reminders, then the template (items cascade).
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      WITH t AS (SELECT id FROM "RoutineTemplate" WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid),
      items AS (SELECT i.id FROM "RoutineItem" i JOIN t ON i."templateId" = t.id),
      tz AS (SELECT COALESCE((SELECT timezone FROM "UserSettings" WHERE "userId" = ${userId}::uuid), ${env.DEFAULT_TIMEZONE}) AS name),
      ent AS (
        DELETE FROM "DailyRoutineEntry" e USING items, tz
        WHERE e."routineItemId" = items.id AND e."userId" = ${userId}::uuid AND e.status = 'PENDING'
          AND e.date >= (now() AT TIME ZONE tz.name)::date
        RETURNING e.id
      ),
      rem AS (DELETE FROM "Reminder" r USING items WHERE r."routineItemId" = items.id AND r."userId" = ${userId}::uuid RETURNING r.id),
      del AS (DELETE FROM "RoutineTemplate" x USING t WHERE x.id = t.id RETURNING x.id)
      SELECT count(*)::int AS n FROM del`;
    if (!rows[0]?.n) throw notFound('Routine template');
  });
}

export async function createItem(userId: string, templateId: string, input: z.infer<typeof itemCreateSchema>) {
  return invalidatingAfter(userId, async () => {
    const [t, ctx] = await Promise.all([loadTemplate(userId, templateId), triggerContextFor(userId)]);
    const now = new Date();
    const item: RoutineItem = {
      id: randomUUID(),
      templateId,
      title: input.title,
      category: input.category,
      time: input.time,
      notes: input.notes ?? null,
      reminderEnabled: input.reminderEnabled,
      snoozeMinutes: input.snoozeMinutes,
      sortOrder: t.items.reduce((m, i) => Math.max(m, i.sortOrder), -1) + 1,
      createdAt: now,
      updatedAt: now,
    };
    const plan = reminderPlan(item, t, ctx);
    const reminderId = plan.enabled ? randomUUID() : null;
    const ctes = [
      cte(
        'it',
        Prisma.sql`INSERT INTO "RoutineItem" (id, "templateId", title, category, time, "sortOrder", notes, "reminderEnabled", "snoozeMinutes", "updatedAt")
          VALUES (${item.id}::uuid, ${templateId}::uuid, ${item.title}, ${item.category}::"ActivityCategory", ${item.time}, ${item.sortOrder},
                  ${item.notes}, ${item.reminderEnabled}, ${item.snoozeMinutes}, now())
          RETURNING id`,
      ),
    ];
    if (reminderId) ctes.push(cte('rem', insertRemindersSql(userId, [{ id: reminderId, itemId: item.id, description: item.notes, plan }])));
    await runStatement(ctes);
    pokeScheduler(plan.nextTriggerAt);
    const created: ItemWithReminders = { ...item, reminders: reminderId ? reminderRefs(plan, [reminderId]) : [] };
    return templateDto({ ...t, items: sortItems([...t.items, created]) });
  });
}

export async function updateItem(userId: string, itemId: string, input: z.infer<typeof itemUpdateSchema>) {
  return invalidatingAfter(userId, async () => {
    const [t, ctx] = await Promise.all([loadTemplateOfItem(userId, itemId), triggerContextFor(userId)]);
    const before = t?.items.find((i) => i.id === itemId);
    if (!t || !before) throw notFound('Routine item');
    const after: ItemWithReminders = {
      ...before,
      ...input,
      notes: input.notes !== undefined ? input.notes || null : before.notes,
      updatedAt: new Date(),
    };
    const plan = reminderPlan(after, t, ctx);
    const existingIds = before.reminders.map((r) => r.id);
    const newReminderId = existingIds.length === 0 && plan.enabled ? randomUUID() : null;
    const ctes = [
      cte(
        'it',
        Prisma.sql`UPDATE "RoutineItem" SET title = ${after.title}, category = ${after.category}::"ActivityCategory", time = ${after.time},
          notes = ${after.notes}, "reminderEnabled" = ${after.reminderEnabled}, "snoozeMinutes" = ${after.snoozeMinutes}, "updatedAt" = now()
          WHERE id = ${itemId}::uuid AND "templateId" = ${t.id}::uuid RETURNING id`,
      ),
      newReminderId
        ? cte('rem', insertRemindersSql(userId, [{ id: newReminderId, itemId, description: after.notes, plan }]))
        : cte('rem', updateItemRemindersSql(userId, itemId, plan)),
    ];
    if (before.title !== after.title || before.category !== after.category || before.time !== after.time) {
      // Today+ PENDING rows take the new title/category; the time only where it was not overridden for that day.
      ctes.push(
        cte(
          'ent',
          Prisma.sql`UPDATE "DailyRoutineEntry" e SET title = ${after.title}, category = ${after.category}::"ActivityCategory",
            "scheduledTime" = CASE WHEN e."scheduledTime" = ${before.time} THEN ${after.time} ELSE e."scheduledTime" END,
            "scheduledAt" = CASE WHEN e."scheduledTime" = ${before.time} THEN ((e.date + ${after.time}::time) AT TIME ZONE ${ctx.timezone}) ELSE e."scheduledAt" END,
            "updatedAt" = now()
          WHERE e."userId" = ${userId}::uuid AND e."routineItemId" = ${itemId}::uuid AND e.date >= ${toDbDate(todayIn(ctx.timezone))} AND e.status = 'PENDING'
          RETURNING e.id`,
        ),
      );
    }
    await runStatement(ctes);
    pokeScheduler(plan.nextTriggerAt);
    after.reminders = reminderRefs(plan, newReminderId ? [newReminderId] : existingIds);
    return templateDto({ ...t, items: sortItems(t.items.map((i) => (i.id === itemId ? after : i))) });
  });
}

export async function deleteItem(userId: string, itemId: string) {
  return invalidatingAfter(userId, async () => {
    // One statement: ownership via the template's userId, today+ pending entries, linked reminders, the item.
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      WITH it AS (
        SELECT i.id FROM "RoutineItem" i JOIN "RoutineTemplate" t ON t.id = i."templateId"
        WHERE i.id = ${itemId}::uuid AND t."userId" = ${userId}::uuid
      ),
      tz AS (SELECT COALESCE((SELECT timezone FROM "UserSettings" WHERE "userId" = ${userId}::uuid), ${env.DEFAULT_TIMEZONE}) AS name),
      ent AS (
        DELETE FROM "DailyRoutineEntry" e USING it, tz
        WHERE e."routineItemId" = it.id AND e."userId" = ${userId}::uuid AND e.status = 'PENDING' AND e.date >= (now() AT TIME ZONE tz.name)::date
        RETURNING e.id
      ),
      rem AS (DELETE FROM "Reminder" r USING it WHERE r."routineItemId" = it.id AND r."userId" = ${userId}::uuid RETURNING r.id),
      del AS (DELETE FROM "RoutineItem" x USING it WHERE x.id = it.id RETURNING x.id)
      SELECT count(*)::int AS n FROM del`;
    if (!rows[0]?.n) throw notFound('Routine item');
  });
}

/**
 * Copies a template's items into a template scheduled on `weekdays`. If the user already has a
 * template with the same name, its items are replaced (and its linked reminders rebuilt); otherwise
 * a new template is created. One read wave + one statement.
 */
export async function copyTemplate(userId: string, templateId: string, input: z.infer<typeof copySchema>) {
  return invalidatingAfter(userId, async () => {
    const sameName = { userId, name: input.name, id: { not: templateId } };
    const [source, existing, oldItems, ctx] = await Promise.all([
      loadTemplate(userId, templateId),
      prisma.routineTemplate.findFirst({ where: sameName, orderBy: { createdAt: 'asc' } }),
      prisma.routineItem.findMany({ where: { template: sameName }, select: { id: true, templateId: true } }),
      triggerContextFor(userId),
    ]);
    const now = new Date();
    const target: RoutineTemplate = {
      id: existing?.id ?? randomUUID(),
      userId,
      name: input.name,
      dayType: 'ANY',
      weekdays: sortDays(input.weekdays),
      isActive: true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const ctes: Prisma.Sql[] = [];
    if (existing) {
      const oldIds = oldItems.filter((i) => i.templateId === existing.id).map((i) => i.id);
      if (oldIds.length) {
        ctes.push(cte('old_ent', dropFutureEntriesSql(userId, oldIds, ctx.timezone)));
        ctes.push(cte('old_rem', Prisma.sql`DELETE FROM "Reminder" WHERE "userId" = ${userId}::uuid AND "routineItemId" = ANY (${oldIds}::uuid[]) RETURNING id`));
        ctes.push(cte('old_items', Prisma.sql`DELETE FROM "RoutineItem" WHERE "templateId" = ${existing.id}::uuid RETURNING id`));
      }
      ctes.push(
        cte(
          'tpl',
          Prisma.sql`UPDATE "RoutineTemplate" SET weekdays = ${target.weekdays}::int[], "dayType" = 'ANY', "isActive" = true, "updatedAt" = now()
            WHERE id = ${existing.id}::uuid AND "userId" = ${userId}::uuid RETURNING id`,
        ),
      );
    } else {
      ctes.push(
        cte(
          'tpl',
          Prisma.sql`INSERT INTO "RoutineTemplate" (id, "userId", name, "dayType", weekdays, "isActive", "updatedAt")
            VALUES (${target.id}::uuid, ${userId}::uuid, ${target.name}, 'ANY', ${target.weekdays}::int[], true, now()) RETURNING id`,
        ),
      );
    }
    const items: RoutineItem[] = source.items.map((src) => ({
      id: randomUUID(),
      templateId: target.id,
      title: src.title,
      category: src.category,
      time: src.time,
      sortOrder: src.sortOrder,
      notes: src.notes,
      reminderEnabled: src.reminderEnabled,
      snoozeMinutes: src.snoozeMinutes,
      createdAt: now,
      updatedAt: now,
    }));
    const plans = items.map((item) => ({ item, plan: reminderPlan(item, target, ctx) }));
    const newReminders: NewReminder[] = plans
      .filter((p) => p.plan.enabled)
      .map((p) => ({ id: randomUUID(), itemId: p.item.id, description: p.item.notes, plan: p.plan }));
    if (items.length) {
      ctes.push(
        cte(
          'items',
          Prisma.sql`INSERT INTO "RoutineItem" (id, "templateId", title, category, time, "sortOrder", notes, "reminderEnabled", "snoozeMinutes", "updatedAt")
            SELECT v.id, ${target.id}::uuid, v.title, v.cat::"ActivityCategory", v.time, v.ord, v.notes, v.rem, v.snooze, now()
            FROM unnest(${items.map((i) => i.id)}::uuid[], ${items.map((i) => i.title)}::text[], ${items.map((i) => i.category)}::text[],
                        ${items.map((i) => i.time)}::text[], ${items.map((i) => i.sortOrder)}::int[], ${items.map((i) => i.notes)}::text[],
                        ${items.map((i) => i.reminderEnabled)}::boolean[], ${items.map((i) => i.snoozeMinutes)}::int[])
                 AS v(id, title, cat, time, ord, notes, rem, snooze)
            RETURNING id`,
        ),
      );
    }
    if (newReminders.length) ctes.push(cte('rem', insertRemindersSql(userId, newReminders)));
    await runStatement(ctes);
    const reminderOf = new Map(newReminders.map((r) => [r.itemId, r]));
    const nexts = newReminders.map((r) => r.plan.nextTriggerAt).filter((d): d is Date => !!d);
    if (nexts.length) pokeScheduler(new Date(Math.min(...nexts.map((d) => d.getTime()))));
    return templateDto({
      ...target,
      items: sortItems(
        items.map((i) => {
          const r = reminderOf.get(i.id);
          return { ...i, reminders: r ? reminderRefs(r.plan, [r.id]) : [] };
        }),
      ),
    });
  });
}

export async function reorderItems(userId: string, templateId: string, ids: string[]) {
  const [t, { timezone }] = await Promise.all([loadTemplate(userId, templateId), getUserScheduleContext(userId)]);
  const byId = new Map(t.items.map((i) => [i.id, i]));
  if (ids.length !== byId.size || new Set(ids).size !== ids.length || !ids.every((id) => byId.has(id))) {
    throw badRequest('ids must list every item of the template exactly once');
  }
  const changed = ids.map((id, index) => ({ id, index })).filter(({ id, index }) => byId.get(id)!.sortOrder !== index);
  if (changed.length) {
    // One statement: new sort orders for the items and for their today+ pending entries.
    await prisma.$executeRaw`
      WITH v AS (
        SELECT * FROM unnest(${changed.map((c) => c.id)}::uuid[], ${changed.map((c) => c.index)}::int[]) AS v(id, ord)
      ), items AS (
        UPDATE "RoutineItem" i SET "sortOrder" = v.ord, "updatedAt" = now() FROM v
        WHERE i.id = v.id AND i."templateId" = ${templateId}::uuid
        RETURNING i.id
      )
      UPDATE "DailyRoutineEntry" e SET "sortOrder" = v.ord, "updatedAt" = now() FROM v
      WHERE e."routineItemId" = v.id AND e."userId" = ${userId}::uuid AND e.date >= ${toDbDate(todayIn(timezone))} AND e.status = 'PENDING'`;
  }
  const items = ids.map((id, index) => ({ ...byId.get(id)!, sortOrder: index }));
  return templateDto({ ...t, items });
}
