import type { MealSlot, NutritionTarget, WorkoutSessionStatus } from '@prisma/client';
import { prisma } from '../../db';
import { fromDbDate, todayIn, toDbDate, weekdayOf } from '../../lib/dates';
import { NUTRIENT_KEYS, round1, sumNutrients, targetProgress, type Nutrients, type TargetProgress } from '../../../shared/nutrition';
import { ensureDailyRoutineEntries } from '../routines.service';
import { completionScore, type CompletionScore, type DayKind } from './aggregate';
import { resolveDayType } from './loadDays';
import { loadTargetResolver } from './targets';

export interface UserCtx {
  userId: string;
  timezone: string;
  gymWeekdays: number[];
}

export type MealDayStatus = 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'SKIPPED' | 'LOGGED' | 'NOT_LOGGED';

export function publicTarget(t: NutritionTarget | null) {
  if (!t) return null;
  const { userId: _u, createdAt: _c, updatedAt: _up, ...rest } = t;
  return { ...rest, effectiveFrom: fromDbDate(t.effectiveFrom) };
}

export function nutrientProgress(totals: Nutrients | null, t: NutritionTarget | null) {
  if (!t) return null;
  const n = totals ?? { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
  const out = {} as Record<keyof Nutrients, TargetProgress>;
  for (const k of NUTRIENT_KEYS) {
    out[k] = targetProgress(n[k], t[k], t[`${k}Min` as const], t[`${k}Max` as const]);
  }
  return out;
}

const SESSION_PRIORITY: Record<WorkoutSessionStatus, number> = {
  IN_PROGRESS: 0,
  COMPLETED: 1,
  PLANNED: 2,
  SKIPPED: 3,
};

export interface SnapshotOptions {
  /** Shared loaders (so a caller running several loaders in parallel issues each query once). */
  targetFor?: Promise<(date: string) => NutritionTarget | null>;
  slots?: Promise<MealSlot[]>;
}

/** Active meal slots in display order. */
export function loadActiveSlots(userId: string) {
  return prisma.mealSlot.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

/**
 * Everything recorded for one local date. Materialises routine entries for today/future dates.
 * All queries are flat (no nested includes) and fired in a single parallel wave, so the whole snapshot
 * costs one DB round trip (plus ensureDailyRoutineEntries, which runs alongside).
 */
export async function loadDaySnapshot(ctx: UserCtx, date: string, now: Date = new Date(), opts: SnapshotOptions = {}) {
  const { userId, timezone, gymWeekdays } = ctx;
  const today = todayIn(timezone, now);
  const isFuture = date > today;
  const isPast = date < today;

  const d = toDbDate(date);
  const routineQuery = () =>
    prisma.dailyRoutineEntry.findMany({
      where: { userId, date: d },
      orderBy: [{ scheduledAt: 'asc' }, { sortOrder: 'asc' }],
    });
  const [created, log, targetFor, entries, slots, statuses, templates, waterEntries, sessions, exerciseEntries, sets, routineFirst, measurement] = await Promise.all([
    isPast ? Promise.resolve(0) : ensureDailyRoutineEntries(userId, date, { timezone, gymWeekdays }),
    prisma.dailyLog.findUnique({ where: { userId_date: { userId, date: d } } }),
    opts.targetFor ?? loadTargetResolver(userId),
    prisma.foodDiaryEntry.findMany({
      where: { userId, date: d },
      orderBy: [{ consumedAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        slotId: true,
        foodId: true,
        foodName: true,
        brand: true,
        quantity: true,
        unit: true,
        calories: true,
        protein: true,
        carbs: true,
        fat: true,
        fiber: true,
        isEstimate: true,
        consumedAt: true,
        notes: true,
        createdAt: true,
      },
    }),
    opts.slots ?? loadActiveSlots(userId),
    prisma.dailyMealStatus.findMany({ where: { userId, date: d } }),
    // Plan templates (any day type; filtered in memory) + templates referenced by this day's statuses.
    prisma.mealTemplate.findMany({
      where: {
        userId,
        OR: [{ isPlan: true, archivedAt: null }, { statuses: { some: { userId, date: d } } }],
      },
      select: {
        id: true,
        name: true,
        slotId: true,
        dayType: true,
        isPlan: true,
        archivedAt: true,
      },
    }),
    prisma.waterEntry.findMany({
      where: { userId, date: d },
      orderBy: { loggedAt: 'asc' },
      select: { id: true, amountMl: true, loggedAt: true, note: true },
    }),
    prisma.workoutSession.findMany({
      where: { userId, date: d },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.workoutExerciseEntry.findMany({
      where: { session: { userId, date: d } },
      orderBy: { sortOrder: 'asc' },
    }),
    prisma.workoutSet.findMany({
      where: { entry: { session: { userId, date: d } } },
      orderBy: { setNumber: 'asc' },
    }),
    routineQuery(),
    prisma.bodyMeasurement.findFirst({
      where: { userId, date: d },
      orderBy: { measuredAt: 'desc' },
    }),
  ]);
  // Rows materialised by the parallel ensure call aren't visible to the first read: re-read only then.
  const routineEntries = created > 0 ? await routineQuery() : routineFirst;
  const target = targetFor(date);

  const dayType: DayKind = resolveDayType(log ?? undefined, date, gymWeekdays);

  // Nutrition — missing ≠ zero.
  const foodLogged = entries.length > 0;
  const totals = foodLogged ? sumNutrients(entries) : null;

  // Planned meal templates for each slot on this day type (for display only).
  const plans = templates.filter((p) => p.isPlan && !p.archivedAt && (p.dayType === 'ANY' || p.dayType === dayType));
  const templateName = new Map(templates.map((t) => [t.id, { id: t.id, name: t.name }]));

  const meals = slots.map((slot) => {
    const slotEntries = entries.filter((e) => e.slotId === slot.id);
    const st = statuses.find((s) => s.slotId === slot.id);
    const plan = plans.find((p) => p.slotId === slot.id && p.dayType === dayType) ?? plans.find((p) => p.slotId === slot.id);
    let status: MealDayStatus;
    if (st && st.status !== 'PENDING') status = st.status;
    else if (slotEntries.length) status = 'LOGGED';
    else status = isPast ? 'NOT_LOGGED' : 'PENDING';
    return {
      slotId: slot.id,
      name: slot.name,
      key: slot.key,
      defaultTime: slot.defaultTime,
      status,
      completedAt: st?.completedAt ?? null,
      plannedMeal: (st?.templateId ? templateName.get(st.templateId) : undefined) ?? (plan ? { id: plan.id, name: plan.name } : null),
      entryCount: slotEntries.length,
      totals: slotEntries.length ? sumNutrients(slotEntries) : null,
    };
  });
  const unslotted = entries.filter((e) => !e.slotId || !slots.some((s) => s.id === e.slotId));

  // Water.
  const waterLogged = waterEntries.length > 0;
  const waterTotal = waterLogged ? waterEntries.reduce((s, w) => s + w.amountMl, 0) : null;

  // Workouts.
  const setsByEntry = new Map<string, typeof sets>();
  for (const x of sets) setsByEntry.set(x.entryId, [...(setsByEntry.get(x.entryId) ?? []), x]);
  const entriesBySession = new Map<string, ((typeof exerciseEntries)[number] & { sets: typeof sets })[]>();
  for (const e of exerciseEntries) {
    entriesBySession.set(e.sessionId, [...(entriesBySession.get(e.sessionId) ?? []), { ...e, sets: setsByEntry.get(e.id) ?? [] }]);
  }
  const workouts = sessions.map((session) => {
    const s = { ...session, entries: entriesBySession.get(session.id) ?? [] };
    const sets = s.entries.flatMap((e) => e.sets);
    const volume = sets.filter((x) => x.completed).reduce((sum, x) => sum + (x.reps ?? 0) * (x.weightKg ?? 0), 0);
    return {
      id: s.id,
      name: s.name,
      status: s.status,
      workoutDayId: s.workoutDayId,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      notes: s.notes,
      totalExercises: s.entries.length,
      completedExercises: s.entries.filter((e) => e.status === 'COMPLETED').length,
      totalSets: sets.length,
      completedSets: sets.filter((x) => x.completed).length,
      volumeKg: round1(volume),
      exercises: s.entries.map((e) => ({
        id: e.id,
        exerciseId: e.exerciseId,
        name: e.exerciseName,
        status: e.status,
        notes: e.notes,
        sets: e.sets.map((x) => ({
          setNumber: x.setNumber,
          reps: x.reps,
          weightKg: x.weightKg,
          durationSec: x.durationSec,
          completed: x.completed,
        })),
      })),
    };
  });
  const primarySession = [...workouts].sort((a, b) => SESSION_PRIORITY[a.status] - SESSION_PRIORITY[b.status])[0] ?? null;

  // Routine.
  const routineTotal = routineEntries.length;
  const routineCompleted = routineEntries.filter((r) => r.status === 'COMPLETED').length;
  const routineSkipped = routineEntries.filter((r) => r.status === 'SKIPPED').length;
  const routine = {
    total: routineTotal,
    completed: routineCompleted,
    skipped: routineSkipped,
    pending: routineEntries.filter((r) => r.status === 'PENDING' || r.status === 'SNOOZED').length,
    missed: routineEntries.filter((r) => r.status === 'MISSED').length,
    completionPct: routineTotal ? Math.round((routineCompleted / routineTotal) * 100) : null,
  };

  const score: CompletionScore | null = isFuture
    ? null
    : completionScore({
        dayType,
        nutrition: totals,
        waterMl: waterTotal,
        target,
        meals: {
          planned: slots.length,
          completed: statuses.filter((s) => s.status === 'COMPLETED' && slots.some((x) => x.id === s.slotId)).length,
          partial: statuses.filter((s) => s.status === 'PARTIAL' && slots.some((x) => x.id === s.slotId)).length,
          skipped: statuses.filter((s) => s.status === 'SKIPPED' && slots.some((x) => x.id === s.slotId)).length,
        },
        workout: {
          sessions: workouts.filter((w) => w.status !== 'SKIPPED').length,
          completed: workouts.filter((w) => w.status === 'COMPLETED').length,
          inProgress: workouts.filter((w) => w.status === 'IN_PROGRESS').length,
        },
        routine: {
          total: routineTotal,
          completed: routineCompleted,
          skipped: routineSkipped,
        },
      });

  return {
    date,
    today,
    weekday: weekdayOf(date),
    isToday: date === today,
    isFuture,
    isPast,
    timezone: log?.timezone ?? timezone,
    dayType,
    dayTypeOverride: log?.dayType && log.dayType !== 'ANY' ? log.dayType : null,
    notes: log?.notes ?? null,
    log: log ? { id: log.id, createdAt: log.createdAt, updatedAt: log.updatedAt } : null,
    target,
    nutrition: {
      logged: foodLogged,
      totals,
      target: publicTarget(target),
      progress: nutrientProgress(totals, target),
      remainingCalories: target ? round1(Math.max(0, target.calories - (totals?.calories ?? 0))) : null,
      entryCount: entries.length,
      entries,
      unslotted: unslotted.length ? { entryCount: unslotted.length, totals: sumNutrients(unslotted) } : null,
    },
    water: {
      logged: waterLogged,
      totalMl: waterTotal,
      targetMl: target?.waterMl ?? null,
      progress: target ? targetProgress(waterTotal ?? 0, target.waterMl, target.waterMinMl, target.waterMaxMl) : null,
      entries: waterEntries,
    },
    meals,
    workouts,
    primarySession,
    routine,
    routineEntries,
    measurement,
    score,
  };
}

export type DaySnapshot = Awaited<ReturnType<typeof loadDaySnapshot>>;
