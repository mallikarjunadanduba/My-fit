import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { addDays, todayIn, weekdayOf } from '../lib/dates';
import { round1 } from '../../shared/nutrition';
import { SCORE_WEIGHTS, toSeriesPoint } from './reports/aggregate';
import { loadDays } from './reports/loadDays';
import { loadActiveSlots, loadDaySnapshot, type UserCtx } from './reports/daySnapshot';
import { loadTargetResolver } from './reports/targets';

export interface DashboardCtx extends UserCtx {
  name: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type ActivityType = 'food' | 'water' | 'workout' | 'routine' | 'measurement';

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  detail: string | null;
  date: string;
  at: Date;
}

type Ts = string | null;
interface ActivityRows {
  food: {
    id: string;
    date: string;
    foodName: string;
    calories: number;
    slotName: string | null;
    createdAt: string;
  }[];
  water: { id: string; date: string; amountMl: number; createdAt: string }[];
  workouts: {
    id: string;
    date: string;
    name: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    finishedAt: Ts;
    startedAt: Ts;
  }[];
  routine: {
    id: string;
    date: string;
    title: string;
    scheduledTime: string;
    completedAt: string;
  }[];
  measurements: {
    id: string;
    date: string;
    weightKg: number | null;
    bodyFatPct: number | null;
    waistCm: number | null;
    createdAt: string;
  }[];
}

/** Latest activity across modules in ONE SQL statement (each source limited/sorted in Postgres). */
export async function getRecentActivity(userId: string, limit = 10): Promise<ActivityItem[]> {
  const uid = Prisma.sql`${userId}::uuid`;
  const day = (col: string) => Prisma.raw(`to_char(${col}, 'YYYY-MM-DD')`);
  const [{ data }] = await prisma.$queryRaw<{ data: ActivityRows }[]>`
    SELECT json_build_object(
      'food', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT f."id", ${day('f."date"')} AS date, f."foodName", f."calories", s."name" AS "slotName", f."createdAt"
        FROM "FoodDiaryEntry" f LEFT JOIN "MealSlot" s ON s."id" = f."slotId"
        WHERE f."userId" = ${uid} ORDER BY f."createdAt" DESC LIMIT ${limit}) t),
      'water', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT "id", ${day('"date"')} AS date, "amountMl", "createdAt" FROM "WaterEntry"
        WHERE "userId" = ${uid} ORDER BY "createdAt" DESC LIMIT ${limit}) t),
      'workouts', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT "id", ${day('"date"')} AS date, "name", "status", "createdAt", "updatedAt", "finishedAt", "startedAt" FROM "WorkoutSession"
        WHERE "userId" = ${uid} ORDER BY "updatedAt" DESC LIMIT ${limit}) t),
      'routine', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT "id", ${day('"date"')} AS date, "title", "scheduledTime", "completedAt" FROM "DailyRoutineEntry"
        WHERE "userId" = ${uid} AND "status" = 'COMPLETED' AND "completedAt" IS NOT NULL ORDER BY "completedAt" DESC LIMIT ${limit}) t),
      'measurements', (SELECT coalesce(json_agg(t), '[]'::json) FROM (
        SELECT "id", ${day('"date"')} AS date, "weightKg", "bodyFatPct", "waistCm", "createdAt" FROM "BodyMeasurement"
        WHERE "userId" = ${uid} ORDER BY "createdAt" DESC LIMIT ${limit}) t)
    ) AS data`;
  const at = (v: Ts) => (v ? new Date(v) : null);
  const food = data.food.map((f) => ({
    ...f,
    createdAt: new Date(f.createdAt),
    slot: f.slotName ? { name: f.slotName } : null,
  }));
  const water = data.water.map((w) => ({
    ...w,
    createdAt: new Date(w.createdAt),
  }));
  const workouts = data.workouts.map((w) => ({
    ...w,
    createdAt: new Date(w.createdAt),
    updatedAt: new Date(w.updatedAt),
    finishedAt: at(w.finishedAt),
    startedAt: at(w.startedAt),
  }));
  const routine = data.routine.map((r) => ({
    ...r,
    completedAt: new Date(r.completedAt),
  }));
  const measurements = data.measurements.map((m) => ({
    ...m,
    createdAt: new Date(m.createdAt),
  }));
  const items: ActivityItem[] = [
    ...food.map((f) => ({
      id: f.id,
      type: 'food' as const,
      title: `Logged ${f.foodName}`,
      detail: `${round1(f.calories)} kcal${f.slot ? ` · ${f.slot.name}` : ''}`,
      date: f.date,
      at: f.createdAt,
    })),
    ...water.map((w) => ({
      id: w.id,
      type: 'water' as const,
      title: `Drank ${w.amountMl} ml water`,
      detail: null,
      date: w.date,
      at: w.createdAt,
    })),
    ...workouts.map((w) => ({
      id: w.id,
      type: 'workout' as const,
      title:
        w.status === 'COMPLETED' ? `Completed ${w.name}` : w.status === 'IN_PROGRESS' ? `Started ${w.name}` : w.status === 'SKIPPED' ? `Skipped ${w.name}` : `Planned ${w.name}`,
      detail: null,
      date: w.date,
      at: (w.status === 'COMPLETED' ? w.finishedAt : w.status === 'IN_PROGRESS' ? w.startedAt : null) ?? w.updatedAt ?? w.createdAt,
    })),
    ...routine.map((r) => ({
      id: r.id,
      type: 'routine' as const,
      title: `Done: ${r.title}`,
      detail: `Scheduled ${r.scheduledTime}`,
      date: r.date,
      at: r.completedAt!,
    })),
    ...measurements.map((m) => {
      const parts = [
        m.weightKg != null ? `${m.weightKg} kg` : null,
        m.bodyFatPct != null ? `${m.bodyFatPct}% body fat` : null,
        m.waistCm != null ? `waist ${m.waistCm} cm` : null,
      ].filter(Boolean);
      return {
        id: m.id,
        type: 'measurement' as const,
        title: 'Recorded body measurement',
        detail: parts.length ? parts.join(' · ') : null,
        date: m.date,
        at: m.createdAt,
      };
    }),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

/**
 * Home screen payload. Every query (snapshot, 7-day series, plan, reminders, activity) is fired in one
 * parallel wave; shared lookups (targets, slots) are loaded once and handed to each loader.
 */
export async function getDashboard(ctx: DashboardCtx, date: string, now: Date = new Date()) {
  const { userId, gymWeekdays, timezone } = ctx;
  const today = todayIn(timezone, now);
  const weekday = weekdayOf(date);
  const targetFor = loadTargetResolver(userId);
  const slots = loadActiveSlots(userId);
  // Avoid unhandled rejections if a consumer fails before awaiting these shared promises.
  targetFor.catch(() => undefined);
  slots.catch(() => undefined);

  const [snap, plan, planDays, reminders, overdueRows, weekDays, recentActivity] = await Promise.all([
    loadDaySnapshot(ctx, date, now, { targetFor, slots }),
    prisma.workoutPlan.findFirst({
      where: { userId, isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true },
    }),
    prisma.workoutDay.findMany({
      where: { weekday, plan: { userId, isActive: true } },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        planId: true,
        name: true,
        isRestDay: true,
        notes: true,
        _count: { select: { exercises: true } },
      },
    }),
    prisma.reminder.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        time: true,
        enabled: true,
        nextTriggerAt: true,
      },
    }),
    prisma.reminderOccurrence.findMany({
      where: {
        userId,
        status: { in: ['SENT', 'SNOOZED', 'PENDING'] },
        actedAt: null,
        scheduledFor: { gte: new Date(now.getTime() - DAY_MS), lte: now },
      },
      orderBy: { scheduledFor: 'desc' },
      take: 10,
      select: {
        id: true,
        reminderId: true,
        status: true,
        scheduledFor: true,
        snoozedUntil: true,
      },
    }),
    loadDays(userId, addDays(date, -6), date, { gymWeekdays, today }),
    getRecentActivity(userId, 10),
  ]);

  const activePlan = plan ? { ...plan, days: planDays.filter((d) => d.planId === plan.id) } : null;
  const reminderById = new Map(reminders.map((r) => [r.id, r]));
  const nextReminder =
    reminders
      .filter((r) => r.enabled && r.nextTriggerAt)
      .sort((a, b) => a.nextTriggerAt!.getTime() - b.nextTriggerAt!.getTime())
      .map(({ enabled: _e, ...r }) => r)[0] ?? null;
  const overdueOccurrences = overdueRows
    .filter((o) => reminderById.has(o.reminderId))
    .map((o) => {
      const r = reminderById.get(o.reminderId)!;
      return {
        ...o,
        reminder: { id: r.id, title: r.title, category: r.category },
      };
    });

  const plannedDay = activePlan?.days[0] ?? null;
  const session = snap.primarySession;

  // Routine upcoming / overdue (relative to now; only meaningful for today and future dates).
  const pendingLike = snap.routineEntries.filter((r) => r.status === 'PENDING' || r.status === 'SNOOZED');
  const effectiveAt = (r: (typeof pendingLike)[number]) => (r.status === 'SNOOZED' && r.snoozedUntil ? r.snoozedUntil : r.scheduledAt);
  const routineView = (r: (typeof snap.routineEntries)[number]) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    scheduledTime: r.scheduledTime,
    scheduledAt: r.scheduledAt,
    status: r.status,
    snoozedUntil: r.snoozedUntil,
  });
  const upcoming = snap.isPast
    ? []
    : pendingLike
        .filter((r) => effectiveAt(r) >= now)
        .slice(0, 4)
        .map(routineView);
  const overdue = snap.isToday ? pendingLike.filter((r) => effectiveAt(r) < now).map(routineView) : [];

  const series = weekDays.map(toSeriesPoint);

  return {
    greeting: {
      name: ctx.name,
      date,
      today: snap.today,
      timezone: snap.timezone,
      isToday: snap.isToday,
      isFuture: snap.isFuture,
      isPast: snap.isPast,
      dayType: snap.dayType,
      dayTypeOverride: snap.dayTypeOverride,
      notes: snap.notes,
    },
    nutrition: {
      logged: snap.nutrition.logged,
      totals: snap.nutrition.totals,
      target: snap.nutrition.target,
      progress: snap.nutrition.progress,
      remainingCalories: snap.nutrition.remainingCalories,
      entryCount: snap.nutrition.entryCount,
    },
    water: {
      logged: snap.water.logged,
      totalMl: snap.water.totalMl,
      targetMl: snap.water.targetMl,
      progress: snap.water.progress,
      entryCount: snap.water.entries.length,
    },
    meals: snap.meals.map((m) => ({
      slotId: m.slotId,
      name: m.name,
      defaultTime: m.defaultTime,
      status: m.status,
      plannedMeal: m.plannedMeal,
      entryCount: m.entryCount,
      calories: m.totals?.calories ?? null,
    })),
    workout: {
      dayType: snap.dayType,
      plan: activePlan ? { id: activePlan.id, name: activePlan.name } : null,
      plannedDay: plannedDay
        ? {
            id: plannedDay.id,
            name: plannedDay.name,
            isRestDay: plannedDay.isRestDay,
            notes: plannedDay.notes,
            exerciseCount: plannedDay._count.exercises,
          }
        : null,
      session: session
        ? {
            id: session.id,
            name: session.name,
            status: session.status,
            startedAt: session.startedAt,
            finishedAt: session.finishedAt,
            totalExercises: session.totalExercises,
            completedExercises: session.completedExercises,
            totalSets: session.totalSets,
            completedSets: session.completedSets,
            volumeKg: session.volumeKg,
          }
        : null,
      sessionCount: snap.workouts.length,
    },
    routine: {
      ...snap.routine,
      upcoming,
      overdue,
    },
    reminders: {
      next: nextReminder,
      overdue: overdueOccurrences.map((o) => ({
        id: o.id,
        reminderId: o.reminder.id,
        title: o.reminder.title,
        category: o.reminder.category,
        status: o.status,
        scheduledFor: o.scheduledFor,
        snoozedUntil: o.snoozedUntil,
      })),
    },
    completionScore: snap.score ? { ...snap.score, weights: SCORE_WEIGHTS } : null,
    weekly: {
      from: weekDays[0].date,
      to: date,
      days: series.map((p) => ({
        date: p.date,
        future: p.future,
        dayType: p.dayType,
        foodLogged: p.foodLogged,
        waterLogged: p.waterLogged,
        calories: p.calories,
        protein: p.protein,
        waterMl: p.waterMl,
        calorieTarget: p.calorieTarget,
        calorieMin: p.calorieMin,
        calorieMax: p.calorieMax,
        proteinTarget: p.proteinTarget,
        waterTarget: p.waterTarget,
        workoutDone: p.future ? null : p.workoutCompleted,
        workoutStatus: p.workoutStatus,
        score: p.score,
      })),
    },
    recentActivity,
  };
}
