import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Tx } from '../../db';
import { env } from '../../env';
import { toDbDate, todayIn } from '../../lib/dates';
import { ESTIMATE_NOTE, SEED_CATEGORIES, SEED_FOODS } from './foods';
import {
  DEFAULT_TARGET,
  EXAMPLE_NOTE,
  SEED_EXERCISES,
  SEED_HYDRATION,
  SEED_PLAN,
  SEED_ROUTINES,
  SEED_SLOTS,
  SEED_WORKOUT_PLAN,
  type SeedPlanItem,
} from './plan';

export { DEFAULT_TARGET } from './plan';

export interface SeedResult {
  seeded: boolean;
  counts?: Record<string, number>;
}

const uuid = () => crypto.randomUUID();

/**
 * Creates the starter data for a user exactly once (guarded by UserSettings.defaultsSeededAt).
 * Must run inside an interactive transaction; callers should pass `{ timeout: 30_000 }`.
 * Never modifies existing rows except setting defaultsSeededAt at the end.
 */
export async function seedUserDefaults(tx: Tx, userId: string): Promise<SeedResult> {
  // Row lock so two concurrent seeds for the same user cannot both run.
  await tx.$executeRaw`SELECT 1 FROM "UserSettings" WHERE "userId" = ${userId}::uuid FOR UPDATE`;
  let settings = await tx.userSettings.findUnique({ where: { userId } });
  if (settings?.defaultsSeededAt) return { seeded: false };
  if (!settings) settings = await tx.userSettings.create({ data: { userId, timezone: env.DEFAULT_TIMEZONE } });

  const tz = settings.timezone;
  const snooze = settings.defaultSnoozeMinutes;
  const counts: Record<string, number> = {};

  // Nutrition target (only when the user has none — never overwrite coach targets).
  if ((await tx.nutritionTarget.count({ where: { userId } })) === 0) {
    await tx.nutritionTarget.create({ data: { userId, effectiveFrom: toDbDate(todayIn(tz)), ...DEFAULT_TARGET } });
    counts.targets = 1;
  }

  // Food categories (skip slugs the user already has).
  await tx.foodCategory.createMany({
    data: SEED_CATEGORIES.map((c, i) => ({ userId, name: c.name, slug: c.slug, isSystem: true, sortOrder: i })),
    skipDuplicates: true,
  });
  const categories = await tx.foodCategory.findMany({ where: { userId }, select: { id: true, slug: true } });
  const catId = new Map(categories.map((c) => [c.slug, c.id]));

  // Food library.
  const foodId = new Map<string, string>();
  const foods: Prisma.FoodItemCreateManyInput[] = SEED_FOODS.map((f) => {
    const id = uuid();
    foodId.set(f.key, id);
    return {
      id,
      userId,
      name: f.name,
      preparation: f.preparation ?? null,
      notes: f.notes ? `${f.notes} ${ESTIMATE_NOTE}` : ESTIMATE_NOTE,
      servingSize: f.servingSize,
      servingUnit: f.servingUnit,
      servingLabel: f.servingLabel,
      calories: f.calories,
      protein: f.protein,
      carbs: f.carbs,
      fat: f.fat,
      fiber: f.fiber,
      isEstimate: true,
      source: 'SEED',
    };
  });
  await tx.foodItem.createMany({ data: foods });
  await tx.foodItemCategory.createMany({
    data: SEED_FOODS.flatMap((f) => f.categories.map((slug) => ({ foodId: foodId.get(f.key)!, categoryId: catId.get(slug)! }))),
    skipDuplicates: true,
  });
  counts.foods = foods.length;

  // Meal slots + one plan template per slot.
  const slotId = new Map<string, string>();
  await tx.mealSlot.createMany({
    data: SEED_SLOTS.map((s, i) => {
      const id = uuid();
      slotId.set(s.key, id);
      return { id, userId, key: s.key, name: s.name, defaultTime: s.defaultTime, sortOrder: i };
    }),
  });
  counts.slots = SEED_SLOTS.length;

  const templates: Prisma.MealTemplateCreateManyInput[] = [];
  const primaries: Prisma.MealTemplateItemCreateManyInput[] = [];
  const alternatives: Prisma.MealTemplateItemCreateManyInput[] = [];
  const itemData = (templateId: string, it: SeedPlanItem, sortOrder: number, alternativeOfId?: string): Prisma.MealTemplateItemCreateManyInput => ({
    id: uuid(),
    templateId,
    foodId: it.food ? foodId.get(it.food)! : null,
    customName: it.customName ?? null,
    quantity: it.quantity,
    quantityMax: it.quantityMax ?? null,
    unit: it.unit,
    isOptional: it.isOptional ?? false,
    alternativeOfId: alternativeOfId ?? null,
    sortOrder,
    notes: it.notes ?? null,
  });
  for (const slot of SEED_SLOTS) {
    const plan = SEED_PLAN[slot.key];
    if (!plan) continue;
    const templateId = uuid();
    templates.push({
      id: templateId,
      userId,
      slotId: slotId.get(slot.key)!,
      name: `${slot.name} (coach plan)`,
      dayType: 'ANY',
      isPlan: true,
      notes: plan.notes ?? "Coach's meal plan. Edit it manually if the coach changes it.",
    });
    plan.items.forEach((it, i) => {
      const primary = itemData(templateId, it, i);
      primaries.push(primary);
      it.alternatives?.forEach((alt, j) => alternatives.push(itemData(templateId, alt, i * 10 + j + 1, primary.id)));
    });
  }
  await tx.mealTemplate.createMany({ data: templates });
  await tx.mealTemplateItem.createMany({ data: primaries });
  if (alternatives.length) await tx.mealTemplateItem.createMany({ data: alternatives });
  counts.mealTemplates = templates.length;

  // Exercises (reuse any with the same name) + an inactive sample plan.
  await tx.exercise.createMany({
    data: SEED_EXERCISES.map((e) => ({ userId, ...e, notes: EXAMPLE_NOTE })),
    skipDuplicates: true,
  });
  const exercises = await tx.exercise.findMany({
    where: { userId, name: { in: SEED_EXERCISES.map((e) => e.name) } },
    select: { id: true, name: true },
  });
  const exId = new Map(exercises.map((e) => [e.name, e.id]));
  counts.exercises = SEED_EXERCISES.length;

  const planId = uuid();
  await tx.workoutPlan.create({
    data: { id: planId, userId, name: SEED_WORKOUT_PLAN.name, description: SEED_WORKOUT_PLAN.description, isActive: false },
  });
  const days: Prisma.WorkoutDayCreateManyInput[] = [];
  const dayExercises: Prisma.WorkoutDayExerciseCreateManyInput[] = [];
  SEED_WORKOUT_PLAN.days.forEach((d, i) => {
    const id = uuid();
    days.push({ id, planId, weekday: d.weekday, name: d.name, isRestDay: d.isRestDay ?? false, sortOrder: i, notes: EXAMPLE_NOTE });
    d.exercises.forEach((e, j) => {
      const exerciseId = exId.get(e.exercise);
      if (!exerciseId) return;
      dayExercises.push({
        workoutDayId: id,
        exerciseId,
        sortOrder: j,
        targetSets: e.sets ?? null,
        targetReps: e.reps ?? null,
        targetDurationSec: e.durationSec ?? null,
        restSec: e.restSec ?? 90,
      });
    });
  });
  await tx.workoutDay.createMany({ data: days });
  await tx.workoutDayExercise.createMany({ data: dayExercises });

  // Routine templates; their items are the single source of meal/gym reminders.
  const reminders: Prisma.ReminderCreateManyInput[] = [];
  for (const r of SEED_ROUTINES) {
    const templateId = uuid();
    await tx.routineTemplate.create({ data: { id: templateId, userId, name: r.name, dayType: r.dayType, isActive: true } });
    const items: Prisma.RoutineItemCreateManyInput[] = r.items.map((it, i) => ({
      id: uuid(),
      templateId,
      title: it.title,
      category: it.category,
      time: it.time,
      sortOrder: i,
      notes: it.notes ?? 'Example time — adjust to your day.',
      reminderEnabled: it.reminderEnabled ?? true,
      snoozeMinutes: snooze,
    }));
    await tx.routineItem.createMany({ data: items });
    for (const it of items) {
      if (!it.reminderEnabled) continue;
      reminders.push({
        userId,
        title: it.title,
        category: it.category,
        time: it.time,
        weekdays: [],
        dayType: r.dayType,
        snoozeMinutes: snooze,
        routineItemId: it.id,
      });
    }
  }
  for (const time of SEED_HYDRATION) {
    reminders.push({ userId, title: 'Drink water', description: 'Hydration check — log a glass.', category: 'WATER', time, weekdays: [], dayType: 'ANY', snoozeMinutes: snooze });
  }
  await tx.reminder.createMany({ data: reminders });
  counts.routineTemplates = SEED_ROUTINES.length;
  counts.reminders = reminders.length;

  await tx.userSettings.update({ where: { userId }, data: { defaultsSeededAt: new Date() } });
  return { seeded: true, counts };
}
