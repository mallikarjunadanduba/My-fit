import type { DailyLog, DayType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { dateRange, weekdayOf } from '../../lib/dates';
import { sumNutrients, type Nutrients } from '../../../shared/nutrition';
import type { DayKind, DayRecord, TargetValues } from './aggregate';

export interface DayLoadOptions {
  gymWeekdays: number[];
  /** "Today" in the user's timezone; later dates are treated as future/planned. */
  today: string;
}

/** Same rule as getDayType(), resolved in memory for a batch of days. */
export function resolveDayType(log: Pick<DailyLog, 'dayType'> | undefined, date: string, gymWeekdays: number[]): DayKind {
  const override: DayType | null | undefined = log?.dayType;
  if (override && override !== 'ANY') return override;
  return gymWeekdays.includes(weekdayOf(date)) ? 'GYM' : 'REST';
}

type Num = number | null;
interface RangeRows {
  diary: {
    date: string;
    calories: Num;
    protein: Num;
    carbs: Num;
    fat: Num;
    fiber: Num;
  }[];
  water: { date: string; ml: Num }[];
  logs: { date: string; dayType: DayType | null; hasNotes: boolean }[];
  slots: number;
  statuses: { date: string; status: string; n: number }[];
  sessions: { date: string; status: string; n: number }[];
  routine: { date: string; status: string; n: number }[];
  weights: { date: string; weightKg: number }[];
  targets: (TargetValues & { effectiveFrom: string })[];
}

/**
 * Per-day aggregates for [from, to] in ONE SQL statement (one DB round trip, one pooled connection):
 * every source is summed/grouped by date in Postgres and returned as a single JSON document.
 * Ranges never trigger per-day queries.
 */
async function loadRangeRows(userId: string, from: string, to: string): Promise<RangeRows> {
  const uid = Prisma.sql`${userId}::uuid`;
  const inRange = Prisma.sql`"date" BETWEEN ${from}::date AND ${to}::date`;
  const day = Prisma.sql`to_char("date", 'YYYY-MM-DD')`;
  const rows = await prisma.$queryRaw<{ data: RangeRows }[]>`
    SELECT json_build_object(
      'diary', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT ${day} AS date, sum("calories") AS calories, sum("protein") AS protein, sum("carbs") AS carbs,
               sum("fat") AS fat, sum("fiber") AS fiber
        FROM "FoodDiaryEntry" WHERE "userId" = ${uid} AND ${inRange} GROUP BY "date") t),
      'water', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT ${day} AS date, sum("amountMl") AS ml FROM "WaterEntry" WHERE "userId" = ${uid} AND ${inRange} GROUP BY "date") t),
      'logs', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT ${day} AS date, "dayType", coalesce("notes" ~ '[^[:space:]]', false) AS "hasNotes"
        FROM "DailyLog" WHERE "userId" = ${uid} AND ${inRange}) t),
      'slots', (SELECT count(*) FROM "MealSlot" WHERE "userId" = ${uid} AND "archivedAt" IS NULL),
      'statuses', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT ${day} AS date, s."status", count(*) AS n
        FROM "DailyMealStatus" s JOIN "MealSlot" m ON m."id" = s."slotId" AND m."archivedAt" IS NULL
        WHERE s."userId" = ${uid} AND s.${inRange} GROUP BY s."date", s."status") t),
      'sessions', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT ${day} AS date, "status", count(*) AS n FROM "WorkoutSession" WHERE "userId" = ${uid} AND ${inRange} GROUP BY "date", "status") t),
      'routine', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT ${day} AS date, "status", count(*) AS n FROM "DailyRoutineEntry" WHERE "userId" = ${uid} AND ${inRange} GROUP BY "date", "status") t),
      'weights', (SELECT coalesce(json_agg(t ORDER BY t.date, t."measuredAt"), '[]'::json) FROM (
        SELECT ${day} AS date, "measuredAt", "weightKg" FROM "BodyMeasurement"
        WHERE "userId" = ${uid} AND ${inRange} AND "weightKg" IS NOT NULL) t),
      'targets', (SELECT coalesce(json_agg(t ORDER BY t."effectiveFrom"), '[]'::json) FROM (
        SELECT to_char("effectiveFrom", 'YYYY-MM-DD') AS "effectiveFrom", "calories", "caloriesMin", "caloriesMax",
               "protein", "proteinMin", "proteinMax", "carbs", "carbsMin", "carbsMax", "fat", "fatMin", "fatMax",
               "fiber", "fiberMin", "fiberMax", "waterMl", "waterMinMl", "waterMaxMl"
        FROM "NutritionTarget" WHERE "userId" = ${uid}) t)
    ) AS data`;
  return rows[0].data;
}

/** Loads one DayRecord per date in [from, to] with a single query (see loadRangeRows). */
export async function loadDays(userId: string, from: string, to: string, opts: DayLoadOptions): Promise<DayRecord[]> {
  const r = await loadRangeRows(userId, from, to);

  const countBy = (rows: { date: string; status: string; n: number }[]) => {
    const m = new Map<string, Record<string, number>>();
    for (const x of rows) {
      const rec = m.get(x.date) ?? {};
      rec[x.status] = (rec[x.status] ?? 0) + Number(x.n);
      m.set(x.date, rec);
    }
    return m;
  };
  const sum = (rec: Record<string, number> | undefined, ...keys: string[]) => (rec ? (keys.length ? keys : Object.keys(rec)).reduce((s, k) => s + (rec[k] ?? 0), 0) : 0);

  const diaryBy = new Map(r.diary.map((d) => [d.date, d]));
  const waterBy = new Map(r.water.map((w) => [w.date, Number(w.ml ?? 0)]));
  const logBy = new Map(r.logs.map((l) => [l.date, l]));
  const statusBy = countBy(r.statuses);
  const sessionBy = countBy(r.sessions);
  const routineBy = countBy(r.routine);
  const weightBy = new Map<string, number>();
  for (const w of r.weights) weightBy.set(w.date, w.weightKg); // last of the day wins
  // Same rule as getTargetForDate(): latest effectiveFrom ≤ date, else the earliest target.
  const targetFor = (date: string): TargetValues | null => {
    let found: TargetValues | null = null;
    for (const t of r.targets) if (t.effectiveFrom <= date) found = t;
    if (!found && r.targets[0]) found = r.targets[0];
    if (!found) return null;
    const { effectiveFrom: _e, ...values } = found as TargetValues & {
      effectiveFrom: string;
    };
    return values;
  };
  const planned = Number(r.slots);

  return dateRange(from, to).map((date): DayRecord => {
    const sums = diaryBy.get(date);
    const nutrition: Nutrients | null = sums
      ? sumNutrients([
          {
            calories: sums.calories ?? 0,
            protein: sums.protein ?? 0,
            carbs: sums.carbs ?? 0,
            fat: sums.fat ?? 0,
            fiber: sums.fiber ?? 0,
          },
        ])
      : null;
    const st = statusBy.get(date);
    const ss = sessionBy.get(date);
    const rt = routineBy.get(date);
    const log = logBy.get(date);
    return {
      date,
      weekday: weekdayOf(date),
      future: date > opts.today,
      dayType: resolveDayType(log, date, opts.gymWeekdays),
      nutrition,
      waterMl: waterBy.has(date) ? waterBy.get(date)! : null,
      target: targetFor(date),
      meals: {
        planned,
        completed: sum(st, 'COMPLETED'),
        partial: sum(st, 'PARTIAL'),
        skipped: sum(st, 'SKIPPED'),
      },
      workout: {
        sessions: sum(ss) - sum(ss, 'SKIPPED'),
        completed: sum(ss, 'COMPLETED'),
        inProgress: sum(ss, 'IN_PROGRESS'),
      },
      routine: {
        total: sum(rt),
        completed: sum(rt, 'COMPLETED'),
        skipped: sum(rt, 'SKIPPED'),
      },
      weightKg: weightBy.get(date) ?? null,
      hasNotes: !!log?.hasNotes,
    };
  });
}
