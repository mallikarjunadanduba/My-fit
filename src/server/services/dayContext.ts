import type { DayType, NutritionTarget } from '@prisma/client';
import type { Db } from '../db';
import { prisma } from '../db';
import { toDbDate, weekdayOf } from '../lib/dates';

/** GYM or REST for a local date: DailyLog override first, then the user's gym weekdays. */
export async function getDayType(userId: string, date: string, gymWeekdays: number[], db: Db = prisma): Promise<Exclude<DayType, 'ANY'>> {
  const log = await db.dailyLog.findUnique({ where: { userId_date: { userId, date: toDbDate(date) } } });
  if (log?.dayType && log.dayType !== 'ANY') return log.dayType;
  return gymWeekdays.includes(weekdayOf(date)) ? 'GYM' : 'REST';
}

/** Target in force on `date` (latest effectiveFrom ≤ date; falls back to the earliest target). */
export async function getTargetForDate(userId: string, date: string, db: Db = prisma): Promise<NutritionTarget | null> {
  const inForce = await db.nutritionTarget.findFirst({
    where: { userId, effectiveFrom: { lte: toDbDate(date) } },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (inForce) return inForce;
  return db.nutritionTarget.findFirst({ where: { userId }, orderBy: { effectiveFrom: 'asc' } });
}

/** All targets overlapping [from, to], for resolving per-day targets in reports without N queries. */
export async function getTargetsForRange(userId: string, _from: string, to: string, db: Db = prisma) {
  const targets = await db.nutritionTarget.findMany({
    where: { userId, effectiveFrom: { lte: toDbDate(to) } },
    orderBy: { effectiveFrom: 'asc' },
  });
  const fallback = targets[0] ?? (await db.nutritionTarget.findFirst({ where: { userId }, orderBy: { effectiveFrom: 'asc' } }));
  return (date: string): NutritionTarget | null => {
    let found: NutritionTarget | null = null;
    for (const t of targets) if (t.effectiveFrom <= toDbDate(date)) found = t;
    return found ?? fallback ?? null;
  };
}
