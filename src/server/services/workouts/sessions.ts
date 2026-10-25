import crypto from 'node:crypto';
import { Prisma, type ExerciseType, type ItemStatus, type WorkoutSessionStatus } from '@prisma/client';
import { prisma } from '../../db';
import { badRequest, conflict, notFound, pageMeta } from '../../lib/http';
import { toDbDate } from '../../lib/dates';
import {
  finalizeSession,
  isUniqueViolation,
  loadPlans,
  loadSessions,
  summarizeSession,
  type SerializedEntry,
  type SerializedSession,
  type SerializedSet,
  type SessionHeader,
} from './queries';
import { parseRepsLowerBound } from './stats';

/*
 * Performance notes (high-latency DB): every function here aims for one round trip.
 *  - Reads use the flat single-query loaders in ./queries.
 *  - Writes are single SQL statements that check ownership in the same statement (data-modifying CTEs),
 *    so there is no separate "find owned row" query and no interactive transaction.
 *  - Set/entry writes return only what changed; the client merges it into its session state.
 */

export { summarizeSession };
export type { SerializedSession };

const sessionOrder = Prisma.sql`s."createdAt" ASC`;

export async function getSession(userId: string, id: string) {
  const [s] = await loadSessions(Prisma.sql`s.id = ${id}::uuid AND s."userId" = ${userId}::uuid`, sessionOrder);
  if (!s) throw notFound('Workout session');
  return s;
}

export interface CreateSessionInput {
  date: string;
  workoutDayId?: string | null;
  name?: string;
  start?: boolean;
}

interface HeaderRow {
  id: string;
  name: string;
  status: WorkoutSessionStatus;
  notes: string | null;
  date: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** Overlays fresh header columns (from an UPDATE … RETURNING) onto a session read in parallel. */
function withHeader(s: SerializedSession, h: HeaderRow): SerializedSession {
  const header: SessionHeader = {
    ...s,
    name: h.name,
    status: h.status,
    notes: h.notes,
    date: h.date.toISOString().slice(0, 10),
    startedAt: h.startedAt?.toISOString() ?? null,
    finishedAt: h.finishedAt?.toISOString() ?? null,
  };
  return finalizeSession(header, s.entries);
}

/**
 * Creates a session, pre-filling entries and set rows from the plan day template (names and targets are
 * snapshotted). If an unfinished session for the same day template and date already exists it is returned
 * instead (so repeated "Start workout" taps do not create duplicates). Returns `{ session, created }`.
 *
 * Round trips: 1 (day template + existing session, in parallel) + 1 (single INSERT statement, or the
 * optional start UPDATE). The response is assembled in memory — no re-read.
 */
export async function createSession(userId: string, input: CreateSessionInput) {
  const [plans, existing] = await Promise.all([
    input.workoutDayId
      ? loadPlans(Prisma.sql`p."userId" = ${userId}::uuid AND d.id = ${input.workoutDayId}::uuid`)
      : Promise.resolve([]),
    input.workoutDayId
      ? loadSessions(
          Prisma.sql`s.id = (SELECT id FROM "WorkoutSession" WHERE "userId" = ${userId}::uuid AND date = ${input.date}::date
                       AND "workoutDayId" = ${input.workoutDayId}::uuid AND status IN ('PLANNED', 'IN_PROGRESS')
                       ORDER BY "createdAt" DESC LIMIT 1)`,
        )
      : Promise.resolve([]),
  ]);
  const plan = plans[0];
  const day = plan?.days[0] ?? null;
  if (input.workoutDayId && !day) throw notFound('Workout day');

  const found = existing[0];
  if (found) {
    if (input.start && found.status === 'PLANNED') {
      const [h] = await prisma.$queryRaw<HeaderRow[]>`
        UPDATE "WorkoutSession" SET status = 'IN_PROGRESS', "startedAt" = COALESCE("startedAt", now()), "updatedAt" = now()
        WHERE id = ${found.id}::uuid AND "userId" = ${userId}::uuid
        RETURNING id, name, status::text AS status, notes, date, "startedAt", "finishedAt"`;
      return { session: h ? withHeader(found, h) : found, created: false };
    }
    return { session: found, created: false };
  }

  const now = new Date();
  const sessionId = crypto.randomUUID();
  const name = input.name?.trim() || day?.name || 'Workout';
  const status: WorkoutSessionStatus = input.start ? 'IN_PROGRESS' : 'PLANNED';
  const entries: SerializedEntry[] = (day?.exercises ?? []).map((item, i) => {
    const setCount = Math.max(1, Math.min(item.targetSets ?? 1, 20));
    const reps = parseRepsLowerBound(item.targetReps);
    return {
      id: crypto.randomUUID(),
      exerciseId: item.exerciseId,
      exerciseName: item.exercise.name,
      exercise: { id: item.exercise.id, name: item.exercise.name, type: item.exercise.type, imageMediaId: item.exercise.imageMediaId },
      sortOrder: i,
      status: 'PENDING',
      restSec: item.restSec,
      notes: item.notes,
      sets: Array.from({ length: setCount }, (_, n) => ({
        id: crypto.randomUUID(),
        setNumber: n + 1,
        reps,
        weightKg: item.targetWeightKg,
        durationSec: item.targetDurationSec,
        completed: false,
        completedAt: null,
      })),
    };
  });
  const entryJson = JSON.stringify(entries.map((e) => ({ id: e.id, ex: e.exerciseId, name: e.exerciseName, ord: e.sortOrder, rest: e.restSec, notes: e.notes })));
  const setJson = JSON.stringify(
    entries.flatMap((e) => e.sets.map((s) => ({ id: s.id, entry: e.id, n: s.setNumber, reps: s.reps, w: s.weightKg, d: s.durationSec }))),
  );

  // One statement: session + entries + sets. FK checks run at end of statement, so the order of the CTEs is irrelevant.
  await prisma.$executeRaw`
    WITH s AS (
      INSERT INTO "WorkoutSession" (id, "userId", date, "workoutDayId", name, status, "startedAt", "createdAt", "updatedAt")
      VALUES (${sessionId}::uuid, ${userId}::uuid, ${input.date}::date, ${day?.id ?? null}::uuid, ${name}, ${status}::"WorkoutSessionStatus",
              ${input.start ? now : null}::timestamptz, ${now}::timestamptz, ${now}::timestamptz)
      RETURNING id
    ), e AS (
      INSERT INTO "WorkoutExerciseEntry" (id, "sessionId", "exerciseId", "exerciseName", "sortOrder", "restSec", notes, "createdAt", "updatedAt")
      SELECT u.id, ${sessionId}::uuid, u.ex, u.name, u.ord, u.rest, u.notes, ${now}::timestamptz, ${now}::timestamptz
      FROM json_to_recordset(${entryJson}::json) AS u(id uuid, ex uuid, name text, ord int, rest int, notes text)
      RETURNING id
    )
    INSERT INTO "WorkoutSet" (id, "entryId", "setNumber", reps, "weightKg", "durationSec", "createdAt", "updatedAt")
    SELECT u.id, u.entry, u.n, u.reps, u.w, u.d, ${now}::timestamptz, ${now}::timestamptz
    FROM json_to_recordset(${setJson}::json) AS u(id uuid, entry uuid, n int, reps int, w float8, d int)`;

  const header: SessionHeader = {
    id: sessionId,
    date: input.date,
    name,
    status,
    notes: null,
    startedAt: input.start ? now.toISOString() : null,
    finishedAt: null,
    createdAt: now.toISOString(),
    workoutDayId: day?.id ?? null,
    workoutDay: day && plan ? { id: day.id, name: day.name, plan: { id: plan.id, name: plan.name } } : null,
  };
  return { session: finalizeSession(header, entries), created: true };
}

export interface ListSessionsQuery {
  from?: string;
  to?: string;
  status?: WorkoutSessionStatus;
  page: number;
  pageSize: number;
}

export async function listSessions(userId: string, q: ListSessionsQuery) {
  const where: Prisma.WorkoutSessionWhereInput = {
    userId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
  };
  const cond = Prisma.sql`"userId" = ${userId}::uuid
    AND (${q.status ?? null}::text IS NULL OR status::text = ${q.status ?? null}::text)
    AND (${q.from ?? null}::date IS NULL OR date >= ${q.from ?? null}::date)
    AND (${q.to ?? null}::date IS NULL OR date <= ${q.to ?? null}::date)`;
  const [rows, total] = await Promise.all([
    loadSessions(
      Prisma.sql`s.id IN (SELECT id FROM "WorkoutSession" WHERE ${cond} ORDER BY date DESC, "createdAt" DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize})`,
      Prisma.sql`s.date DESC, s."createdAt" DESC`,
    ),
    prisma.workoutSession.count({ where }),
  ]);
  return { data: rows.map(summarizeSession), meta: pageMeta(q.page, q.pageSize, total) };
}

/** Runs a header UPDATE and the session read in parallel (one round trip) and merges them. */
async function updateHeader(userId: string, id: string, update: Promise<HeaderRow[]>, onMissing?: (s: SerializedSession) => Error) {
  const [rows, sessions] = await Promise.all([update, loadSessions(Prisma.sql`s.id = ${id}::uuid AND s."userId" = ${userId}::uuid`)]);
  const s = sessions[0];
  if (!s) throw notFound('Workout session');
  if (!rows[0]) throw onMissing ? onMissing(s) : notFound('Workout session');
  return withHeader(s, rows[0]);
}

export async function updateSession(userId: string, id: string, patch: { name?: string; notes?: string | null; date?: string }) {
  const has = (k: keyof typeof patch) => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;
  return updateHeader(
    userId,
    id,
    prisma.$queryRaw<HeaderRow[]>`
      UPDATE "WorkoutSession" SET
        name = CASE WHEN ${has('name')} THEN ${patch.name ?? null}::text ELSE name END,
        notes = CASE WHEN ${has('notes')} THEN ${patch.notes ?? null}::text ELSE notes END,
        date = CASE WHEN ${has('date')} THEN ${patch.date ?? null}::date ELSE date END,
        "updatedAt" = now()
      WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid
      RETURNING id, name, status::text AS status, notes, date, "startedAt", "finishedAt"`,
  );
}

export async function deleteSession(userId: string, id: string) {
  const { count } = await prisma.workoutSession.deleteMany({ where: { id, userId } });
  if (!count) throw notFound('Workout session');
}

export async function startSession(userId: string, id: string) {
  return updateHeader(
    userId,
    id,
    prisma.$queryRaw<HeaderRow[]>`
      UPDATE "WorkoutSession" SET status = 'IN_PROGRESS', "startedAt" = COALESCE("startedAt", now()), "finishedAt" = NULL, "updatedAt" = now()
      WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid AND status <> 'COMPLETED'
      RETURNING id, name, status::text AS status, notes, date, "startedAt", "finishedAt"`,
    () => conflict('This workout is already finished.'),
  );
}

/** Marks the session COMPLETED. Unfinished entries are left as they are; stats reflect completed sets only. */
export async function finishSession(userId: string, id: string) {
  return updateHeader(
    userId,
    id,
    prisma.$queryRaw<HeaderRow[]>`
      UPDATE "WorkoutSession" SET
        "startedAt" = COALESCE("startedAt", now()),
        "finishedAt" = CASE WHEN status = 'COMPLETED' AND "finishedAt" IS NOT NULL THEN "finishedAt" ELSE now() END,
        status = 'COMPLETED',
        "updatedAt" = now()
      WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid AND status <> 'SKIPPED'
      RETURNING id, name, status::text AS status, notes, date, "startedAt", "finishedAt"`,
    () => conflict('This workout was skipped. Start it first to log it.'),
  );
}

export async function skipSession(userId: string, id: string) {
  return updateHeader(
    userId,
    id,
    prisma.$queryRaw<HeaderRow[]>`
      UPDATE "WorkoutSession" SET status = 'SKIPPED', "finishedAt" = NULL, "updatedAt" = now()
      WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid AND status <> 'COMPLETED'
      RETURNING id, name, status::text AS status, notes, date, "startedAt", "finishedAt"`,
    () => conflict('A finished workout cannot be skipped.'),
  );
}

// ── Entries ──

interface SetRow {
  id: string;
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  completed: boolean;
  completedAt: Date | null;
}

const toSet = (r: SetRow): SerializedSet => ({
  id: r.id,
  setNumber: r.setNumber,
  reps: r.reps,
  weightKg: r.weightKg,
  durationSec: r.durationSec,
  completed: r.completed,
  completedAt: r.completedAt?.toISOString() ?? null,
});

/** Appends an exercise (with `sets` empty set rows) to a session. Returns the new entry. One statement. */
export async function addEntry(
  userId: string,
  sessionId: string,
  input: { exerciseId?: string; exerciseName?: string; restSec?: number | null; sets?: number },
): Promise<SerializedEntry> {
  const name = input.exerciseName?.trim() || null;
  if (!input.exerciseId && !name) throw badRequest('Provide exerciseId or exerciseName');
  const now = new Date();
  const entryId = crypto.randomUUID();
  const restSec = input.restSec === undefined ? 90 : input.restSec;
  const sets = Array.from({ length: input.sets ?? 1 }, (_, n) => ({ id: crypto.randomUUID(), n: n + 1 }));
  const [r] = await prisma.$queryRaw<
    { hasSession: number; hasExercise: number; id: string | null; exerciseId: string | null; exerciseName: string | null; sortOrder: number | null; exType: string | null; exImage: string | null }[]
  >`
    WITH s AS (SELECT id FROM "WorkoutSession" WHERE id = ${sessionId}::uuid AND "userId" = ${userId}::uuid),
    x AS (SELECT id, name, type, "imageMediaId" FROM "Exercise" WHERE id = ${input.exerciseId ?? null}::uuid AND "userId" = ${userId}::uuid),
    ins AS (
      INSERT INTO "WorkoutExerciseEntry" (id, "sessionId", "exerciseId", "exerciseName", "sortOrder", "restSec", "createdAt", "updatedAt")
      SELECT ${entryId}::uuid, s.id, x.id, COALESCE(x.name, ${name}::text),
             COALESCE((SELECT MAX("sortOrder") FROM "WorkoutExerciseEntry" WHERE "sessionId" = s.id), -1) + 1,
             ${restSec}::int, ${now}::timestamptz, ${now}::timestamptz
      FROM s LEFT JOIN x ON true
      WHERE ${input.exerciseId ?? null}::uuid IS NULL OR x.id IS NOT NULL
      RETURNING id, "exerciseId", "exerciseName", "sortOrder"
    ), st AS (
      INSERT INTO "WorkoutSet" (id, "entryId", "setNumber", "createdAt", "updatedAt")
      SELECT u.id, ins.id, u.n, ${now}::timestamptz, ${now}::timestamptz
      FROM ins, json_to_recordset(${JSON.stringify(sets)}::json) AS u(id uuid, n int)
      RETURNING id
    )
    SELECT (SELECT count(*) FROM s)::int AS "hasSession", (SELECT count(*) FROM x)::int AS "hasExercise",
           ins.id, ins."exerciseId", ins."exerciseName", ins."sortOrder", x.type::text AS "exType", x."imageMediaId" AS "exImage"
    FROM (SELECT 1) one LEFT JOIN ins ON true LEFT JOIN x ON true`;
  if (!r?.hasSession) throw notFound('Workout session');
  if (input.exerciseId && !r.hasExercise) throw notFound('Exercise');
  if (!r.id) throw notFound('Workout session');
  return {
    id: r.id,
    exerciseId: r.exerciseId,
    exerciseName: r.exerciseName ?? '',
    exercise: r.exerciseId ? { id: r.exerciseId, name: r.exerciseName ?? '', type: (r.exType ?? 'STRENGTH') as ExerciseType, imageMediaId: r.exImage } : null,
    sortOrder: r.sortOrder ?? 0,
    status: 'PENDING',
    restSec,
    notes: null,
    sets: sets.map((s) => ({ id: s.id, setNumber: s.n, reps: null, weightKg: null, durationSec: null, completed: false, completedAt: null })),
  };
}

export interface EntryPatchResult {
  id: string;
  sessionId: string;
  status: ItemStatus;
  notes: string | null;
  restSec: number | null;
}

/** Updates status/notes/rest of an entry. Returns the entry's updated fields. One statement. */
export async function updateEntry(userId: string, id: string, patch: { status?: ItemStatus; notes?: string | null; restSec?: number | null }) {
  const has = (k: keyof typeof patch) => patch[k] !== undefined;
  const [row] = await prisma.$queryRaw<EntryPatchResult[]>`
    UPDATE "WorkoutExerciseEntry" e SET
      status = CASE WHEN ${has('status')} THEN ${patch.status ?? null}::"ItemStatus" ELSE e.status END,
      notes = CASE WHEN ${has('notes')} THEN ${patch.notes ?? null}::text ELSE e.notes END,
      "restSec" = CASE WHEN ${has('restSec')} THEN ${patch.restSec ?? null}::int ELSE e."restSec" END,
      "updatedAt" = now()
    FROM "WorkoutSession" s
    WHERE e.id = ${id}::uuid AND s.id = e."sessionId" AND s."userId" = ${userId}::uuid
    RETURNING e.id, e."sessionId", e.status::text AS status, e.notes, e."restSec"`;
  if (!row) throw notFound('Exercise entry');
  return row;
}

export async function deleteEntry(userId: string, id: string) {
  const n = await prisma.$executeRaw`
    DELETE FROM "WorkoutExerciseEntry" e USING "WorkoutSession" s
    WHERE e.id = ${id}::uuid AND s.id = e."sessionId" AND s."userId" = ${userId}::uuid`;
  if (!n) throw notFound('Exercise entry');
}

// ── Sets ──

/**
 * Adds a set to an entry. Omitted fields copy the previous set — the usual "add another set like the last one".
 * Returns `{ entryId, set }`. One statement.
 */
export async function addSet(userId: string, entryId: string, input: { reps?: number | null; weightKg?: number | null; durationSec?: number | null }) {
  const now = new Date();
  const run = () => prisma.$queryRaw<SetRow[]>`
    WITH e AS (
      SELECT e.id FROM "WorkoutExerciseEntry" e JOIN "WorkoutSession" s ON s.id = e."sessionId"
      WHERE e.id = ${entryId}::uuid AND s."userId" = ${userId}::uuid
    ), last AS (
      SELECT "setNumber", reps, "weightKg", "durationSec" FROM "WorkoutSet" WHERE "entryId" = ${entryId}::uuid ORDER BY "setNumber" DESC LIMIT 1
    )
    INSERT INTO "WorkoutSet" (id, "entryId", "setNumber", reps, "weightKg", "durationSec", "createdAt", "updatedAt")
    SELECT ${crypto.randomUUID()}::uuid, e.id, COALESCE(last."setNumber", 0) + 1,
           CASE WHEN ${input.reps !== undefined} THEN ${input.reps ?? null}::int ELSE last.reps END,
           CASE WHEN ${input.weightKg !== undefined} THEN ${input.weightKg ?? null}::float8 ELSE last."weightKg" END,
           CASE WHEN ${input.durationSec !== undefined} THEN ${input.durationSec ?? null}::int ELSE last."durationSec" END,
           ${now}::timestamptz, ${now}::timestamptz
    FROM e LEFT JOIN last ON true
    RETURNING id, "setNumber", reps, "weightKg", "durationSec", completed, "completedAt"`;
  let rows: SetRow[];
  try {
    rows = await run();
  } catch (err) {
    // Two taps raced for the same set number — retry once with the new last set.
    if (!isUniqueViolation(err)) throw err;
    rows = await run();
  }
  if (!rows[0]) throw notFound('Exercise entry');
  return { entryId, set: toSet(rows[0]) };
}

export interface SetPatchResult {
  set: SerializedSet;
  entry: { id: string; status: ItemStatus };
  session: { id: string; status: WorkoutSessionStatus; startedAt: string | null };
}

/**
 * Updates a set. Completing a set also: starts a PLANNED session, and marks the exercise COMPLETED
 * once every set is done (unchecking never reverts the exercise status automatically).
 * One statement; returns the set plus the (possibly) changed entry/session status.
 */
export async function updateSet(
  userId: string,
  id: string,
  patch: { reps?: number | null; weightKg?: number | null; durationSec?: number | null; completed?: boolean },
): Promise<SetPatchResult> {
  const now = new Date();
  const hasC = patch.completed !== undefined;
  const completing = patch.completed === true;
  const [r] = await prisma.$queryRaw<
    (SetRow & { entryId: string; entryStatus: ItemStatus; sessionId: string; sessionStatus: WorkoutSessionStatus; sessionStartedAt: Date | null })[]
  >`
    WITH t AS (
      SELECT w.id, w."entryId", e."sessionId", e.status AS "entryStatus", s.status AS "sessionStatus", s."startedAt"
      FROM "WorkoutSet" w
      JOIN "WorkoutExerciseEntry" e ON e.id = w."entryId"
      JOIN "WorkoutSession" s ON s.id = e."sessionId"
      WHERE w.id = ${id}::uuid AND s."userId" = ${userId}::uuid
    ), u AS (
      UPDATE "WorkoutSet" w SET
        reps = CASE WHEN ${patch.reps !== undefined} THEN ${patch.reps ?? null}::int ELSE w.reps END,
        "weightKg" = CASE WHEN ${patch.weightKg !== undefined} THEN ${patch.weightKg ?? null}::float8 ELSE w."weightKg" END,
        "durationSec" = CASE WHEN ${patch.durationSec !== undefined} THEN ${patch.durationSec ?? null}::int ELSE w."durationSec" END,
        completed = CASE WHEN ${hasC} THEN ${completing} ELSE w.completed END,
        "completedAt" = CASE WHEN NOT ${hasC} THEN w."completedAt" WHEN ${completing} THEN COALESCE(w."completedAt", ${now}::timestamptz) ELSE NULL END,
        "updatedAt" = ${now}::timestamptz
      FROM t WHERE w.id = t.id
      RETURNING w.id, w."setNumber", w.reps, w."weightKg", w."durationSec", w.completed, w."completedAt"
    ), s2 AS (
      UPDATE "WorkoutSession" s SET status = 'IN_PROGRESS', "startedAt" = COALESCE(s."startedAt", ${now}::timestamptz), "updatedAt" = ${now}::timestamptz
      FROM t WHERE ${completing} AND s.id = t."sessionId" AND s.status = 'PLANNED'
      RETURNING s.status, s."startedAt"
    ), e2 AS (
      UPDATE "WorkoutExerciseEntry" e SET status = 'COMPLETED', "updatedAt" = ${now}::timestamptz
      FROM t WHERE ${completing} AND e.id = t."entryId" AND e.status = 'PENDING'
        AND NOT EXISTS (SELECT 1 FROM "WorkoutSet" x WHERE x."entryId" = t."entryId" AND x.id <> t.id AND x.completed = false)
      RETURNING e.status
    )
    SELECT u.*, t."entryId", COALESCE(e2.status, t."entryStatus")::text AS "entryStatus", t."sessionId",
           COALESCE(s2.status, t."sessionStatus")::text AS "sessionStatus", COALESCE(s2."startedAt", t."startedAt") AS "sessionStartedAt"
    FROM u JOIN t ON t.id = u.id LEFT JOIN e2 ON true LEFT JOIN s2 ON true`;
  if (!r) throw notFound('Set');
  return {
    set: toSet(r),
    entry: { id: r.entryId, status: r.entryStatus },
    session: { id: r.sessionId, status: r.sessionStatus, startedAt: r.sessionStartedAt?.toISOString() ?? null },
  };
}

/**
 * Deletes a set and renumbers the remaining sets 1..n. Deleting the last set is one statement; deleting
 * from the middle shifts later sets through negative numbers (no unique clashes) and flips them back.
 */
export async function deleteSet(userId: string, id: string) {
  const [r] = await prisma.$queryRaw<{ entryId: string; shifted: number }[]>`
    WITH t AS (
      SELECT w.id, w."entryId", w."setNumber" FROM "WorkoutSet" w
      JOIN "WorkoutExerciseEntry" e ON e.id = w."entryId"
      JOIN "WorkoutSession" s ON s.id = e."sessionId"
      WHERE w.id = ${id}::uuid AND s."userId" = ${userId}::uuid
    ), d AS (
      DELETE FROM "WorkoutSet" w USING t WHERE w.id = t.id RETURNING w.id
    ), r AS (
      UPDATE "WorkoutSet" w SET "setNumber" = -(w."setNumber" - 1), "updatedAt" = now()
      FROM t WHERE w."entryId" = t."entryId" AND w."setNumber" > t."setNumber"
      RETURNING w.id
    )
    SELECT t."entryId", (SELECT count(*) FROM r)::int AS shifted, (SELECT count(*) FROM d)::int AS deleted FROM t`;
  if (!r) throw notFound('Set');
  if (r.shifted > 0) {
    await prisma.$executeRaw`UPDATE "WorkoutSet" SET "setNumber" = -"setNumber", "updatedAt" = now() WHERE "entryId" = ${r.entryId}::uuid AND "setNumber" < 0`;
  }
}
