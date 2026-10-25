import { describe, expect, it } from 'vitest';
import { createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { seedUserDefaults } from '../../src/server/services/defaults';
import { SEED_FOODS } from '../../src/server/services/defaults/foods';
import { allowedUnits } from '../../src/shared/nutrition';
import { fromDbDate, todayIn } from '../../src/server/lib/dates';

const seed = (userId: string) => prisma.$transaction((tx) => seedUserDefaults(tx, userId), { timeout: 30_000 });

describe('seedUserDefaults', () => {
  it('creates the coach plan once and is idempotent', async () => {
    const { user } = await createTestUser({ timezone: 'Asia/Kolkata' });
    const first = await seed(user.id);
    expect(first.seeded).toBe(true);

    const counts = async () => ({
      targets: await prisma.nutritionTarget.count({ where: { userId: user.id } }),
      slots: await prisma.mealSlot.count({ where: { userId: user.id } }),
      plans: await prisma.mealTemplate.count({ where: { userId: user.id, isPlan: true } }),
      foods: await prisma.foodItem.count({ where: { userId: user.id } }),
      categories: await prisma.foodCategory.count({ where: { userId: user.id } }),
      reminders: await prisma.reminder.count({ where: { userId: user.id } }),
      routines: await prisma.routineTemplate.count({ where: { userId: user.id } }),
      exercises: await prisma.exercise.count({ where: { userId: user.id } }),
      plansW: await prisma.workoutPlan.count({ where: { userId: user.id } }),
    });
    const before = await counts();
    expect(before).toMatchObject({ targets: 1, slots: 7, plans: 7, categories: 10, routines: 2, plansW: 1 });
    expect(before.foods).toBeGreaterThanOrEqual(40);
    expect(before.exercises).toBeGreaterThanOrEqual(15);

    const second = await seed(user.id);
    expect(second.seeded).toBe(false);
    expect(await counts()).toEqual(before);
  });

  it('uses the coach target values, effective today in the user timezone', async () => {
    const { user } = await createTestUser({ timezone: 'America/Los_Angeles' });
    await seed(user.id);
    const t = await prisma.nutritionTarget.findFirstOrThrow({ where: { userId: user.id } });
    expect(fromDbDate(t.effectiveFrom)).toBe(todayIn('America/Los_Angeles'));
    expect(t).toMatchObject({
      calories: 1900, caloriesMin: 1850, caloriesMax: 1950,
      protein: 160, proteinMin: 160, proteinMax: 160,
      carbs: 160, carbsMin: 150, carbsMax: 170,
      fat: 60, fatMin: 55, fatMax: 65,
      fiber: 32.5, fiberMin: 30, fiberMax: 35,
      waterMl: 3000, waterMinMl: 2500, waterMaxMl: 3500,
    });
  });

  it('builds slots, plan items, alternatives and reminders correctly', async () => {
    const { user } = await createTestUser();
    await seed(user.id);
    const slots = await prisma.mealSlot.findMany({ where: { userId: user.id }, orderBy: { sortOrder: 'asc' } });
    expect(slots.map((s) => [s.key, s.defaultTime])).toEqual([
      ['BREAKFAST', '08:00'],
      ['MID_MORNING', '11:00'],
      ['LUNCH', '13:30'],
      ['PRE_WORKOUT', '17:00'],
      ['POST_WORKOUT', '19:00'],
      ['DINNER', '20:30'],
      ['BEFORE_BED', '22:30'],
    ]);

    const templates = await prisma.mealTemplate.findMany({
      where: { userId: user.id, isPlan: true },
      include: { slot: true, items: { include: { food: true } } },
    });
    for (const t of templates) {
      expect(t.dayType).toBe('ANY');
      // Every food-linked item uses a unit the food can be logged in.
      for (const it of t.items) if (it.food) expect(allowedUnits(it.food.servingUnit), `${t.name}: ${it.food.name}`).toContain(it.unit);
    }
    const bySlot = (key: string) => templates.find((t) => t.slot?.key === key)!;

    const breakfast = bySlot('BREAKFAST').items.filter((i) => !i.alternativeOfId);
    expect(breakfast.map((i) => [i.food?.name, i.quantity])).toEqual(
      expect.arrayContaining([['Egg white', 3], ['Whole egg', 3], ['Rolled oats', 40]]),
    );

    const lunch = bySlot('LUNCH').items;
    const chicken = lunch.find((i) => i.food?.name === 'Chicken breast')!;
    expect(chicken).toMatchObject({ quantity: 150, quantityMax: 180, alternativeOfId: null });
    expect(lunch.find((i) => i.alternativeOfId === chicken.id)?.food?.name).toMatch(/Fish/);

    const post = bySlot('POST_WORKOUT').items;
    expect(post.find((i) => i.customName === 'Water')?.foodId).toBeNull();
    expect(post.find((i) => i.food?.name === 'Whey protein')).toMatchObject({ quantity: 1, unit: 'SCOOP' });

    const dinnerAlts = bySlot('DINNER').items.filter((i) => i.alternativeOfId);
    expect(dinnerAlts.map((i) => i.food?.name)).toEqual(expect.arrayContaining(['Low-fat paneer', 'Roti / phulka']));

    const pre = bySlot('PRE_WORKOUT').items;
    expect(pre.find((i) => i.food?.name === 'Black coffee')?.isOptional).toBe(true);

    // Reminders: one per routine item + 3 hydration; no duplicate meal reminders.
    const items = await prisma.routineItem.findMany({ where: { template: { userId: user.id } }, include: { template: true } });
    const reminders = await prisma.reminder.findMany({ where: { userId: user.id } });
    expect(reminders).toHaveLength(items.filter((i) => i.reminderEnabled).length + 3);
    expect(reminders.filter((r) => r.category === 'WATER' && !r.routineItemId).map((r) => r.time).sort()).toEqual(['10:00', '15:00', '17:30']);
    expect(reminders.every((r) => r.nextTriggerAt === null)).toBe(true);
    for (const r of reminders.filter((x) => x.routineItemId)) {
      const item = items.find((i) => i.id === r.routineItemId)!;
      expect(r.dayType).toBe(item.template.dayType);
      expect(r.time).toBe(item.time);
    }
    const restItems = items.filter((i) => i.template.dayType === 'REST').map((i) => i.category);
    expect(restItems).not.toContain('GYM');
    expect(items.filter((i) => i.template.dayType === 'GYM').map((i) => i.category)).toContain('GYM');

    const plan = await prisma.workoutPlan.findFirstOrThrow({ where: { userId: user.id }, include: { days: { include: { exercises: true } } } });
    expect(plan.isActive).toBe(false);
    expect(plan.days).toHaveLength(7);
    expect(plan.days.find((d) => d.weekday === 0)?.isRestDay).toBe(true);
    expect(plan.days.filter((d) => !d.isRestDay).every((d) => d.exercises.length >= 3)).toBe(true);
  });

  it('seed foods are marked as estimates with consistent macros', async () => {
    const { user } = await createTestUser();
    await seed(user.id);
    const foods = await prisma.foodItem.findMany({ where: { userId: user.id }, include: { categories: true } });
    expect(foods.every((f) => f.isEstimate && f.source === 'SEED' && /estimate/i.test(f.notes ?? ''))).toBe(true);
    expect(foods.every((f) => f.categories.length >= 1)).toBe(true);
    // Atwater sanity check: kcal ≈ 4P + 4C + 9F within a loose tolerance.
    for (const f of SEED_FOODS) {
      const est = 4 * f.protein + 4 * f.carbs + 9 * f.fat;
      expect(Math.abs(est - f.calories), f.name).toBeLessThanOrEqual(Math.max(12, f.calories * 0.15));
    }
  });
});
