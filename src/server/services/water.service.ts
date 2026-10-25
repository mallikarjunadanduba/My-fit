import type { NutritionTarget, WaterEntry } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../db';
import { notFound } from '../lib/http';
import { addDays, dateRange, dateString, fromDbDate, toDbDate, todayIn, zonedToUtc } from '../lib/dates';
import { targetOn, targetsOf } from './foodDiary.service';
import { sqlCast, updateOwned } from './foods.service';
import { targetProgress } from '../../shared/nutrition';

/** Single-entry cap: logging more than 2 L at once is almost certainly a typo. */
export const MAX_ENTRY_ML = 2000;

const amountMl = z
  .number()
  .int('Use whole millilitres')
  .min(1, 'Amount must be at least 1 ml')
  .max(MAX_ENTRY_ML, `A single entry can be at most ${MAX_ENTRY_ML} ml`);
const note = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null));

export const waterInput = z.object({
  date: dateString,
  amountMl,
  loggedAt: z.string().datetime({ offset: true }).optional(),
  note,
});

export const waterUpdate = z
  .object({
    date: dateString,
    amountMl,
    loggedAt: z.string().datetime({ offset: true }),
    note,
  })
  .partial();

export function serializeWater(e: WaterEntry) {
  return {
    id: e.id,
    date: fromDbDate(e.date),
    amountMl: e.amountMl,
    loggedAt: e.loggedAt,
    note: e.note,
    createdAt: e.createdAt,
  };
}

/** Water day summary from its entries and the target in force (pure). */
export function summarizeDay(date: string, entries: WaterEntry[], target: NutritionTarget | null) {
  const logged = entries.length > 0;
  const totalMl = logged ? entries.reduce((s, e) => s + e.amountMl, 0) : null;
  const progress = target && totalMl != null ? targetProgress(totalMl, target.waterMl, target.waterMinMl, target.waterMaxMl) : null;
  const upper = target ? (target.waterMaxMl ?? null) : null;
  return {
    date,
    entries: entries.map(serializeWater),
    logged,
    totalMl,
    targetMl: target?.waterMl ?? null,
    minMl: target?.waterMinMl ?? null,
    maxMl: target?.waterMaxMl ?? null,
    remainingMl: target ? Math.max(0, target.waterMl - (totalMl ?? 0)) : null,
    overMax: upper != null && totalMl != null && totalMl > upper,
    progress,
  };
}

function rangeDays(
  from: string,
  to: string,
  grouped: {
    date: Date;
    _sum: { amountMl: number | null };
    _count: { _all: number };
  }[],
  targets: NutritionTarget[],
) {
  const byDate = new Map(grouped.map((g) => [fromDbDate(g.date), g]));
  return dateRange(from, to).map((date) => {
    const g = byDate.get(date);
    const t = targetOn(targets, date);
    return {
      date,
      logged: !!g,
      entryCount: g?._count._all ?? 0,
      totalMl: g ? (g._sum.amountMl ?? 0) : null,
      targetMl: t?.waterMl ?? null,
      maxMl: t?.waterMaxMl ?? null,
    };
  });
}

const groupByDay = (userId: string, from: string, to: string) =>
  prisma.waterEntry.groupBy({
    by: ['date'],
    where: { userId, date: { gte: toDbDate(from), lte: toDbDate(to) } },
    _sum: { amountMl: true },
    _count: { _all: true },
  });

/**
 * One round trip. With historyDays the response also carries `history` (same shape as GET /water/range
 * for the historyDays days ending on date), so the water screen needs a single request.
 */
export async function getDay(userId: string, date: string, historyDays?: number) {
  const from = historyDays ? addDays(date, -(historyDays - 1)) : date;
  const [entries, targets, grouped] = await Promise.all([
    prisma.waterEntry.findMany({
      where: { userId, date: toDbDate(date) },
      orderBy: [{ loggedAt: 'asc' }, { createdAt: 'asc' }],
    }),
    targetsOf(userId),
    historyDays ? groupByDay(userId, from, date) : Promise.resolve(null),
  ]);
  const day = summarizeDay(date, entries, targetOn(targets, date));
  return grouped
    ? {
        ...day,
        history: {
          from,
          to: date,
          days: rangeDays(from, date, grouped, targets),
        },
      }
    : day;
}

export async function getRange(userId: string, from: string, to: string) {
  const [grouped, targets] = await Promise.all([groupByDay(userId, from, to), targetsOf(userId)]);
  return { from, to, days: rangeDays(from, to, grouped, targets) };
}

/** Default instant for an entry on `date`: now for today, otherwise midday local time. */
function defaultLoggedAt(date: string, timezone: string) {
  return date === todayIn(timezone) ? new Date() : zonedToUtc(date, '12:00', timezone);
}

export async function createEntry(userId: string, timezone: string, input: z.infer<typeof waterInput>) {
  const entry = await prisma.waterEntry.create({
    data: {
      userId,
      date: toDbDate(input.date),
      amountMl: input.amountMl,
      loggedAt: input.loggedAt ? new Date(input.loggedAt) : defaultLoggedAt(input.date, timezone),
      note: input.note,
    },
  });
  return serializeWater(entry);
}

/** Single statement: the owner filter in `where` is the ownership check. */
export async function updateEntry(userId: string, id: string, input: z.infer<typeof waterUpdate>) {
  const entry = await updateOwned<WaterEntry>('WaterEntry', id, userId, {
    date: input.date !== undefined ? sqlCast(input.date, 'date') : undefined,
    amountMl: input.amountMl,
    loggedAt: input.loggedAt !== undefined ? new Date(input.loggedAt) : undefined,
    note: input.note,
  });
  if (!entry) throw notFound('Water entry');
  return serializeWater(entry);
}

export async function deleteEntry(userId: string, id: string) {
  const { count } = await prisma.waterEntry.deleteMany({
    where: { id, userId },
  });
  if (!count) throw notFound('Water entry');
}
