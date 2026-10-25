import { describe, expect, it, vi } from 'vitest';
import { anon, createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { addDays, todayIn, toDbDate } from '../../src/server/lib/dates';

vi.mock('../../src/server/services/routines.service', () => ({ ensureDailyRoutineEntries: vi.fn(async () => undefined) }));

const seed = {
  target: (userId: string, effectiveFrom: string, calories: number) =>
    prisma.nutritionTarget.create({
      data: {
        userId,
        effectiveFrom: toDbDate(effectiveFrom),
        calories,
        caloriesMin: calories - 200,
        caloriesMax: calories + 200,
        protein: 150,
        proteinMin: 140,
        carbs: 200,
        fat: 60,
        fiber: 30,
        waterMl: 3000,
      },
    }),
  slot: (userId: string, name: string, sortOrder = 0) => prisma.mealSlot.create({ data: { userId, name, sortOrder } }),
  entry: (userId: string, date: string, n: { calories: number; protein?: number; carbs?: number; fat?: number; fiber?: number }, slotId?: string) =>
    prisma.foodDiaryEntry.create({
      data: {
        userId,
        date: toDbDate(date),
        slotId: slotId ?? null,
        foodName: 'Test food',
        quantity: 1,
        unit: 'SERVING',
        basisServingSize: 1,
        basisServingUnit: 'SERVING',
        basisCalories: n.calories,
        basisProtein: n.protein ?? 0,
        basisCarbs: n.carbs ?? 0,
        basisFat: n.fat ?? 0,
        basisFiber: n.fiber ?? 0,
        calories: n.calories,
        protein: n.protein ?? 0,
        carbs: n.carbs ?? 0,
        fat: n.fat ?? 0,
        fiber: n.fiber ?? 0,
      },
    }),
  water: (userId: string, date: string, amountMl: number) => prisma.waterEntry.create({ data: { userId, date: toDbDate(date), amountMl } }),
  mealStatus: (userId: string, date: string, slotId: string, status: 'COMPLETED' | 'PARTIAL' | 'SKIPPED') =>
    prisma.dailyMealStatus.create({ data: { userId, date: toDbDate(date), slotId, status } }),
  session: (userId: string, date: string, status: 'COMPLETED' | 'IN_PROGRESS' | 'PLANNED' | 'SKIPPED') =>
    prisma.workoutSession.create({ data: { userId, date: toDbDate(date), name: 'Leg day', status } }),
  weight: (userId: string, date: string, weightKg: number) =>
    prisma.bodyMeasurement.create({ data: { userId, date: toDbDate(date), weightKg, measuredAt: new Date(`${date}T06:00:00Z`) } }),
};

/** March 2025 is fully in the past: 31 days, starts on a Saturday, 5 Sundays. */
async function seedMarch() {
  const ctx = await createTestUser({ timezone: 'Asia/Kolkata', gymWeekdays: [1, 2, 3, 4, 5, 6] });
  const id = ctx.user.id;
  await seed.target(id, '2025-01-01', 2000);
  await seed.target(id, '2025-03-16', 2500); // new target in force from the 16th
  const s1 = await seed.slot(id, 'Breakfast', 0);
  const s2 = await seed.slot(id, 'Dinner', 1);
  await seed.entry(id, '2025-03-10', { calories: 1200, protein: 90, carbs: 120, fat: 40, fiber: 12 }, s1.id);
  await seed.entry(id, '2025-03-10', { calories: 800, protein: 60, carbs: 80, fat: 20, fiber: 8 }, s2.id);
  await seed.entry(id, '2025-03-20', { calories: 2500, protein: 110, carbs: 300, fat: 70, fiber: 30 }, s1.id);
  await seed.water(id, '2025-03-10', 2000);
  await seed.water(id, '2025-03-20', 2500);
  await seed.water(id, '2025-03-20', 1500);
  await seed.mealStatus(id, '2025-03-10', s1.id, 'COMPLETED');
  await seed.mealStatus(id, '2025-03-10', s2.id, 'COMPLETED');
  await seed.mealStatus(id, '2025-03-20', s1.id, 'PARTIAL');
  await seed.session(id, '2025-03-10', 'COMPLETED');
  await seed.session(id, '2025-03-20', 'SKIPPED');
  await seed.weight(id, '2025-03-01', 82);
  await seed.weight(id, '2025-03-31', 80.5);
  return ctx;
}

describe('reports authorization', () => {
  it('returns 401 without a session', async () => {
    for (const url of ['/api/reports/daily/2025-03-10', '/api/reports/calendar', '/api/reports/weekly', '/api/reports/monthly', '/api/reports/history/diary']) {
      expect((await anon().get(url)).status).toBe(401);
    }
  });
});

describe('GET /api/reports/monthly', () => {
  it('aggregates a constructed month correctly', async () => {
    const { api } = await seedMarch();
    const res = await api.get('/api/reports/monthly?month=2025-03');
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r).toMatchObject({ from: '2025-03-01', to: '2025-03-31', daysInPeriod: 31, daysElapsed: 31, daysWithFoodLogs: 2 });
    expect(r.missingLogDates).toHaveLength(29);
    expect(r.missingLogDates).not.toContain('2025-03-10');
    expect(r.loggedDays).toEqual({ food: 2, water: 2 });
    // Averages over the 2 logged days only.
    expect(r.averages).toEqual({ calories: 2250, protein: 130, carbs: 250, fat: 65, fiber: 25, waterMl: 3000 });
    // Per-day target versioning: 2000 on the 10th, 2500 on the 20th.
    expect(r.averageTargets.calories).toBe(2250);
    expect(r.daysWithinCalorieRange).toBe(2);
    expect(r.series.find((p: { date: string }) => p.date === '2025-03-15').calorieTarget).toBe(2000);
    expect(r.series.find((p: { date: string }) => p.date === '2025-03-16').calorieTarget).toBe(2500);
    // Workouts: 26 Mon–Sat gym days, one completed (skipped sessions don't count).
    expect(r.plannedGymDays).toBe(26);
    expect(r.workoutsCompleted).toBe(1);
    expect(r.workoutConsistencyPct).toBeCloseTo((1 / 26) * 100, 1);
    // Meals: (2 + 0.5) / (2 slots × 31 days)
    expect(r.mealAdherencePct).toBeCloseTo((2.5 / 62) * 100, 1);
    expect(r.routineCompletionPct).toBeNull();
    expect(r.weight).toMatchObject({ first: { date: '2025-03-01', weightKg: 82 }, last: { date: '2025-03-31', weightKg: 80.5 }, change: -1.5 });
    expect(r.mostConsistentWeekdays[0].label).toBe('Monday'); // the 10th is the only great day
    expect(r.series).toHaveLength(31);
    expect(r.series.find((p: { date: string }) => p.date === '2025-03-11').calories).toBeNull();
  });

  it('does not count future days as missing', async () => {
    const { api } = await createTestUser({ timezone: 'Asia/Kolkata' });
    const today = todayIn('Asia/Kolkata');
    const r = (await api.get(`/api/reports/monthly?month=${today.slice(0, 7)}`)).body.data;
    expect(r.daysElapsed).toBe(Number(today.slice(8, 10)));
    expect(r.missingLogDates.every((d: string) => d <= today)).toBe(true);
    expect(r.series.filter((p: { future: boolean; score: number | null }) => p.future && p.score != null)).toHaveLength(0);
  });

  it('validates the month', async () => {
    const { api } = await createTestUser();
    expect((await api.get('/api/reports/monthly?month=2025-13')).status).toBe(400);
  });
});

describe('GET /api/reports/weekly', () => {
  it('uses the Monday-start week containing the date', async () => {
    const { api } = await seedMarch();
    const r = (await api.get('/api/reports/weekly?date=2025-03-12')).body.data;
    expect(r.from).toBe('2025-03-10');
    expect(r.to).toBe('2025-03-16');
    expect(r.daysWithFoodLogs).toBe(1);
    expect(r.averages.calories).toBe(2000);
    expect(r.missingLogDates).toEqual(['2025-03-11', '2025-03-12', '2025-03-13', '2025-03-14', '2025-03-15', '2025-03-16']);
  });
});

describe('daily report + daily log', () => {
  it('returns a full daily summary and upserts notes/day type', async () => {
    const { user, api } = await seedMarch();
    const r = (await api.get('/api/reports/daily/2025-03-10')).body.data;
    expect(r.date).toBe('2025-03-10');
    expect(r.dayType).toBe('GYM');
    expect(r.nutrition.totals).toEqual({ calories: 2000, protein: 150, carbs: 200, fat: 60, fiber: 20 });
    expect(r.meals.map((m: { status: string }) => m.status)).toEqual(['COMPLETED', 'COMPLETED']);
    expect(r.water.totalMl).toBe(2000);
    expect(r.workouts).toHaveLength(1);
    expect(r.notes).toBeNull();
    expect(r.log).toBeNull();

    const missing = (await api.get('/api/reports/daily/2025-03-11')).body.data;
    expect(missing.nutrition.logged).toBe(false);
    expect(missing.nutrition.totals).toBeNull();
    expect(missing.meals.every((m: { status: string }) => m.status === 'NOT_LOGGED')).toBe(true);

    const put = await api.put('/api/reports/daily/2025-03-10').send({ notes: '  Felt strong  ', dayType: 'REST' });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ date: '2025-03-10', notes: 'Felt strong', dayType: 'REST', timezone: 'Asia/Kolkata' });

    const after = (await api.get('/api/reports/daily/2025-03-10')).body.data;
    expect(after.dayType).toBe('REST');
    expect(after.dayTypeOverride).toBe('REST');
    expect(after.notes).toBe('Felt strong');

    // Override changes period maths: the 10th is no longer a planned gym day.
    const month = (await api.get('/api/reports/monthly?month=2025-03')).body.data;
    expect(month.plannedGymDays).toBe(25);

    // Clearing the override keeps notes.
    const cleared = await api.put('/api/reports/daily/2025-03-10').send({ dayType: null });
    expect(cleared.body.data).toMatchObject({ dayType: null, notes: 'Felt strong' });
    expect(await prisma.dailyLog.count({ where: { userId: user.id } })).toBe(1);
  });

  it('validates the body', async () => {
    const { api } = await createTestUser();
    expect((await api.put('/api/reports/daily/2025-03-10').send({})).status).toBe(400);
    expect((await api.put('/api/reports/daily/2025-03-10').send({ dayType: 'ANY' })).status).toBe(400);
    expect((await api.put('/api/reports/daily/2025-02-30').send({ notes: 'x' })).status).toBe(400);
  });
});

describe('GET /api/reports/calendar', () => {
  it('returns per-day flags and scores for the month', async () => {
    const { api } = await seedMarch();
    const r = (await api.get('/api/reports/calendar?month=2025-03')).body.data;
    expect(r.days).toHaveLength(31);
    const d10 = r.days.find((d: { date: string }) => d.date === '2025-03-10');
    expect(d10).toMatchObject({ logged: { food: true, water: true, workout: true, routine: false }, calories: 2000, waterMl: 2000, workoutStatus: 'COMPLETED' });
    expect(d10.score).toBeGreaterThan(70);
    const d11 = r.days.find((d: { date: string }) => d.date === '2025-03-11');
    expect(d11).toMatchObject({ logged: { food: false, water: false, workout: false }, calories: null, waterMl: null });
    expect(d11.score).toBe(0);
  });

  it('flags notes (whitespace-only notes do not count) and day-type overrides', async () => {
    const { api } = await seedMarch();
    await api.put('/api/reports/daily/2025-03-12').send({ notes: 'Felt great' });
    await api.put('/api/reports/daily/2025-03-13').send({ dayType: 'REST' });
    const r = (await api.get('/api/reports/calendar?month=2025-03')).body.data;
    const byDate = (d: string) => r.days.find((x: { date: string }) => x.date === d);
    expect(byDate('2025-03-12').hasNotes).toBe(true);
    expect(byDate('2025-03-13')).toMatchObject({ hasNotes: false, dayType: 'REST' });
  });
});

describe('GET /api/reports/history/:kind', () => {
  it('returns paginated, scoped rows for each kind', async () => {
    const { api } = await seedMarch();
    const other = await createTestUser();
    await seed.entry(other.user.id, '2025-03-10', { calories: 9999 });

    const diary = await api.get('/api/reports/history/diary?from=2025-03-01&to=2025-03-31&page=1&pageSize=2');
    expect(diary.status).toBe(200);
    expect(diary.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    expect(diary.body.data[0].date).toBe('2025-03-20');
    expect(diary.body.data.some((r: { calories: number }) => r.calories === 9999)).toBe(false);

    const nutrition = (await api.get('/api/reports/history/nutrition?from=2025-03-01&to=2025-03-31&pageSize=50')).body;
    expect(nutrition.meta.total).toBe(31);
    const n10 = nutrition.data.find((r: { date: string }) => r.date === '2025-03-10');
    expect(n10).toMatchObject({ logged: true, calories: 2000, calorieTarget: 2000, withinCalorieRange: true });
    expect(nutrition.data.find((r: { date: string }) => r.date === '2025-03-11')).toMatchObject({ logged: false, calories: null });

    const water = (await api.get('/api/reports/history/water?from=2025-03-20&to=2025-03-20')).body.data;
    expect(water[0]).toMatchObject({ totalMl: 4000, entryCount: 2, targetMl: 3000, percent: 133 });

    const workouts = (await api.get('/api/reports/history/workouts?from=2025-03-01&to=2025-03-31')).body;
    expect(workouts.meta.total).toBe(2);

    const measurements = (await api.get('/api/reports/history/measurements?from=2025-03-01&to=2025-03-31')).body.data;
    expect(measurements.map((m: { weightKg: number }) => m.weightKg)).toEqual([80.5, 82]);

    for (const kind of ['routine', 'reminders']) {
      const res = await api.get(`/api/reports/history/${kind}?from=2025-03-01&to=2025-03-31`);
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(0);
    }
  });

  it('rejects unknown kinds and ranges over 400 days', async () => {
    const { api } = await createTestUser();
    expect((await api.get('/api/reports/history/secrets')).status).toBe(400);
    expect((await api.get(`/api/reports/history/diary?from=2023-01-01&to=${addDays('2023-01-01', 400)}`)).status).toBe(400);
  });
});
