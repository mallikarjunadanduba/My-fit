import { describe, expect, it } from 'vitest';
import { anon, createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { addDays, weekBounds, weekdayOf } from '../../src/server/lib/dates';
import {
  computeConsistency,
  computePersonalRecords,
  estimateOneRepMax,
  parseRepsLowerBound,
  sessionStats,
  setVolume,
} from '../../src/server/services/workouts/stats';

type Api = Awaited<ReturnType<typeof createTestUser>>['api'];

async function makeExercise(api: Api, name: string, extra: Record<string, unknown> = {}) {
  const res = await api.post('/api/workouts/exercises').send({ name, ...extra });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; name: string };
}

/** Plan with one training day on `weekday` containing the given exercises. */
async function makePlan(api: Api, weekday: number, exercises: { id: string; targetSets?: number; targetReps?: string; targetWeightKg?: number }[]) {
  const plan = await api.post('/api/workouts/plans').send({ name: `Plan ${Math.random()}` });
  expect(plan.status).toBe(201);
  const day = await api.post(`/api/workouts/plans/${plan.body.data.id}/days`).send({ name: 'Push day', weekday });
  expect(day.status).toBe(201);
  for (const e of exercises) {
    const r = await api.post(`/api/workouts/days/${day.body.data.id}/exercises`).send({ exerciseId: e.id, targetSets: e.targetSets, targetReps: e.targetReps, targetWeightKg: e.targetWeightKg, restSec: 60 });
    expect(r.status).toBe(201);
  }
  return { planId: plan.body.data.id as string, dayId: day.body.data.id as string };
}

describe('workout stats (pure)', () => {
  it('parses rep targets', () => {
    expect(parseRepsLowerBound('8-10')).toBe(8);
    expect(parseRepsLowerBound('12')).toBe(12);
    expect(parseRepsLowerBound('10–12 reps')).toBe(10);
    expect(parseRepsLowerBound('AMRAP')).toBeNull();
    expect(parseRepsLowerBound(null)).toBeNull();
  });

  it('computes Epley 1RM and volume', () => {
    expect(estimateOneRepMax(100, 1)).toBe(100);
    expect(estimateOneRepMax(100, 10)).toBe(133.3);
    expect(estimateOneRepMax(60, 5)).toBe(70);
    expect(estimateOneRepMax(null, 5)).toBeNull();
    expect(estimateOneRepMax(50, 0)).toBeNull();
    expect(setVolume({ weightKg: 50, reps: 10 })).toBe(500);
    expect(setVolume({ weightKg: null, reps: 10 })).toBe(0);
  });

  it('computes session stats from completed sets only', () => {
    const s = sessionStats([
      { status: 'COMPLETED', sets: [{ reps: 10, weightKg: 50, durationSec: null, completed: true }, { reps: 8, weightKg: 50, durationSec: null, completed: false }] },
      { status: 'PENDING', sets: [{ reps: null, weightKg: null, durationSec: 60, completed: true }] },
    ]);
    expect(s).toMatchObject({ totalEntries: 2, completedEntries: 1, totalSets: 3, completedSets: 2, volumeKg: 500, workSec: 60 });
  });

  it('computes personal records with achievement dates', () => {
    const rows = [
      { exerciseId: 'a', exerciseName: 'Bench', sessionId: 's1', date: '2026-01-01', reps: 10, weightKg: 60, durationSec: null },
      { exerciseId: 'a', exerciseName: 'Bench', sessionId: 's1', date: '2026-01-01', reps: 10, weightKg: 60, durationSec: null },
      { exerciseId: 'a', exerciseName: 'Bench', sessionId: 's2', date: '2026-02-01', reps: 3, weightKg: 80, durationSec: null },
      { exerciseId: 'a', exerciseName: 'Bench', sessionId: 's3', date: '2026-03-01', reps: 3, weightKg: 80, durationSec: null },
      { exerciseId: null, exerciseName: 'Deleted Row', sessionId: 's1', date: '2026-01-01', reps: 15, weightKg: null, durationSec: null },
    ];
    const [bench, deleted] = computePersonalRecords(rows);
    expect(bench.exerciseName).toBe('Bench');
    expect(bench.maxWeight).toMatchObject({ value: 80, date: '2026-02-01', reps: 3 }); // first time achieved
    expect(bench.bestOneRepMax).toMatchObject({ value: 88, date: '2026-02-01' }); // 80*(1+3/30)=88 > 60*(1+10/30)=80
    expect(bench.maxReps).toMatchObject({ value: 10, date: '2026-01-01' });
    expect(bench.maxSessionVolume).toMatchObject({ value: 1200, date: '2026-01-01', sessionId: 's1' });
    expect(bench.totalSets).toBe(4);
    expect(bench.sessionsCount).toBe(3);
    expect(bench.lastPerformed).toBe('2026-03-01');
    expect(deleted).toMatchObject({ exerciseId: null, exerciseName: 'Deleted Row', maxWeight: null, maxReps: { value: 15 } });
  });

  it('computes consistency, weekly % and streaks', () => {
    // Mon 2026-10-12 … Sun 2026-10-25; gym Mon-Sat.
    const days = Array.from({ length: 14 }, (_, i) => {
      const date = addDays('2026-10-12', i);
      return { date, planned: weekdayOf(date) !== 0, completed: false };
    });
    const done = new Set(['2026-10-12', '2026-10-13', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25']);
    for (const d of days) d.completed = done.has(d.date);
    const today = '2026-10-25';
    const c = computeConsistency(days, (d) => weekBounds(d).from, today);
    expect(c.plannedDays).toBe(12);
    expect(c.completedPlannedDays).toBe(6);
    expect(c.extraSessionDays).toBe(1); // Sunday session
    expect(c.percent).toBe(50);
    expect(c.weeks).toEqual([
      { weekStart: '2026-10-12', planned: 6, completed: 2, extra: 0, percent: 33 },
      { weekStart: '2026-10-19', planned: 6, completed: 4, extra: 1, percent: 67 },
    ]);
    expect(c.currentStreak).toBe(5);
    expect(c.longestStreak).toBe(5);

    // Today not yet trained does not break the streak; future days are ignored.
    const c2 = computeConsistency(
      [
        { date: '2026-10-23', planned: true, completed: true },
        { date: '2026-10-24', planned: false, completed: false },
        { date: '2026-10-25', planned: true, completed: false },
        { date: '2026-10-26', planned: true, completed: false },
      ],
      (d) => weekBounds(d).from,
      '2026-10-25',
    );
    expect(c2.currentStreak).toBe(1);
    expect(c2.plannedDays).toBe(2);
    expect(computeConsistency([], (d) => d, today).percent).toBeNull();
  });
});

describe('workouts API', () => {
  it('requires auth', async () => {
    expect((await anon().get('/api/workouts/plans')).status).toBe(401);
  });

  it('exercise CRUD, duplicate names, archive and search', async () => {
    const { api } = await createTestUser();
    const ex = await makeExercise(api, 'Barbell Row', { muscleGroup: 'Back', type: 'STRENGTH' });
    expect((await api.post('/api/workouts/exercises').send({ name: 'Barbell Row' })).status).toBe(409);
    expect((await api.post('/api/workouts/exercises').send({ name: '' })).status).toBe(400);
    const found = await api.get('/api/workouts/exercises?search=back');
    expect(found.body.data.map((e: { id: string }) => e.id)).toEqual([ex.id]);
    expect((await api.post(`/api/workouts/exercises/${ex.id}/archive`).send({})).body.data.archivedAt).not.toBeNull();
    expect((await api.get('/api/workouts/exercises')).body.data).toHaveLength(0);
    expect((await api.get('/api/workouts/exercises?includeArchived=true')).body.data).toHaveLength(1);
    const patched = await api.patch(`/api/workouts/exercises/${ex.id}`).send({ name: 'Pendlay Row' });
    expect(patched.body.data.name).toBe('Pendlay Row');
  });

  it('keeps only one active plan per user', async () => {
    const { api } = await createTestUser();
    const p1 = await api.post('/api/workouts/plans').send({ name: 'A' });
    expect(p1.body.data.isActive).toBe(true); // first plan is active by default
    const p2 = await api.post('/api/workouts/plans').send({ name: 'B' });
    expect(p2.body.data.isActive).toBe(false);
    const act = await api.post(`/api/workouts/plans/${p2.body.data.id}/activate`);
    expect(act.status).toBe(200);
    const list = await api.get('/api/workouts/plans');
    const active = list.body.data.filter((p: { isActive: boolean }) => p.isActive);
    expect(active.map((p: { id: string }) => p.id)).toEqual([p2.body.data.id]);
    await api.post(`/api/workouts/plans/${p1.body.data.id}/activate`);
    const list2 = await api.get('/api/workouts/plans');
    expect(list2.body.data.filter((p: { isActive: boolean }) => p.isActive)).toHaveLength(1);
  });

  it('rejects two days on the same weekday in one plan and reorders day exercises', async () => {
    const { api } = await createTestUser();
    const a = await makeExercise(api, 'A');
    const b = await makeExercise(api, 'B');
    const { planId, dayId } = await makePlan(api, 1, [{ id: a.id }, { id: b.id }]);
    expect((await api.post(`/api/workouts/plans/${planId}/days`).send({ name: 'Dup', weekday: 1 })).status).toBe(409);
    const plan = await api.get(`/api/workouts/plans/${planId}`);
    const items = plan.body.data.days[0].exercises.map((e: { id: string }) => e.id);
    const re = await api.post(`/api/workouts/days/${dayId}/exercises/reorder`).send({ ids: [...items].reverse() });
    expect(re.status).toBe(200);
    expect(re.body.data.exercises.map((e: { exercise: { name: string } }) => e.exercise.name)).toEqual(['B', 'A']);
    expect((await api.post(`/api/workouts/days/${dayId}/exercises/reorder`).send({ ids: [items[0]] })).status).toBe(400);
  });

  it('creates a session from the day template with snapshots, logs sets, and keeps history after deleting the exercise', async () => {
    const { api, user } = await createTestUser();
    const bench = await makeExercise(api, 'Bench Press');
    const date = '2026-10-19'; // Monday
    const { dayId } = await makePlan(api, 1, [{ id: bench.id, targetSets: 3, targetReps: '8-10', targetWeightKg: 60 }]);

    const sched = await api.get(`/api/workouts/schedule?date=${date}`);
    expect(sched.status).toBe(200);
    expect(sched.body.data).toMatchObject({ dayType: 'GYM', day: { id: dayId, name: 'Push day' }, session: null });

    const res = await api.post('/api/workouts/sessions').send({ date, workoutDayId: dayId });
    expect(res.status).toBe(201);
    const s = res.body.data;
    expect(s).toMatchObject({ date, name: 'Push day', status: 'PLANNED' });
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ exerciseName: 'Bench Press', restSec: 60, status: 'PENDING' });
    expect(s.entries[0].sets.map((x: { reps: number; weightKg: number; setNumber: number }) => [x.setNumber, x.reps, x.weightKg])).toEqual([
      [1, 8, 60],
      [2, 8, 60],
      [3, 8, 60],
    ]);

    // Idempotent: same day template + date returns the existing session.
    const again = await api.post('/api/workouts/sessions').send({ date, workoutDayId: dayId, start: true });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ id: s.id, status: 'IN_PROGRESS' });

    // Complete all sets → exercise auto-completed only when the last one is ticked. Responses carry just what changed.
    const sets = s.entries[0].sets as { id: string }[];
    for (const [i, set] of sets.entries()) {
      const r = await api.patch(`/api/workouts/sets/${set.id}`).send({ completed: true, reps: 10 });
      expect(r.status).toBe(200);
      expect(r.body.data.set).toMatchObject({ id: set.id, completed: true, reps: 10, weightKg: 60 });
      expect(typeof r.body.data.set.completedAt).toBe('string');
      expect(r.body.data.entry).toEqual({ id: s.entries[0].id, status: i === sets.length - 1 ? 'COMPLETED' : 'PENDING' });
      expect(r.body.data.session).toMatchObject({ id: s.id, status: 'IN_PROGRESS' });
    }
    // Editing values keeps completion; unticking keeps the exercise COMPLETED.
    const edited = await api.patch(`/api/workouts/sets/${sets[0].id}`).send({ weightKg: 62.5 });
    expect(edited.body.data.set).toMatchObject({ weightKg: 62.5, reps: 10, completed: true });
    const unticked = await api.patch(`/api/workouts/sets/${sets[0].id}`).send({ completed: false, weightKg: 60 });
    expect(unticked.body.data.set).toMatchObject({ completed: false, completedAt: null });
    expect(unticked.body.data.entry.status).toBe('COMPLETED');
    await api.patch(`/api/workouts/sets/${sets[0].id}`).send({ completed: true });

    const added = await api.post(`/api/workouts/entries/${s.entries[0].id}/sets`).send({});
    expect(added.status).toBe(201);
    expect(added.body.data.entryId).toBe(s.entries[0].id);
    const newSet = added.body.data.set;
    expect(newSet).toMatchObject({ setNumber: 4, reps: 10, weightKg: 60, completed: false }); // copies previous
    const explicit = await api.post(`/api/workouts/entries/${s.entries[0].id}/sets`).send({ reps: 5, weightKg: null });
    expect(explicit.body.data.set).toMatchObject({ setNumber: 5, reps: 5, weightKg: null });
    // Deleting from the middle renumbers the rest 1..n.
    expect((await api.delete(`/api/workouts/sets/${newSet.id}`)).status).toBe(204);
    const mid = await api.get(`/api/workouts/sessions/${s.id}`);
    expect(mid.body.data.entries[0].sets.map((x: { setNumber: number; reps: number }) => [x.setNumber, x.reps])).toEqual([
      [1, 10],
      [2, 10],
      [3, 10],
      [4, 5],
    ]);
    expect((await api.delete(`/api/workouts/sets/${mid.body.data.entries[0].sets[3].id}`)).status).toBe(204);
    expect((await api.delete(`/api/workouts/sets/${newSet.id}`)).status).toBe(404);

    const fin = await api.post(`/api/workouts/sessions/${s.id}/finish`);
    expect(fin.status).toBe(200);
    expect(fin.body.data.status).toBe('COMPLETED');
    expect(fin.body.data.finishedAt).not.toBeNull();
    expect(fin.body.data.entries[0].status).toBe('COMPLETED');
    expect(fin.body.data.stats).toMatchObject({ completedSets: 3, volumeKg: 1800 });

    // Snapshot survives renaming and deleting the exercise.
    await api.patch(`/api/workouts/exercises/${bench.id}`).send({ name: 'Flat Bench' });
    expect((await api.delete(`/api/workouts/exercises/${bench.id}`)).status).toBe(204);
    const after = await api.get(`/api/workouts/sessions/${s.id}`);
    expect(after.body.data.entries[0]).toMatchObject({ exerciseName: 'Bench Press', exerciseId: null });
    expect(after.body.data.entries[0].sets).toHaveLength(3);

    const records = await api.get('/api/workouts/records');
    expect(records.body.data).toHaveLength(1);
    expect(records.body.data[0]).toMatchObject({
      exerciseName: 'Bench Press',
      maxWeight: { value: 60, date },
      maxReps: { value: 10 },
      bestOneRepMax: { value: 80 },
      maxSessionVolume: { value: 1800, date },
    });

    const history = await api.get('/api/workouts/sessions?status=COMPLETED');
    expect(history.body.meta.total).toBe(1);
    expect(history.body.data[0]).toMatchObject({ id: s.id, stats: { volumeKg: 1800 } });
    expect(typeof history.body.data[0].durationSec).toBe('number');
    expect(await prisma.workoutSession.count({ where: { userId: user.id } })).toBe(1);
  });

  it('ad-hoc sessions, entries by name, skip and status rules', async () => {
    const { api } = await createTestUser();
    const s = (await api.post('/api/workouts/sessions').send({ date: '2026-10-20', name: 'Quick cardio', start: true })).body.data;
    expect(s).toMatchObject({ status: 'IN_PROGRESS', entries: [] });
    expect(s.startedAt).not.toBeNull();
    const withEntry = await api.post(`/api/workouts/sessions/${s.id}/entries`).send({ exerciseName: 'Rowing', sets: 2 });
    expect(withEntry.status).toBe(201);
    expect(withEntry.body.data).toMatchObject({ exerciseName: 'Rowing', exerciseId: null, exercise: null, sortOrder: 0, restSec: 90, status: 'PENDING' });
    expect(withEntry.body.data.sets.map((x: { setNumber: number }) => x.setNumber)).toEqual([1, 2]);
    const entryId = withEntry.body.data.id;
    // From the library: name snapshot + exercise info, appended after the first entry.
    const ex = await makeExercise(api, 'Cable Fly');
    const second = await api.post(`/api/workouts/sessions/${s.id}/entries`).send({ exerciseId: ex.id, restSec: 45 });
    expect(second.body.data).toMatchObject({ exerciseName: 'Cable Fly', exerciseId: ex.id, exercise: { id: ex.id, type: 'STRENGTH' }, sortOrder: 1, restSec: 45 });
    expect(second.body.data.sets).toHaveLength(1);
    expect((await api.post(`/api/workouts/sessions/${s.id}/entries`).send({ exerciseId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    const patched = await api.patch(`/api/workouts/entries/${entryId}`).send({ status: 'SKIPPED', notes: 'Machine busy' });
    expect(patched.body.data).toEqual({ id: entryId, sessionId: s.id, status: 'SKIPPED', notes: 'Machine busy', restSec: 90 });
    expect((await api.patch(`/api/workouts/entries/${entryId}`).send({ restSec: null })).body.data).toMatchObject({ status: 'SKIPPED', notes: 'Machine busy', restSec: null });
    const full = (await api.get(`/api/workouts/sessions/${s.id}`)).body.data;
    expect(full.entries.map((e: { exerciseName: string }) => e.exerciseName)).toEqual(['Rowing', 'Cable Fly']);
    expect((await api.post(`/api/workouts/sessions/${s.id}/entries`).send({})).status).toBe(400);
    expect((await api.post(`/api/workouts/sessions/${s.id}/skip`)).body.data.status).toBe('SKIPPED');
    expect((await api.post(`/api/workouts/sessions/${s.id}/finish`)).status).toBe(409);
    expect((await api.delete(`/api/workouts/entries/${entryId}`)).status).toBe(204);
  });

  it('week view and consistency', async () => {
    const { api } = await createTestUser({ gymWeekdays: [1, 3, 5] });
    const mon = '2026-10-12';
    const s = (await api.post('/api/workouts/sessions').send({ date: mon, name: 'Legs', start: true })).body.data;
    await api.post(`/api/workouts/sessions/${s.id}/finish`);
    const week = await api.get(`/api/workouts/week?date=2026-10-14`);
    expect(week.status).toBe(200);
    expect(week.body.data.from).toBe(mon);
    expect(week.body.data.days).toHaveLength(7);
    expect(week.body.data.days.map((d: { status: string }) => d.status)).toEqual(['COMPLETED', 'REST', 'MISSED', 'REST', 'MISSED', 'REST', 'REST']);

    const c = await api.get('/api/workouts/consistency?from=2026-10-12&to=2026-10-18');
    expect(c.status).toBe(200);
    expect(c.body.data).toMatchObject({ plannedDays: 3, completedPlannedDays: 1, percent: 33, currentStreak: 0, longestStreak: 1 });
    expect((await api.get('/api/workouts/consistency?from=2026-10-18&to=2026-10-12')).status).toBe(400);
  });

  it('enforces cross-user authorization (404) everywhere', async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const ex = await makeExercise(a.api, 'Deadlift');
    const { planId, dayId } = await makePlan(a.api, 2, [{ id: ex.id, targetSets: 1 }]);
    const s = (await a.api.post('/api/workouts/sessions').send({ date: '2026-10-20', workoutDayId: dayId })).body.data;
    const entryId = s.entries[0].id;
    const setId = s.entries[0].sets[0].id;
    const dayExerciseId = (await a.api.get(`/api/workouts/plans/${planId}`)).body.data.days[0].exercises[0].id;

    const checks: [string, () => Promise<{ status: number }>][] = [
      ['get exercise', () => b.api.get(`/api/workouts/exercises/${ex.id}`)],
      ['patch exercise', () => b.api.patch(`/api/workouts/exercises/${ex.id}`).send({ name: 'x' })],
      ['delete exercise', () => b.api.delete(`/api/workouts/exercises/${ex.id}`)],
      ['get plan', () => b.api.get(`/api/workouts/plans/${planId}`)],
      ['activate plan', () => b.api.post(`/api/workouts/plans/${planId}/activate`)],
      ['add day', () => b.api.post(`/api/workouts/plans/${planId}/days`).send({ name: 'x' })],
      ['patch day', () => b.api.patch(`/api/workouts/days/${dayId}`).send({ name: 'x' })],
      ['patch day exercise', () => b.api.patch(`/api/workouts/day-exercises/${dayExerciseId}`).send({ targetSets: 2 })],
      ['session from foreign day', () => b.api.post('/api/workouts/sessions').send({ date: '2026-10-20', workoutDayId: dayId })],
      ['get session', () => b.api.get(`/api/workouts/sessions/${s.id}`)],
      ['finish session', () => b.api.post(`/api/workouts/sessions/${s.id}/finish`)],
      ['add entry', () => b.api.post(`/api/workouts/sessions/${s.id}/entries`).send({ exerciseName: 'x' })],
      ['patch entry', () => b.api.patch(`/api/workouts/entries/${entryId}`).send({ status: 'SKIPPED' })],
      ['add set', () => b.api.post(`/api/workouts/entries/${entryId}/sets`).send({})],
      ['patch set', () => b.api.patch(`/api/workouts/sets/${setId}`).send({ completed: true })],
      ['delete set', () => b.api.delete(`/api/workouts/sets/${setId}`)],
    ];
    for (const [label, call] of checks) expect([label, (await call()).status]).toEqual([label, 404]);

    // Ticking a set in a PLANNED session starts it.
    const tick = await a.api.patch(`/api/workouts/sets/${setId}`).send({ completed: true });
    expect(tick.body.data.session).toMatchObject({ id: s.id, status: 'IN_PROGRESS' });
    expect(typeof tick.body.data.session.startedAt).toBe('string');
    expect(tick.body.data.entry.status).toBe('COMPLETED'); // single-set exercise

    // B's own exercise can't be added to A's day and A's exercise can't be added to B's day.
    const bEx = await makeExercise(b.api, 'Mine');
    expect((await a.api.post(`/api/workouts/days/${dayId}/exercises`).send({ exerciseId: bEx.id })).status).toBe(404);
    expect((await b.api.get('/api/workouts/sessions')).body.data).toHaveLength(0);
    expect((await b.api.get('/api/workouts/records')).body.data).toHaveLength(0);
  });
});
