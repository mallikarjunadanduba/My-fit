import type { DayType } from '@prisma/client';
import { prisma } from '../db';
import { monthBounds, todayIn, toDbDate, weekBounds, fromDbDate } from '../lib/dates';
import { aggregatePeriod, toSeriesPoint } from './reports/aggregate';
import { loadDays } from './reports/loadDays';
import { loadDaySnapshot, type UserCtx } from './reports/daySnapshot';
import { recomputeUserReminders } from './reminders.service';

export type { UserCtx } from './reports/daySnapshot';
export { getHistory, HISTORY_KINDS, type HistoryKind } from './reports/history';

/** Full summary of one local date. */
export async function getDailyReport(ctx: UserCtx, date: string, now: Date = new Date()) {
  const { target: _t, ...snap } = await loadDaySnapshot(ctx, date, now);
  return snap;
}

export interface DailyLogInput {
  notes?: string | null;
  dayType?: 'GYM' | 'REST' | null;
}

/** Upserts the DailyLog header (notes and/or day-type override). */
export async function upsertDailyLog(ctx: UserCtx, date: string, input: DailyLogInput) {
  const data: { notes?: string | null; dayType?: DayType | null } = {};
  if (input.notes !== undefined) data.notes = input.notes?.trim() ? input.notes.trim() : null;
  if (input.dayType !== undefined) data.dayType = input.dayType;
  const log = await prisma.dailyLog.upsert({
    where: { userId_date: { userId: ctx.userId, date: toDbDate(date) } },
    create: { userId: ctx.userId, date: toDbDate(date), timezone: ctx.timezone, ...data },
    update: { ...data, timezone: ctx.timezone },
  });
  // A GYM/REST override changes which day-type-specific alarms fire.
  if (input.dayType !== undefined) await recomputeUserReminders(ctx.userId);
  return {
    id: log.id,
    date: fromDbDate(log.date),
    timezone: log.timezone,
    dayType: log.dayType,
    notes: log.notes,
    createdAt: log.createdAt,
    updatedAt: log.updatedAt,
  };
}

export async function getCalendar(ctx: UserCtx, month: string, now: Date = new Date()) {
  const { from, to } = monthBounds(month);
  const today = todayIn(ctx.timezone, now);
  const days = await loadDays(ctx.userId, from, to, { gymWeekdays: ctx.gymWeekdays, today });
  return {
    month,
    from,
    to,
    today,
    days: days.map((d) => {
      const p = toSeriesPoint(d);
      return {
        date: d.date,
        weekday: d.weekday,
        future: d.future,
        dayType: d.dayType,
        logged: { food: d.nutrition != null, water: d.waterMl != null, workout: d.workout.sessions > 0, routine: d.routine.total > 0 },
        calories: p.calories,
        protein: p.protein,
        waterMl: p.waterMl,
        calorieTarget: p.calorieTarget,
        workoutStatus: p.workoutStatus,
        routinePct: p.routinePct,
        mealAdherence: p.mealAdherence,
        score: p.score,
        hasNotes: d.hasNotes,
      };
    }),
  };
}

export async function getPeriodReport(ctx: UserCtx, kind: 'weekly' | 'monthly', anchor: string, now: Date = new Date()) {
  const { from, to } = kind === 'weekly' ? weekBounds(anchor) : monthBounds(anchor);
  const today = todayIn(ctx.timezone, now);
  const days = await loadDays(ctx.userId, from, to, { gymWeekdays: ctx.gymWeekdays, today });
  return { kind, today, ...aggregatePeriod(days) };
}
