import { describe, expect, it, vi } from 'vitest';
import { anon, createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { addDays, todayIn, toDbDate } from '../../src/server/lib/dates';

// Routine materialisation belongs to the routines module; keep it out of these tests.
vi.mock('../../src/server/services/routines.service', () => ({ ensureDailyRoutineEntries: vi.fn(async () => undefined) }));

/** Row builders (direct Prisma inserts). */
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
  slot: (userId: string, name: string, sortOrder = 0) => prisma.mealSlot.create({ data: { userId, name, sortOrder, defaultTime: '08:00' } }),
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
    prisma.workoutSession.create({ data: { userId, date: toDbDate(date), name: 'Push day', status } }),
};

const TZ = 'Asia/Kolkata';

describe('GET /api/dashboard', () => {
  it('requires authentication', async () => {
    const res = await anon().get('/api/dashboard');
    expect(res.status).toBe(401);
  });

  it('rejects malformed dates', async () => {
    const { api } = await createTestUser();
    expect((await api.get('/api/dashboard?date=2026-13-40')).status).toBe(400);
  });

  it('reports a missing day as not logged with null totals (missing ≠ zero)', async () => {
    const { user, api } = await createTestUser({ timezone: TZ });
    await seed.target(user.id, '2020-01-01', 2000);
    await seed.slot(user.id, 'Breakfast');
    const past = addDays(todayIn(TZ), -3);
    const res = await api.get(`/api/dashboard?date=${past}`);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.greeting.date).toBe(past);
    expect(d.greeting.isPast).toBe(true);
    expect(d.nutrition.logged).toBe(false);
    expect(d.nutrition.totals).toBeNull();
    expect(d.water.logged).toBe(false);
    expect(d.water.totalMl).toBeNull();
    expect(d.meals[0].status).toBe('NOT_LOGGED');
    expect(d.weekly.days).toHaveLength(7);
    expect(d.weekly.days.every((x: { calories: number | null }) => x.calories === null)).toBe(true);
  });

  it('computes totals, remaining calories, progress, meals and score from seeded rows', async () => {
    const { user, api } = await createTestUser({ timezone: TZ, gymWeekdays: [0, 1, 2, 3, 4, 5, 6] });
    const today = todayIn(TZ);
    await seed.target(user.id, '2020-01-01', 1500); // superseded yesterday
    await seed.target(user.id, addDays(today, -1), 2000);
    const breakfast = await seed.slot(user.id, 'Breakfast', 0);
    const lunch = await seed.slot(user.id, 'Lunch', 1);
    await seed.entry(user.id, today, { calories: 400, protein: 30, carbs: 40, fat: 10, fiber: 5 }, breakfast.id);
    await seed.entry(user.id, today, { calories: 650.5, protein: 45, carbs: 70, fat: 20, fiber: 8 }, lunch.id);
    await seed.mealStatus(user.id, today, breakfast.id, 'COMPLETED');
    await seed.water(user.id, today, 500);
    await seed.water(user.id, today, 1000);
    await seed.session(user.id, today, 'COMPLETED');
    // Another user's data must not leak in.
    const other = await createTestUser({ timezone: TZ });
    await seed.entry(other.user.id, today, { calories: 9999 });

    const res = await api.get('/api/dashboard');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.greeting).toMatchObject({ name: 'Test User', date: today, isToday: true, dayType: 'GYM' });
    expect(d.nutrition.logged).toBe(true);
    expect(d.nutrition.totals).toEqual({ calories: 1050.5, protein: 75, carbs: 110, fat: 30, fiber: 13 });
    expect(d.nutrition.target.calories).toBe(2000);
    expect(d.nutrition.remainingCalories).toBe(949.5);
    expect(d.nutrition.progress.protein).toMatchObject({ actual: 75, target: 150, status: 'under', percent: 50 });
    expect(d.nutrition.progress.fiber.actual).toBe(13);
    expect(d.water).toMatchObject({ logged: true, totalMl: 1500, targetMl: 3000 });
    expect(d.water.progress.percent).toBe(50);
    expect(d.meals.map((m: { name: string; status: string; entryCount: number }) => [m.name, m.status, m.entryCount])).toEqual([
      ['Breakfast', 'COMPLETED', 1],
      ['Lunch', 'LOGGED', 1],
    ]);
    expect(d.workout.session.status).toBe('COMPLETED');

    const keys = d.completionScore.components.map((c: { key: string }) => c.key);
    expect(keys).toEqual(['meals', 'calories', 'protein', 'water', 'workout']);
    // meals 0.5×25, calories 1050.5/1800×20, protein 75/140×15, water 0.5×15, workout 1×15 — over 90 total weight
    const expected = Math.round(((0.5 * 25 + (1050.5 / 1800) * 20 + (75 / 140) * 15 + 0.5 * 15 + 15) / 90) * 100);
    expect(d.completionScore.score).toBe(expected);

    const todayPoint = d.weekly.days[6];
    expect(todayPoint).toMatchObject({ date: today, calories: 1050.5, waterMl: 1500, workoutDone: true, calorieTarget: 2000 });
    expect(d.weekly.days[0].calorieTarget).toBe(1500); // per-day target versioning
    expect(d.weekly.days[0].calories).toBeNull();
    expect(d.recentActivity.length).toBeGreaterThanOrEqual(5);
    expect(d.recentActivity.some((a: { detail: string | null }) => a.detail?.includes('9999'))).toBe(false);
  });

  it('treats future dates as a planned view and drops the workout component on rest days', async () => {
    const { user, api } = await createTestUser({ timezone: TZ, gymWeekdays: [] });
    await seed.target(user.id, '2020-01-01', 2000);
    await seed.slot(user.id, 'Dinner');
    const future = addDays(todayIn(TZ), 2);
    const f = (await api.get(`/api/dashboard?date=${future}`)).body.data;
    expect(f.greeting.isFuture).toBe(true);
    expect(f.completionScore).toBeNull();
    expect(f.meals[0].status).toBe('PENDING');
    expect(f.weekly.days[6].workoutDone).toBeNull();

    const t = (await api.get('/api/dashboard')).body.data;
    expect(t.greeting.dayType).toBe('REST');
    expect(t.completionScore.components.map((c: { key: string }) => c.key)).not.toContain('workout');
  });

  it('returns routine overdue/upcoming and the reminder summary', async () => {
    const { user, api } = await createTestUser({ timezone: TZ });
    const today = todayIn(TZ);
    const now = Date.now();
    const mk = (title: string, at: Date, status: 'PENDING' | 'COMPLETED' = 'PENDING') =>
      prisma.dailyRoutineEntry.create({
        data: {
          userId: user.id,
          date: toDbDate(today),
          title,
          category: 'CUSTOM',
          scheduledTime: '00:00',
          scheduledAt: at,
          status,
          completedAt: status === 'COMPLETED' ? new Date() : null,
        },
      });
    await mk('Past pending', new Date(now - 60 * 60 * 1000));
    await mk('Done', new Date(now - 2 * 60 * 60 * 1000), 'COMPLETED');
    const later = new Date(now + 60 * 1000);
    const laterIsToday = todayIn(TZ, later) === today;
    if (laterIsToday) await mk('Later', later);

    const rem = await prisma.reminder.create({ data: { userId: user.id, title: 'Drink water', time: '10:00', nextTriggerAt: new Date(now + 30 * 60 * 1000) } });
    await prisma.reminder.create({ data: { userId: user.id, title: 'Disabled', time: '09:00', enabled: false, nextTriggerAt: new Date(now + 60 * 1000) } });
    await prisma.reminderOccurrence.create({ data: { reminderId: rem.id, userId: user.id, scheduledFor: new Date(now - 10 * 60 * 1000), status: 'SENT' } });
    await prisma.reminderOccurrence.create({
      data: { reminderId: rem.id, userId: user.id, scheduledFor: new Date(now - 20 * 60 * 1000), status: 'COMPLETED', actedAt: new Date() },
    });
    await prisma.reminderOccurrence.create({ data: { reminderId: rem.id, userId: user.id, scheduledFor: new Date(now - 30 * 60 * 60 * 1000), status: 'SENT' } });

    const d = (await api.get('/api/dashboard')).body.data;
    expect(d.routine.total).toBe(laterIsToday ? 3 : 2);
    expect(d.routine.completed).toBe(1);
    expect(d.routine.overdue.map((r: { title: string }) => r.title)).toEqual(['Past pending']);
    expect(d.routine.upcoming.map((r: { title: string }) => r.title)).toEqual(laterIsToday ? ['Later'] : []);
    expect(d.reminders.next.title).toBe('Drink water');
    expect(d.reminders.overdue).toHaveLength(1);
    expect(d.reminders.overdue[0].title).toBe('Drink water');
  });
});
