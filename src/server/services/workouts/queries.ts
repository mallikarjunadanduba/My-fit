import { Prisma, type ExerciseType, type ItemStatus, type WorkoutSessionStatus } from '@prisma/client';
import { prisma } from '../../db';
import { fromDbDate } from '../../lib/dates';
import { sessionDurationSec, sessionStats } from './stats';

/**
 * Single-statement loaders for sessions and plans.
 *
 * Prisma `include` trees run one query per relation level (sequentially), which costs a full DB round
 * trip each on a high-latency link. These loaders fetch the whole tree with one flat LEFT JOIN and
 * assemble it in memory, so a read is always exactly one round trip.
 */

// ── Sessions ──

export interface SerializedSet {
  id: string;
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  completed: boolean;
  completedAt: string | null;
}

export interface SerializedEntry {
  id: string;
  exerciseId: string | null;
  exerciseName: string;
  exercise: { id: string; name: string; type: ExerciseType; imageMediaId: string | null } | null;
  sortOrder: number;
  status: ItemStatus;
  restSec: number | null;
  notes: string | null;
  sets: SerializedSet[];
}

export interface SessionHeader {
  id: string;
  date: string;
  name: string;
  status: WorkoutSessionStatus;
  notes: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  workoutDayId: string | null;
  workoutDay: { id: string; name: string; plan: { id: string; name: string } } | null;
}

export type SerializedSession = SessionHeader & {
  durationSec: number | null;
  stats: ReturnType<typeof sessionStats>;
  entries: SerializedEntry[];
};

interface SessionJoinRow {
  id: string;
  date: Date;
  name: string;
  status: WorkoutSessionStatus;
  notes: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  workoutDayId: string | null;
  dayName: string | null;
  planId: string | null;
  planName: string | null;
  entryId: string | null;
  exerciseId: string | null;
  exerciseName: string | null;
  sortOrder: number | null;
  entryStatus: ItemStatus | null;
  restSec: number | null;
  entryNotes: string | null;
  exId: string | null;
  exName: string | null;
  exType: ExerciseType | null;
  exImage: string | null;
  setId: string | null;
  setNumber: number | null;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  completed: boolean | null;
  completedAt: Date | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Adds the derived fields (duration, stats) to a session tree. */
export function finalizeSession(header: SessionHeader, entries: SerializedEntry[]): SerializedSession {
  return {
    ...header,
    durationSec: sessionDurationSec(header.startedAt ? new Date(header.startedAt) : null, header.finishedAt ? new Date(header.finishedAt) : null),
    stats: sessionStats(entries),
    entries,
  };
}

/**
 * Loads full session trees matching `where` (a SQL condition on alias `s`) in one query.
 * Sessions keep the order given by `orderBy` (SQL on alias `s`); entries/sets use their natural order.
 */
export async function loadSessions(where: Prisma.Sql, orderBy: Prisma.Sql = Prisma.sql`s."createdAt" ASC`): Promise<SerializedSession[]> {
  const rows = await prisma.$queryRaw<SessionJoinRow[]>`
    SELECT s.id, s.date, s.name, s.status::text AS status, s.notes, s."startedAt", s."finishedAt", s."createdAt", s."workoutDayId",
           wd.name AS "dayName", p.id AS "planId", p.name AS "planName",
           e.id AS "entryId", e."exerciseId", e."exerciseName", e."sortOrder", e.status::text AS "entryStatus", e."restSec", e.notes AS "entryNotes",
           x.id AS "exId", x.name AS "exName", x.type::text AS "exType", x."imageMediaId" AS "exImage",
           t.id AS "setId", t."setNumber", t.reps, t."weightKg", t."durationSec", t.completed, t."completedAt"
    FROM "WorkoutSession" s
    LEFT JOIN "WorkoutDay" wd ON wd.id = s."workoutDayId"
    LEFT JOIN "WorkoutPlan" p ON p.id = wd."planId"
    LEFT JOIN "WorkoutExerciseEntry" e ON e."sessionId" = s.id
    LEFT JOIN "Exercise" x ON x.id = e."exerciseId"
    LEFT JOIN "WorkoutSet" t ON t."entryId" = e.id
    WHERE ${where}
    ORDER BY ${orderBy}, s.id, e."sortOrder" ASC, e."createdAt" ASC, e.id, t."setNumber" ASC`;

  const sessions = new Map<string, { header: SessionHeader; entries: Map<string, SerializedEntry> }>();
  for (const r of rows) {
    let s = sessions.get(r.id);
    if (!s) {
      s = {
        header: {
          id: r.id,
          date: fromDbDate(r.date),
          name: r.name,
          status: r.status,
          notes: r.notes,
          startedAt: iso(r.startedAt),
          finishedAt: iso(r.finishedAt),
          createdAt: r.createdAt.toISOString(),
          workoutDayId: r.workoutDayId,
          workoutDay: r.workoutDayId && r.dayName != null && r.planId ? { id: r.workoutDayId, name: r.dayName, plan: { id: r.planId, name: r.planName ?? '' } } : null,
        },
        entries: new Map(),
      };
      sessions.set(r.id, s);
    }
    if (!r.entryId) continue;
    let e = s.entries.get(r.entryId);
    if (!e) {
      e = {
        id: r.entryId,
        exerciseId: r.exerciseId,
        exerciseName: r.exerciseName ?? '',
        exercise: r.exId ? { id: r.exId, name: r.exName ?? '', type: r.exType ?? 'STRENGTH', imageMediaId: r.exImage } : null,
        sortOrder: r.sortOrder ?? 0,
        status: r.entryStatus ?? 'PENDING',
        restSec: r.restSec,
        notes: r.entryNotes,
        sets: [],
      };
      s.entries.set(r.entryId, e);
    }
    if (r.setId) {
      e.sets.push({
        id: r.setId,
        setNumber: r.setNumber ?? 0,
        reps: r.reps,
        weightKg: r.weightKg,
        durationSec: r.durationSec,
        completed: !!r.completed,
        completedAt: iso(r.completedAt),
      });
    }
  }
  return [...sessions.values()].map((s) => finalizeSession(s.header, [...s.entries.values()]));
}

/** Compact view for lists (schedule, history). */
export function summarizeSession(s: SerializedSession) {
  const { entries, ...rest } = s;
  return {
    ...rest,
    exercises: entries.map((e) => ({
      id: e.id,
      exerciseName: e.exerciseName,
      status: e.status,
      completedSets: e.sets.filter((x) => x.completed).length,
      totalSets: e.sets.length,
    })),
  };
}

// ── Plans ──

export interface PlanExerciseRef {
  id: string;
  name: string;
  type: ExerciseType;
  imageMediaId: string | null;
  archivedAt: Date | null;
  muscleGroup: string | null;
}

export interface LoadedDayExercise {
  id: string;
  workoutDayId: string;
  exerciseId: string;
  sortOrder: number;
  targetSets: number | null;
  targetReps: string | null;
  targetWeightKg: number | null;
  targetDurationSec: number | null;
  restSec: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  exercise: PlanExerciseRef;
}

export interface LoadedDay {
  id: string;
  planId: string;
  weekday: number | null;
  name: string;
  isRestDay: boolean;
  sortOrder: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  exercises: LoadedDayExercise[];
}

export interface LoadedPlan {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  days: LoadedDay[];
}

interface PlanJoinRow {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  dId: string | null;
  dWeekday: number | null;
  dName: string | null;
  dIsRestDay: boolean | null;
  dSortOrder: number | null;
  dNotes: string | null;
  dCreatedAt: Date | null;
  dUpdatedAt: Date | null;
  iId: string | null;
  iExerciseId: string | null;
  iSortOrder: number | null;
  targetSets: number | null;
  targetReps: string | null;
  targetWeightKg: number | null;
  targetDurationSec: number | null;
  iRestSec: number | null;
  iNotes: string | null;
  iCreatedAt: Date | null;
  iUpdatedAt: Date | null;
  xName: string | null;
  xType: ExerciseType | null;
  xImage: string | null;
  xArchivedAt: Date | null;
  xMuscle: string | null;
}

/**
 * Loads plans (with days → planned exercises → exercise) matching `where` (SQL on aliases `p` and `d`)
 * in one query. Days are ordered by sortOrder, weekday, createdAt; planned exercises by sortOrder, createdAt.
 */
export async function loadPlans(where: Prisma.Sql, orderBy: Prisma.Sql = Prisma.sql`p."isActive" DESC, p."createdAt" ASC`): Promise<LoadedPlan[]> {
  const rows = await prisma.$queryRaw<PlanJoinRow[]>`
    SELECT p.id, p."userId", p.name, p.description, p."isActive", p."createdAt", p."updatedAt",
           d.id AS "dId", d.weekday AS "dWeekday", d.name AS "dName", d."isRestDay" AS "dIsRestDay", d."sortOrder" AS "dSortOrder",
           d.notes AS "dNotes", d."createdAt" AS "dCreatedAt", d."updatedAt" AS "dUpdatedAt",
           i.id AS "iId", i."exerciseId" AS "iExerciseId", i."sortOrder" AS "iSortOrder", i."targetSets", i."targetReps", i."targetWeightKg",
           i."targetDurationSec", i."restSec" AS "iRestSec", i.notes AS "iNotes", i."createdAt" AS "iCreatedAt", i."updatedAt" AS "iUpdatedAt",
           x.name AS "xName", x.type::text AS "xType", x."imageMediaId" AS "xImage", x."archivedAt" AS "xArchivedAt", x."muscleGroup" AS "xMuscle"
    FROM "WorkoutPlan" p
    LEFT JOIN "WorkoutDay" d ON d."planId" = p.id
    LEFT JOIN "WorkoutDayExercise" i ON i."workoutDayId" = d.id
    LEFT JOIN "Exercise" x ON x.id = i."exerciseId"
    WHERE ${where}
    ORDER BY ${orderBy}, p.id, d."sortOrder" ASC, d.weekday ASC NULLS LAST, d."createdAt" ASC, d.id, i."sortOrder" ASC, i."createdAt" ASC`;

  const plans = new Map<string, LoadedPlan & { dayMap: Map<string, LoadedDay> }>();
  for (const r of rows) {
    let p = plans.get(r.id);
    if (!p) {
      p = {
        id: r.id,
        userId: r.userId,
        name: r.name,
        description: r.description,
        isActive: r.isActive,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        days: [],
        dayMap: new Map(),
      };
      plans.set(r.id, p);
    }
    if (!r.dId) continue;
    let d = p.dayMap.get(r.dId);
    if (!d) {
      d = {
        id: r.dId,
        planId: r.id,
        weekday: r.dWeekday,
        name: r.dName ?? '',
        isRestDay: !!r.dIsRestDay,
        sortOrder: r.dSortOrder ?? 0,
        notes: r.dNotes,
        createdAt: r.dCreatedAt ?? r.createdAt,
        updatedAt: r.dUpdatedAt ?? r.updatedAt,
        exercises: [],
      };
      p.dayMap.set(r.dId, d);
      p.days.push(d);
    }
    if (r.iId && r.iExerciseId) {
      d.exercises.push({
        id: r.iId,
        workoutDayId: r.dId,
        exerciseId: r.iExerciseId,
        sortOrder: r.iSortOrder ?? 0,
        targetSets: r.targetSets,
        targetReps: r.targetReps,
        targetWeightKg: r.targetWeightKg,
        targetDurationSec: r.targetDurationSec,
        restSec: r.iRestSec,
        notes: r.iNotes,
        createdAt: r.iCreatedAt ?? r.createdAt,
        updatedAt: r.iUpdatedAt ?? r.updatedAt,
        exercise: {
          id: r.iExerciseId,
          name: r.xName ?? '',
          type: r.xType ?? 'STRENGTH',
          imageMediaId: r.xImage,
          archivedAt: r.xArchivedAt,
          muscleGroup: r.xMuscle,
        },
      });
    }
  }
  return [...plans.values()].map(({ dayMap: _dayMap, ...p }) => p);
}

/** The user's active plan (or null), in one query. */
export async function loadActivePlan(userId: string): Promise<LoadedPlan | null> {
  const [plan] = await loadPlans(Prisma.sql`p."userId" = ${userId}::uuid AND p."isActive" = true`, Prisma.sql`p."createdAt" ASC`);
  return plan ?? null;
}

/** Maps a unique-violation from a raw statement to a friendly 409. */
export function isUniqueViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return true;
    const meta = err.meta as { code?: string } | undefined;
    if (err.code === 'P2010' && meta?.code === '23505') return true;
  }
  return false;
}
