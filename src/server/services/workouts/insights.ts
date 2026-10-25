import { Prisma, type WorkoutSessionStatus } from '@prisma/client';
import { prisma } from '../../db';
import { addDays, dateRange, fromDbDate, toDbDate, weekBounds, weekdayOf } from '../../lib/dates';
import { getDayType } from '../dayContext';
import { loadActivePlan, loadSessions, summarizeSession, type LoadedPlan } from './queries';
import { computeConsistency, computePersonalRecords, type RecordSetRow } from './stats';

interface Ctx {
  userId: string;
  gymWeekdays: number[];
}

// Every endpoint below runs its queries in parallel and each query is a single statement → 1 round trip.
const activePlan = loadActivePlan;

function plannedDayFor(plan: LoadedPlan | null, date: string) {
  if (!plan) return null;
  const wd = weekdayOf(date);
  return plan.days.find((d) => d.weekday === wd) ?? null;
}

/**
 * GYM/REST for every date in a range in one query. Mirrors `getDayType` exactly
 * (DailyLog override first, then gym weekdays).
 */
async function dayTypesForRange(userId: string, from: string, to: string, gymWeekdays: number[]) {
  const logs = await prisma.dailyLog.findMany({
    where: { userId, date: { gte: toDbDate(from), lte: toDbDate(to) }, dayType: { in: ['GYM', 'REST'] } },
    select: { date: true, dayType: true },
  });
  const overrides = new Map(logs.map((l) => [fromDbDate(l.date), l.dayType as 'GYM' | 'REST']));
  return (date: string): 'GYM' | 'REST' => overrides.get(date) ?? (gymWeekdays.includes(weekdayOf(date)) ? 'GYM' : 'REST');
}

const STATUS_PRIORITY: Record<WorkoutSessionStatus, number> = { IN_PROGRESS: 0, COMPLETED: 1, PLANNED: 2, SKIPPED: 3 };

/** Today's (or `date`'s) planned workout + any sessions logged that day. */
export async function getSchedule(ctx: Ctx, date: string) {
  const [plan, dayType, sessions] = await Promise.all([
    activePlan(ctx.userId),
    getDayType(ctx.userId, date, ctx.gymWeekdays),
    loadSessions(Prisma.sql`s."userId" = ${ctx.userId}::uuid AND s.date = ${date}::date`),
  ]);
  const day = plannedDayFor(plan, date);
  const summaries = sessions.map(summarizeSession).sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status]);
  return {
    date,
    weekday: weekdayOf(date),
    dayType,
    plan: plan ? { id: plan.id, name: plan.name } : null,
    day,
    session: summaries[0] ?? null,
    sessions: summaries,
  };
}

export type WeekDayStatus = 'COMPLETED' | 'IN_PROGRESS' | 'SKIPPED' | 'MISSED' | 'PLANNED' | 'REST' | 'UPCOMING';

/** The Monday-start week containing `date`, with planned day and session status per day. */
export async function getWeek(ctx: Ctx, date: string, today: string) {
  const { from, to } = weekBounds(date);
  const [plan, dayTypeOf, sessions] = await Promise.all([
    activePlan(ctx.userId),
    dayTypesForRange(ctx.userId, from, to, ctx.gymWeekdays),
    prisma.workoutSession.findMany({
      where: { userId: ctx.userId, date: { gte: toDbDate(from), lte: toDbDate(to) } },
      select: { id: true, date: true, name: true, status: true, startedAt: true, finishedAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const days = dateRange(from, to).map((d) => {
    const planned = plannedDayFor(plan, d);
    const dayType = dayTypeOf(d);
    const daySessions = sessions
      .filter((s) => fromDbDate(s.date) === d)
      .sort((a, b) => STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status])
      .map((s) => ({ ...s, date: d }));
    const isGym = dayType === 'GYM' && !planned?.isRestDay;
    let status: WeekDayStatus;
    const best = daySessions[0]?.status;
    if (best === 'COMPLETED' || best === 'IN_PROGRESS' || best === 'SKIPPED') status = best;
    else if (!isGym) status = 'REST';
    else if (d < today) status = 'MISSED';
    else if (d === today || best === 'PLANNED') status = 'PLANNED';
    else status = 'UPCOMING';
    return {
      date: d,
      weekday: weekdayOf(d),
      dayType,
      isToday: d === today,
      plannedDay: planned
        ? { id: planned.id, name: planned.name, isRestDay: planned.isRestDay, exerciseCount: planned.exercises.length, notes: planned.notes }
        : null,
      sessions: daySessions,
      status,
    };
  });
  return { from, to, plan: plan ? { id: plan.id, name: plan.name } : null, days };
}

/** Personal records per exercise from completed sets. */
export async function getRecords(userId: string) {
  const sets = await prisma.$queryRaw<
    { exerciseId: string | null; exerciseName: string; sessionId: string; date: Date; reps: number | null; weightKg: number | null; durationSec: number | null }[]
  >`
    SELECT e."exerciseId", COALESCE(x.name, e."exerciseName") AS "exerciseName", s.id AS "sessionId", s.date, w.reps, w."weightKg", w."durationSec"
    FROM "WorkoutSet" w
    JOIN "WorkoutExerciseEntry" e ON e.id = w."entryId"
    JOIN "WorkoutSession" s ON s.id = e."sessionId"
    LEFT JOIN "Exercise" x ON x.id = e."exerciseId"
    WHERE s."userId" = ${userId}::uuid AND w.completed = true`;
  const rows: RecordSetRow[] = sets.map((s) => ({
    exerciseId: s.exerciseId,
    exerciseName: s.exerciseName,
    sessionId: s.sessionId,
    date: fromDbDate(s.date),
    reps: s.reps,
    weightKg: s.weightKg,
    durationSec: s.durationSec,
  }));
  return computePersonalRecords(rows);
}

/** Planned gym days vs completed sessions, weekly %, and streak. */
export async function getConsistency(ctx: Ctx, from: string, to: string, today: string) {
  const [plan, dayTypeOf, completed] = await Promise.all([
    activePlan(ctx.userId),
    dayTypesForRange(ctx.userId, from, to, ctx.gymWeekdays),
    prisma.workoutSession.findMany({
      where: { userId: ctx.userId, status: 'COMPLETED', date: { gte: toDbDate(from), lte: toDbDate(to) } },
      select: { date: true },
    }),
  ]);
  const doneDates = new Set(completed.map((s) => fromDbDate(s.date)));
  const days = dateRange(from, to).map((d) => ({
    date: d,
    planned: dayTypeOf(d) === 'GYM' && !plannedDayFor(plan, d)?.isRestDay,
    completed: doneDates.has(d),
  }));
  const summary = computeConsistency(days, (d) => weekBounds(d).from, today);
  return {
    from,
    to,
    ...summary,
    weeks: summary.weeks.map((w) => ({ ...w, weekEnd: addDays(w.weekStart, 6) })),
  };
}
