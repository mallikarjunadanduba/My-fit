import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { badRequest, conflict, notFound } from '../../lib/http';
import { loadPlans, type LoadedDay, type LoadedPlan } from './queries';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const dayInclude = {
  exercises: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { exercise: { select: { id: true, name: true, type: true, imageMediaId: true, archivedAt: true, muscleGroup: true } } },
  },
} satisfies Prisma.WorkoutDayInclude;

export interface PlanInput {
  name: string;
  description?: string | null;
}
export interface DayInput {
  name: string;
  weekday?: number | null;
  isRestDay?: boolean;
  notes?: string | null;
  sortOrder?: number;
}
export interface DayExerciseInput {
  exerciseId: string;
  targetSets?: number | null;
  targetReps?: string | null;
  targetWeightKg?: number | null;
  targetDurationSec?: number | null;
  restSec?: number | null;
  notes?: string | null;
}

/*
 * Round trips: reads are one flat query (./queries). Writes run their ownership/validation lookups in
 * parallel, then one write — at most 2 sequential round trips, no interactive transactions.
 */

const dayExerciseInclude = dayInclude.exercises.include;

async function ownedPlan(userId: string, id: string) {
  const plan = await prisma.workoutPlan.findFirst({ where: { id, userId }, select: { id: true } });
  if (!plan) throw notFound('Workout plan');
  return plan;
}

export async function ownedDay(userId: string, id: string) {
  const day = await prisma.workoutDay.findFirst({ where: { id, plan: { userId } } });
  if (!day) throw notFound('Workout day');
  return day;
}

async function assertExercise(userId: string, exerciseId: string) {
  const ex = await prisma.exercise.findFirst({ where: { id: exerciseId, userId }, select: { id: true } });
  if (!ex) throw notFound('Exercise');
}

function weekdayClash(clash: { name: string } | null, weekday: number | null | undefined) {
  if (clash && weekday != null) throw conflict(`"${clash.name}" is already scheduled on ${WEEKDAY_NAMES[weekday]} in this plan.`);
}

function planSummary(plan: LoadedPlan) {
  const { days, ...p } = plan;
  return {
    ...p,
    dayCount: days.length,
    trainingDays: days.filter((d) => !d.isRestDay).length,
    scheduledWeekdays: days.filter((d) => d.weekday != null && !d.isRestDay).map((d) => d.weekday as number).sort(),
    exerciseCount: days.reduce((n, d) => n + d.exercises.length, 0),
  };
}

export async function listPlans(userId: string) {
  const plans = await loadPlans(Prisma.sql`p."userId" = ${userId}::uuid`);
  return plans.map(planSummary);
}

export async function getPlan(userId: string, id: string) {
  const [plan] = await loadPlans(Prisma.sql`p.id = ${id}::uuid AND p."userId" = ${userId}::uuid`);
  if (!plan) throw notFound('Workout plan');
  return plan;
}

/** Creates a plan; it becomes active when `activate` is true, or by default when it is the user's first plan. One statement. */
export async function createPlan(userId: string, input: PlanInput & { activate?: boolean }) {
  const id = crypto.randomUUID();
  const now = new Date();
  const [row] = await prisma.$queryRaw<{ isActive: boolean }[]>`
    WITH flag AS (
      SELECT COALESCE(${input.activate ?? null}::boolean, NOT EXISTS (SELECT 1 FROM "WorkoutPlan" WHERE "userId" = ${userId}::uuid)) AS active
    ), off AS (
      UPDATE "WorkoutPlan" SET "isActive" = false, "updatedAt" = now()
      WHERE "userId" = ${userId}::uuid AND "isActive" = true AND (SELECT active FROM flag)
      RETURNING id
    )
    INSERT INTO "WorkoutPlan" (id, "userId", name, description, "isActive", "createdAt", "updatedAt")
    SELECT ${id}::uuid, ${userId}::uuid, ${input.name}, ${input.description ?? null}::text, flag.active, ${now}::timestamptz, ${now}::timestamptz
    FROM flag
    RETURNING "isActive"`;
  const plan: LoadedPlan = {
    id,
    userId,
    name: input.name,
    description: input.description ?? null,
    isActive: !!row?.isActive,
    createdAt: now,
    updatedAt: now,
    days: [],
  };
  return plan;
}

/** Runs a plan header write and the plan read in parallel, then overlays the written fields. */
async function writeAndRead(userId: string, id: string, write: Promise<{ count: number }>, overlay: Partial<LoadedPlan>) {
  const [res, plans] = await Promise.all([write, loadPlans(Prisma.sql`p.id = ${id}::uuid AND p."userId" = ${userId}::uuid`)]);
  if (!res.count || !plans[0]) throw notFound('Workout plan');
  const defined = Object.fromEntries(Object.entries(overlay).filter(([, v]) => v !== undefined));
  return { ...plans[0], ...defined };
}

export async function updatePlan(userId: string, id: string, patch: Partial<PlanInput>) {
  return writeAndRead(userId, id, prisma.workoutPlan.updateMany({ where: { id, userId }, data: patch }), patch as Partial<LoadedPlan>);
}

export async function deletePlan(userId: string, id: string) {
  const { count } = await prisma.workoutPlan.deleteMany({ where: { id, userId } }); // sessions keep their snapshots (workoutDayId → null)
  if (!count) throw notFound('Workout plan');
}

/** Exactly one active plan per user. One statement (plus the parallel read). */
export async function activatePlan(userId: string, id: string) {
  const write = prisma.$queryRaw<{ id: string }[]>`
    WITH target AS (SELECT id FROM "WorkoutPlan" WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid),
    off AS (
      UPDATE "WorkoutPlan" SET "isActive" = false, "updatedAt" = now()
      WHERE "userId" = ${userId}::uuid AND "isActive" = true AND id <> ${id}::uuid AND EXISTS (SELECT 1 FROM target)
      RETURNING id
    )
    UPDATE "WorkoutPlan" p SET "isActive" = true, "updatedAt" = now() FROM target WHERE p.id = target.id
    RETURNING p.id`.then((rows) => ({ count: rows.length }));
  return writeAndRead(userId, id, write, { isActive: true });
}

export async function deactivatePlan(userId: string, id: string) {
  return writeAndRead(userId, id, prisma.workoutPlan.updateMany({ where: { id, userId }, data: { isActive: false } }), { isActive: false });
}

// ── Days ──

export async function createDay(userId: string, planId: string, input: DayInput) {
  const [plan, clash, count] = await Promise.all([
    ownedPlan(userId, planId).catch((e: unknown) => e as Error),
    input.weekday != null ? prisma.workoutDay.findFirst({ where: { planId, weekday: input.weekday }, select: { name: true } }) : null,
    input.sortOrder == null ? prisma.workoutDay.count({ where: { planId } }) : 0,
  ]);
  if (plan instanceof Error) throw plan;
  weekdayClash(clash, input.weekday);
  const sortOrder = input.sortOrder ?? count;
  const day = await prisma.workoutDay.create({ data: { ...input, sortOrder, planId } });
  return { ...day, exercises: [] };
}

export async function updateDay(userId: string, id: string, patch: Partial<DayInput>) {
  const [day, clash] = await Promise.all([
    ownedDay(userId, id).catch((e: unknown) => e as Error),
    patch.weekday != null
      ? prisma.workoutDay.findFirst({ where: { weekday: patch.weekday, id: { not: id }, plan: { userId, days: { some: { id } } } }, select: { name: true } })
      : null,
  ]);
  if (day instanceof Error) throw day;
  weekdayClash(clash, patch.weekday);
  return prisma.workoutDay.update({ where: { id }, data: patch, include: dayInclude });
}

export async function deleteDay(userId: string, id: string) {
  const { count } = await prisma.workoutDay.deleteMany({ where: { id, plan: { userId } } });
  if (!count) throw notFound('Workout day');
}

// ── Day exercises ──

export async function addDayExercise(userId: string, dayId: string, input: DayExerciseInput) {
  const [day, ex, last] = await Promise.all([
    ownedDay(userId, dayId).catch((e: unknown) => e as Error),
    assertExercise(userId, input.exerciseId).catch((e: unknown) => e as Error),
    prisma.workoutDayExercise.findFirst({ where: { workoutDayId: dayId }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } }),
  ]);
  if (day instanceof Error) throw day;
  if (ex instanceof Error) throw ex;
  return prisma.workoutDayExercise.create({
    data: { ...input, workoutDayId: dayId, sortOrder: (last?.sortOrder ?? -1) + 1 },
    include: dayExerciseInclude,
  });
}

export async function updateDayExercise(userId: string, id: string, patch: Partial<DayExerciseInput>) {
  const [owned, ex] = await Promise.all([
    prisma.workoutDayExercise.findFirst({ where: { id, workoutDay: { plan: { userId } } }, select: { id: true } }),
    patch.exerciseId ? assertExercise(userId, patch.exerciseId).catch((e: unknown) => e as Error) : null,
  ]);
  if (!owned) throw notFound('Planned exercise');
  if (ex instanceof Error) throw ex;
  return prisma.workoutDayExercise.update({ where: { id }, data: patch, include: dayExerciseInclude });
}

export async function deleteDayExercise(userId: string, id: string) {
  const { count } = await prisma.workoutDayExercise.deleteMany({ where: { id, workoutDay: { plan: { userId } } } });
  if (!count) throw notFound('Planned exercise');
}

/** `ids` must be exactly the day's exercise ids, in the new order. Two round trips: read day, one UPDATE. */
export async function reorderDayExercises(userId: string, dayId: string, ids: string[]): Promise<LoadedDay> {
  const [plan] = await loadPlans(Prisma.sql`p."userId" = ${userId}::uuid AND d.id = ${dayId}::uuid`);
  const day = plan?.days[0];
  if (!day) throw notFound('Workout day');
  const set = new Set(day.exercises.map((e) => e.id));
  if (ids.length !== set.size || new Set(ids).size !== ids.length || ids.some((id) => !set.has(id))) {
    throw badRequest('ids must list every exercise of this day exactly once');
  }
  if (ids.length) {
    const order = JSON.stringify(ids.map((id, i) => ({ id, ord: i })));
    await prisma.$executeRaw`
      UPDATE "WorkoutDayExercise" x SET "sortOrder" = u.ord, "updatedAt" = now()
      FROM json_to_recordset(${order}::json) AS u(id uuid, ord int)
      WHERE x.id = u.id AND x."workoutDayId" = ${dayId}::uuid`;
  }
  const byId = new Map(day.exercises.map((e) => [e.id, e]));
  return { ...day, exercises: ids.map((id, i) => ({ ...byId.get(id)!, sortOrder: i })) };
}
