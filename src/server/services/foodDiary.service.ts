import type { DailyMealStatus, DayType, FoodDiaryEntry, FoodItem, MealSlot, MealStatus, NutritionTarget, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Db } from '../db';
import { badRequest, notFound } from '../lib/http';
import { dateRange, dateString, fromDbDate, toDbDate } from '../lib/dates';
import { getDayType } from './dayContext';
import { foodUnitSchema, sqlCast, updateOwned, type OwnedValue } from './foods.service';
import { nutrientsFor, sumNutrients, targetProgress, type FoodUnit, type Nutrients } from '../../shared/nutrition';

// ───────────────────────────── Validation ─────────────────────────────

const quantity = z.number().finite().positive('Quantity must be greater than 0').max(100_000);
const nutrient = z.number().finite().min(0, 'Must be 0 or more').max(100_000);
const notes = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => (v === undefined ? undefined : v || null));

export const diaryEntryInput = z.object({
  date: dateString,
  slotId: z.string().uuid().nullish(),
  foodId: z.string().uuid(),
  quantity,
  unit: foodUnitSchema,
  consumedAt: z.string().datetime({ offset: true }).nullish(),
  notes,
});

export const manualEntryInput = z.object({
  date: dateString,
  slotId: z.string().uuid().nullish(),
  foodName: z.string().trim().min(1, 'Name is required').max(120),
  brand: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null)),
  quantity,
  unit: foodUnitSchema,
  calories: nutrient,
  protein: nutrient,
  carbs: nutrient,
  fat: nutrient,
  fiber: nutrient.default(0),
  isEstimate: z.boolean().default(false),
  consumedAt: z.string().datetime({ offset: true }).nullish(),
  notes,
});

export const diaryEntryUpdate = z
  .object({
    date: dateString,
    slotId: z.string().uuid().nullable(),
    quantity,
    unit: foodUnitSchema,
    consumedAt: z.string().datetime({ offset: true }).nullable(),
    notes,
  })
  .partial();

// ───────────────────────────── Snapshots ─────────────────────────────

/** Basis snapshot taken from a food at log time; computed totals for `quantity unit`. Throws UnitMismatchError. */
export function snapshotFromFood(food: FoodItem, qty: number, unit: FoodUnit) {
  const basis = {
    servingSize: food.servingSize,
    servingUnit: food.servingUnit as FoodUnit,
    calories: food.calories,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    fiber: food.fiber,
  };
  const n = nutrientsFor(basis, qty, unit);
  return {
    foodId: food.id,
    foodName: food.name,
    brand: food.brand,
    quantity: qty,
    unit,
    basisServingSize: basis.servingSize,
    basisServingUnit: basis.servingUnit,
    basisCalories: basis.calories,
    basisProtein: basis.protein,
    basisCarbs: basis.carbs,
    basisFat: basis.fat,
    basisFiber: basis.fiber,
    ...n,
    isEstimate: food.isEstimate,
  };
}

/** Recomputes an entry's totals from its OWN basis snapshot (never the current food). */
export function recomputeFromBasis(entry: FoodDiaryEntry, qty: number, unit: FoodUnit): Nutrients {
  return nutrientsFor(
    {
      servingSize: entry.basisServingSize,
      servingUnit: entry.basisServingUnit as FoodUnit,
      calories: entry.basisCalories,
      protein: entry.basisProtein,
      carbs: entry.basisCarbs,
      fat: entry.basisFat,
      fiber: entry.basisFiber,
    },
    qty,
    unit,
  );
}

export function serializeEntry(e: FoodDiaryEntry) {
  return {
    id: e.id,
    date: fromDbDate(e.date),
    slotId: e.slotId,
    foodId: e.foodId,
    templateItemId: e.templateItemId,
    foodName: e.foodName,
    brand: e.brand,
    quantity: e.quantity,
    unit: e.unit,
    basis: {
      servingSize: e.basisServingSize,
      servingUnit: e.basisServingUnit,
      calories: e.basisCalories,
      protein: e.basisProtein,
      carbs: e.basisCarbs,
      fat: e.basisFat,
      fiber: e.basisFiber,
    },
    calories: e.calories,
    protein: e.protein,
    carbs: e.carbs,
    fat: e.fat,
    fiber: e.fiber,
    isEstimate: e.isEstimate,
    consumedAt: e.consumedAt,
    notes: e.notes,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export function serializeSlot(s: MealSlot) {
  return {
    id: s.id,
    key: s.key,
    name: s.name,
    defaultTime: s.defaultTime,
    sortOrder: s.sortOrder,
    archivedAt: s.archivedAt,
  };
}

export function serializeTarget(t: NutritionTarget | null) {
  if (!t) return null;
  return {
    id: t.id,
    effectiveFrom: fromDbDate(t.effectiveFrom),
    calories: t.calories,
    caloriesMin: t.caloriesMin,
    caloriesMax: t.caloriesMax,
    protein: t.protein,
    proteinMin: t.proteinMin,
    proteinMax: t.proteinMax,
    carbs: t.carbs,
    carbsMin: t.carbsMin,
    carbsMax: t.carbsMax,
    fat: t.fat,
    fatMin: t.fatMin,
    fatMax: t.fatMax,
    fiber: t.fiber,
    fiberMin: t.fiberMin,
    fiberMax: t.fiberMax,
    waterMl: t.waterMl,
    waterMinMl: t.waterMinMl,
    waterMaxMl: t.waterMaxMl,
  };
}

/** Progress for calories/protein/carbs/fat/fiber against a target. */
export function nutrientProgress(totals: Nutrients, t: NutritionTarget) {
  return {
    calories: targetProgress(totals.calories, t.calories, t.caloriesMin, t.caloriesMax),
    protein: targetProgress(totals.protein, t.protein, t.proteinMin, t.proteinMax),
    carbs: targetProgress(totals.carbs, t.carbs, t.carbsMin, t.carbsMax),
    fat: targetProgress(totals.fat, t.fat, t.fatMin, t.fatMax),
    fiber: targetProgress(totals.fiber, t.fiber, t.fiberMin, t.fiberMax),
  };
}

// ───────────────────────────── Ownership & lookup helpers ─────────────────────────────
// The database is remote (~400 ms per round trip), so these helpers are meant to run side by side
// in one Promise.all instead of one after another.

export async function assertSlot(userId: string, slotId: string | null | undefined, db: Db = prisma) {
  if (!slotId) return null;
  const slot = await db.mealSlot.findFirst({ where: { id: slotId, userId } });
  if (!slot) throw badRequest('Meal slot not found');
  return slot;
}

/** All of a user's nutrition targets (a handful of rows), oldest first — resolve per date with `targetOn`. */
export function targetsOf(userId: string, db: Db = prisma) {
  return db.nutritionTarget.findMany({
    where: { userId },
    orderBy: { effectiveFrom: 'asc' },
  });
}

/** Target in force on `date`: latest effectiveFrom ≤ date, else the earliest (same rule as dayContext.getTargetForDate). */
export function targetOn(targets: NutritionTarget[], date: string): NutritionTarget | null {
  const d = toDbDate(date).getTime();
  let found: NutritionTarget | null = null;
  for (const t of targets) if (t.effectiveFrom.getTime() <= d) found = t;
  return found ?? targets[0] ?? null;
}

/** Slots shown on a diary day: active ones plus archived ones that have entries/statuses on that day (one query). */
export function slotsForDay(userId: string, date: string) {
  const d = toDbDate(date);
  return prisma.mealSlot.findMany({
    where: {
      userId,
      OR: [{ archivedAt: null }, { diaryEntries: { some: { date: d } } }, { statuses: { some: { date: d } } }],
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
}

const entryOrder: Prisma.FoodDiaryEntryOrderByWithRelationInput[] = [{ consumedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }];

// ───────────────────────────── Queries ─────────────────────────────

/** Raw rows for one diary day. Every query is independent, so the whole day loads in one round trip. */
export function loadDayRows(userId: string, date: string, gymWeekdays: number[]) {
  const d = toDbDate(date);
  return Promise.all([
    prisma.foodDiaryEntry.findMany({
      where: { userId, date: d },
      orderBy: entryOrder,
    }),
    prisma.dailyMealStatus.findMany({ where: { userId, date: d } }),
    slotsForDay(userId, date),
    targetsOf(userId),
    getDayType(userId, date, gymWeekdays),
  ]);
}

export function buildDay(
  date: string,
  dayType: Exclude<DayType, 'ANY'>,
  entries: FoodDiaryEntry[],
  statuses: DailyMealStatus[],
  slots: MealSlot[],
  target: NutritionTarget | null,
) {
  const statusBySlot = new Map(statuses.map((s) => [s.slotId, s]));
  const slotEntries = (slotId: string) => entries.filter((e) => e.slotId === slotId);
  const slotSet = new Set(slots.map((s) => s.id));

  const logged = entries.length > 0;
  const totals = logged ? sumNutrients(entries) : null;
  const unslotted = entries.filter((e) => !e.slotId || !slotSet.has(e.slotId));

  return {
    date,
    dayType,
    logged,
    slots: slots.map((slot) => {
      const list = slotEntries(slot.id);
      const st = statusBySlot.get(slot.id);
      return {
        slot: serializeSlot(slot),
        status: (st?.status ?? 'PENDING') as MealStatus,
        statusNotes: st?.notes ?? null,
        completedAt: st?.completedAt ?? null,
        templateId: st?.templateId ?? null,
        entries: list.map(serializeEntry),
        totals: list.length ? sumNutrients(list) : null,
      };
    }),
    unslotted: {
      entries: unslotted.map(serializeEntry),
      totals: unslotted.length ? sumNutrients(unslotted) : null,
    },
    totals,
    target: serializeTarget(target),
    progress: totals && target ? nutrientProgress(totals, target) : null,
  };
}

export async function getDay(userId: string, date: string, gymWeekdays: number[]) {
  const [entries, statuses, slots, targets, dayType] = await loadDayRows(userId, date, gymWeekdays);
  return buildDay(date, dayType, entries, statuses, slots, targetOn(targets, date));
}

export async function getRange(userId: string, from: string, to: string) {
  const [grouped, targets] = await Promise.all([
    prisma.foodDiaryEntry.groupBy({
      by: ['date'],
      where: { userId, date: { gte: toDbDate(from), lte: toDbDate(to) } },
      _sum: {
        calories: true,
        protein: true,
        carbs: true,
        fat: true,
        fiber: true,
      },
      _count: { _all: true },
    }),
    targetsOf(userId),
  ]);
  const byDate = new Map(grouped.map((g) => [fromDbDate(g.date), g]));
  return {
    from,
    to,
    days: dateRange(from, to).map((date) => {
      const g = byDate.get(date);
      const t = targetOn(targets, date);
      return {
        date,
        logged: !!g,
        entryCount: g?._count._all ?? 0,
        totals: g
          ? sumNutrients([
              {
                calories: g._sum.calories ?? 0,
                protein: g._sum.protein ?? 0,
                carbs: g._sum.carbs ?? 0,
                fat: g._sum.fat ?? 0,
                fiber: g._sum.fiber ?? 0,
              },
            ])
          : null,
        target: t
          ? {
              calories: t.calories,
              protein: t.protein,
              carbs: t.carbs,
              fat: t.fat,
              fiber: t.fiber,
            }
          : null,
      };
    }),
  };
}

// ───────────────────────────── Mutations ─────────────────────────────

export async function createEntry(userId: string, input: z.infer<typeof diaryEntryInput>) {
  // Food + slot ownership checks share one round trip, then a single insert.
  const [food] = await Promise.all([prisma.foodItem.findFirst({ where: { id: input.foodId, userId } }), assertSlot(userId, input.slotId)]);
  if (!food) throw badRequest('Food not found');
  const snap = snapshotFromFood(food, input.quantity, input.unit);
  const entry = await prisma.foodDiaryEntry.create({
    data: {
      ...snap,
      userId,
      date: toDbDate(input.date),
      slotId: input.slotId ?? null,
      consumedAt: input.consumedAt ? new Date(input.consumedAt) : new Date(),
      notes: input.notes,
    },
  });
  return serializeEntry(entry);
}

/** One-off entry from a nutrition label: the basis is the given values per the given quantity. */
export async function createManualEntry(userId: string, input: z.infer<typeof manualEntryInput>) {
  await assertSlot(userId, input.slotId);
  const n: Nutrients = sumNutrients([input]);
  const entry = await prisma.foodDiaryEntry.create({
    data: {
      userId,
      date: toDbDate(input.date),
      slotId: input.slotId ?? null,
      foodId: null,
      foodName: input.foodName,
      brand: input.brand,
      quantity: input.quantity,
      unit: input.unit,
      basisServingSize: input.quantity,
      basisServingUnit: input.unit,
      basisCalories: input.calories,
      basisProtein: input.protein,
      basisCarbs: input.carbs,
      basisFat: input.fat,
      basisFiber: input.fiber,
      ...n,
      isEstimate: input.isEstimate,
      consumedAt: input.consumedAt ? new Date(input.consumedAt) : new Date(),
      notes: input.notes,
    },
  });
  return serializeEntry(entry);
}

export async function updateEntry(userId: string, id: string, input: z.infer<typeof diaryEntryUpdate>) {
  const [entry] = await Promise.all([prisma.foodDiaryEntry.findFirst({ where: { id, userId } }), input.slotId ? assertSlot(userId, input.slotId) : null]);
  if (!entry) throw notFound('Diary entry');
  const set: Record<string, OwnedValue> = {};
  if (input.quantity !== undefined || input.unit !== undefined) {
    const qty = input.quantity ?? entry.quantity;
    const unit = (input.unit ?? entry.unit) as FoodUnit;
    Object.assign(set, recomputeFromBasis(entry, qty, unit), {
      quantity: qty,
      unit: sqlCast(unit, '"FoodUnit"'),
    });
  }
  if (input.date !== undefined) set.date = sqlCast(input.date, 'date');
  if (input.slotId !== undefined) set.slotId = sqlCast(input.slotId, 'uuid');
  if (input.consumedAt !== undefined) set.consumedAt = input.consumedAt ? new Date(input.consumedAt) : null;
  if (input.notes !== undefined) set.notes = input.notes;
  const updated = await updateOwned<FoodDiaryEntry>('FoodDiaryEntry', id, userId, set);
  if (!updated) throw notFound('Diary entry');
  return serializeEntry(updated);
}

/** One statement: the owner filter doubles as the ownership check. */
export async function deleteEntry(userId: string, id: string) {
  const { count } = await prisma.foodDiaryEntry.deleteMany({
    where: { id, userId },
  });
  if (!count) throw notFound('Diary entry');
}
