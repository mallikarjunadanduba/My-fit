import { Router } from 'express';
import { z } from 'zod';
import { ExerciseType, ItemStatus, WorkoutSessionStatus } from '@prisma/client';
import { auth } from '../middleware/auth';
import { badRequest, created, idParam, noContent, ok, paginationQuery, parseBody, parseParams, parseQuery } from '../lib/http';
import { addDays, dateRange, dateString, todayIn } from '../lib/dates';
import * as W from '../services/workouts';

const router = Router();

// ── Shared schemas ──

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) =>
  text(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));
const uuid = z.string().uuid();
const nonEmptyPatch = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .refine((o) => Object.keys(o).length > 0, 'Nothing to update');

const exerciseBody = {
  name: text(100).min(1, 'Name is required'),
  type: z.nativeEnum(ExerciseType).optional(),
  muscleGroup: optText(60),
  equipment: optText(60),
  notes: optText(1000),
  imageMediaId: uuid.nullable().optional(),
};

const planBody = { name: text(100).min(1, 'Name is required'), description: optText(1000) };

const weekday = z.number().int().min(0).max(6).nullable();
const dayBody = {
  name: text(100).min(1, 'Name is required'),
  weekday: weekday.optional(),
  isRestDay: z.boolean().optional(),
  notes: optText(1000),
  sortOrder: z.number().int().min(0).max(1000).optional(),
};

const dayExerciseBody = {
  exerciseId: uuid,
  targetSets: z.number().int().min(1).max(20).nullable().optional(),
  targetReps: text(20)
    .regex(/^[\w\s\-–+/x]*$/i, 'Use something like "8-10", "12" or "AMRAP"')
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  targetWeightKg: z.number().min(0).max(1000).nullable().optional(),
  targetDurationSec: z.number().int().min(0).max(24 * 3600).nullable().optional(),
  restSec: z.number().int().min(0).max(3600).nullable().optional(),
  notes: optText(500),
};

const setValues = {
  reps: z.number().int().min(0).max(1000).nullable().optional(),
  weightKg: z.number().min(0).max(1000).nullable().optional(),
  durationSec: z.number().int().min(0).max(24 * 3600).nullable().optional(),
};

const dateQuery = z.object({ date: dateString.optional() });
const today = (tz: string) => todayIn(tz);

// ── Exercises ──

router.get('/exercises', async (req, res) => {
  const q = parseQuery(
    req,
    z.object({
      search: z.string().trim().max(100).optional(),
      type: z.nativeEnum(ExerciseType).optional(),
      includeArchived: z
        .enum(['true', 'false', '1', '0'])
        .optional()
        .transform((v) => v === 'true' || v === '1'),
    }),
  );
  ok(res, await W.listExercises(auth(req).userId, q));
});

router.post('/exercises', async (req, res) => {
  created(res, await W.createExercise(auth(req).userId, parseBody(req, z.object(exerciseBody).strict())));
});

router.get('/exercises/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.findOwnedExercise(auth(req).userId, id));
});

router.patch('/exercises/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(req, nonEmptyPatch({ ...exerciseBody, name: exerciseBody.name.optional() }));
  ok(res, await W.updateExercise(auth(req).userId, id, body));
});

router.post('/exercises/:id/archive', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const { archived } = parseBody(req, z.object({ archived: z.boolean().default(true) }));
  ok(res, await W.setExerciseArchived(auth(req).userId, id, archived));
});

router.delete('/exercises/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await W.deleteExercise(auth(req).userId, id);
  noContent(res);
});

// ── Plans ──

router.get('/plans', async (req, res) => {
  ok(res, await W.listPlans(auth(req).userId));
});

router.post('/plans', async (req, res) => {
  const body = parseBody(req, z.object({ ...planBody, activate: z.boolean().optional() }).strict());
  created(res, await W.createPlan(auth(req).userId, body));
});

router.get('/plans/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.getPlan(auth(req).userId, id));
});

router.patch('/plans/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.updatePlan(auth(req).userId, id, parseBody(req, nonEmptyPatch({ ...planBody, name: planBody.name.optional() }))));
});

router.delete('/plans/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await W.deletePlan(auth(req).userId, id);
  noContent(res);
});

router.post('/plans/:id/activate', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.activatePlan(auth(req).userId, id));
});

router.post('/plans/:id/deactivate', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.deactivatePlan(auth(req).userId, id));
});

// ── Plan days ──

router.post('/plans/:id/days', async (req, res) => {
  const { id } = parseParams(req, idParam);
  created(res, await W.createDay(auth(req).userId, id, parseBody(req, z.object(dayBody).strict())));
});

router.patch('/days/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.updateDay(auth(req).userId, id, parseBody(req, nonEmptyPatch({ ...dayBody, name: dayBody.name.optional() }))));
});

router.delete('/days/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await W.deleteDay(auth(req).userId, id);
  noContent(res);
});

router.post('/days/:id/exercises', async (req, res) => {
  const { id } = parseParams(req, idParam);
  created(res, await W.addDayExercise(auth(req).userId, id, parseBody(req, z.object(dayExerciseBody).strict())));
});

router.post('/days/:id/exercises/reorder', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const { ids } = parseBody(req, z.object({ ids: z.array(uuid).max(100) }));
  ok(res, await W.reorderDayExercises(auth(req).userId, id, ids));
});

router.patch('/day-exercises/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.updateDayExercise(auth(req).userId, id, parseBody(req, nonEmptyPatch({ ...dayExerciseBody, exerciseId: uuid.optional() }))));
});

router.delete('/day-exercises/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await W.deleteDayExercise(auth(req).userId, id);
  noContent(res);
});

// ── Schedule / week ──

router.get('/schedule', async (req, res) => {
  const a = auth(req);
  const { date } = parseQuery(req, dateQuery);
  ok(res, await W.getSchedule(a, date ?? today(a.timezone)));
});

router.get('/week', async (req, res) => {
  const a = auth(req);
  const { date } = parseQuery(req, dateQuery);
  const t = today(a.timezone);
  ok(res, await W.getWeek(a, date ?? t, t));
});

// ── Sessions ──

router.post('/sessions', async (req, res) => {
  const body = parseBody(
    req,
    z
      .object({ date: dateString, workoutDayId: uuid.nullable().optional(), name: text(100).optional(), start: z.boolean().optional() })
      .strict(),
  );
  const { session, created: isNew } = await W.createSession(auth(req).userId, body);
  if (isNew) created(res, session);
  else ok(res, session);
});

router.get('/sessions', async (req, res) => {
  const q = parseQuery(
    req,
    paginationQuery.extend({
      from: dateString.optional(),
      to: dateString.optional(),
      status: z.nativeEnum(WorkoutSessionStatus).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    }),
  );
  if (q.from && q.to && q.from > q.to) throw badRequest('from must be on or before to');
  const { data, meta } = await W.listSessions(auth(req).userId, q);
  ok(res, data, meta);
});

router.get('/sessions/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.getSession(auth(req).userId, id));
});

router.patch('/sessions/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(req, nonEmptyPatch({ name: text(100).min(1).optional(), notes: optText(2000), date: dateString.optional() }));
  ok(res, await W.updateSession(auth(req).userId, id, body));
});

router.delete('/sessions/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await W.deleteSession(auth(req).userId, id);
  noContent(res);
});

router.post('/sessions/:id/start', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.startSession(auth(req).userId, id));
});

router.post('/sessions/:id/finish', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.finishSession(auth(req).userId, id));
});

router.post('/sessions/:id/skip', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.skipSession(auth(req).userId, id));
});

// ── Entries & sets ──
// Hot path while training: each is one SQL statement and returns only what changed (deletes return 204):
//   POST /sessions/:id/entries → the new entry; PATCH /entries/:id → { id, sessionId, status, notes, restSec }
//   POST /entries/:id/sets → { entryId, set }; PATCH /sets/:id → { set, entry: { id, status }, session: { id, status, startedAt } }

router.post('/sessions/:id/entries', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(
    req,
    z
      .object({
        exerciseId: uuid.optional(),
        exerciseName: text(100).min(1).optional(),
        restSec: z.number().int().min(0).max(3600).nullable().optional(),
        sets: z.number().int().min(1).max(20).optional(),
      })
      .strict()
      .refine((b) => b.exerciseId || b.exerciseName, 'Provide exerciseId or exerciseName'),
  );
  created(res, await W.addEntry(auth(req).userId, id, body));
});

router.patch('/entries/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(
    req,
    nonEmptyPatch({ status: z.nativeEnum(ItemStatus).optional(), notes: optText(1000), restSec: z.number().int().min(0).max(3600).nullable().optional() }),
  );
  ok(res, await W.updateEntry(auth(req).userId, id, body));
});

router.delete('/entries/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await W.deleteEntry(auth(req).userId, id);
  noContent(res);
});

router.post('/entries/:id/sets', async (req, res) => {
  const { id } = parseParams(req, idParam);
  created(res, await W.addSet(auth(req).userId, id, parseBody(req, z.object(setValues).strict())));
});

router.patch('/sets/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await W.updateSet(auth(req).userId, id, parseBody(req, nonEmptyPatch({ ...setValues, completed: z.boolean().optional() }))));
});

router.delete('/sets/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await W.deleteSet(auth(req).userId, id);
  noContent(res);
});

// ── Insights ──

router.get('/records', async (req, res) => {
  ok(res, await W.getRecords(auth(req).userId));
});

router.get('/consistency', async (req, res) => {
  const a = auth(req);
  const t = today(a.timezone);
  const q = parseQuery(req, z.object({ from: dateString.optional(), to: dateString.optional() }));
  const to = q.to ?? t;
  const from = q.from ?? addDays(to, -83); // 12 weeks
  if (from > to) throw badRequest('from must be on or before to');
  if (dateRange(from, to).length > 400) throw badRequest('Range too large (max 400 days)');
  ok(res, await W.getConsistency(a, from, to, t));
});

export default router;
