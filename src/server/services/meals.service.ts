import { randomUUID } from 'node:crypto';
import type { DailyMealStatus, DayType, FoodItem, MealSlot, MealStatus, MealTemplate, MealTemplateItem, NutritionTarget, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Db, type Tx } from '../db';
import { badRequest, conflict, notFound } from '../lib/http';
import { dateString, fromDbDate, timeString, toDbDate } from '../lib/dates';
import { getDayType } from './dayContext';
import { foodUnitSchema, returningColumns, updateOwned } from './foods.service';
import {
  buildDay,
  loadDayRows,
  nutrientProgress,
  serializeEntry,
  serializeSlot,
  serializeTarget,
  snapshotFromFood,
  targetOn,
  targetsOf,
} from './foodDiary.service';
import { nutrientsFor, sumNutrients, UNIT_LABELS, UnitMismatchError, type FoodUnit, type Nutrients } from '../../shared/nutrition';

// ───────────────────────────── Validation ─────────────────────────────

const dayTypeSchema = z.enum(['ANY', 'GYM', 'REST']);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null));

export const slotInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  defaultTime: timeString.nullish(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export const slotUpdate = slotInput.partial();
export const reorderInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
});

const itemBase = z.object({
  foodId: z.string().uuid().nullish(),
  customName: optionalText(120),
  quantity: z.number().finite().positive('Quantity must be greater than 0').max(100_000),
  quantityMax: z.number().finite().positive().max(100_000).nullish(),
  unit: foodUnitSchema,
  notes: optionalText(300),
});
const checkItem = (i: z.infer<typeof itemBase>, ctx: z.RefinementCtx) => {
  if (!i.foodId && !i.customName)
    ctx.addIssue({
      code: 'custom',
      message: 'Choose a food or enter a name',
      path: ['foodId'],
    });
  if (i.quantityMax != null && i.quantityMax < i.quantity)
    ctx.addIssue({
      code: 'custom',
      message: 'Max quantity must be at least the quantity',
      path: ['quantityMax'],
    });
};
const alternativeInput = itemBase.superRefine(checkItem);
export const templateItemInput = itemBase
  .extend({
    isOptional: z.boolean().default(false),
    alternatives: z.array(alternativeInput).max(10).default([]),
  })
  .superRefine(checkItem);

export const templateInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  slotId: z.string().uuid().nullish(),
  dayType: dayTypeSchema.default('ANY'),
  notes: optionalText(1000),
  preparation: optionalText(2000),
  items: z.array(templateItemInput).max(40).default([]),
});
export const templateUpdate = templateInput.partial();

export const templateListQuery = z.object({
  slotId: z.string().uuid().optional(),
  dayType: dayTypeSchema.optional(),
  includeArchived: z
    .enum(['true', 'false', '1', '0'])
    .transform((v) => v === 'true' || v === '1')
    .optional(),
});

export const planQuery = z.object({
  date: dateString.optional(),
  dayType: dayTypeSchema.optional(),
});
export const setPlanInput = z.object({
  templateId: z.string().uuid().nullable(),
  dayType: dayTypeSchema,
});

export const statusInput = z.object({
  date: dateString,
  slotId: z.string().uuid(),
  status: z.enum(['PENDING', 'COMPLETED', 'PARTIAL', 'SKIPPED']),
  notes: optionalText(500),
  templateId: z.string().uuid().nullish(),
});

export const applyTemplateInput = z.object({
  date: dateString,
  slotId: z.string().uuid(),
  templateId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).max(100).optional(),
  overrides: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        quantity: z.number().finite().positive('Quantity must be greater than 0').max(100_000),
        unit: foodUnitSchema,
        foodId: z.string().uuid().optional(),
      }),
    )
    .max(100)
    .default([]),
  consumedAt: z.string().datetime({ offset: true }).optional(),
  notes: optionalText(500),
});

export const copyDayInput = z
  .object({
    fromDate: dateString,
    toDate: dateString,
    slotIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .refine((v) => v.fromDate !== v.toDate, 'Choose a different day to copy from');

// ───────────────────────────── Serialisation ─────────────────────────────

type ItemWithFood = MealTemplateItem & { food: FoodItem | null };
type TemplateWithItems = MealTemplate & { items: ItemWithFood[] };

function foodSummary(f: FoodItem) {
  return {
    id: f.id,
    name: f.name,
    brand: f.brand,
    servingSize: f.servingSize,
    servingUnit: f.servingUnit,
    servingLabel: f.servingLabel,
    calories: f.calories,
    protein: f.protein,
    carbs: f.carbs,
    fat: f.fat,
    fiber: f.fiber,
    isEstimate: f.isEstimate,
    archivedAt: f.archivedAt,
  };
}

function itemNutrition(food: FoodItem | null, qty: number, unit: FoodUnit): { nutrients: Nutrients | null; error: string | null } {
  if (!food) return { nutrients: null, error: null };
  try {
    return {
      nutrients: nutrientsFor({ ...food, servingUnit: food.servingUnit as FoodUnit }, qty, unit),
      error: null,
    };
  } catch (e) {
    return {
      nutrients: null,
      error: e instanceof Error ? e.message : 'Cannot compute nutrition',
    };
  }
}

function serializeItem(i: ItemWithFood) {
  const min = itemNutrition(i.food, i.quantity, i.unit as FoodUnit);
  const max = i.quantityMax != null ? itemNutrition(i.food, i.quantityMax, i.unit as FoodUnit) : min;
  return {
    id: i.id,
    foodId: i.foodId,
    food: i.food ? foodSummary(i.food) : null,
    customName: i.customName,
    displayName: i.food?.name ?? i.customName ?? 'Item',
    quantity: i.quantity,
    quantityMax: i.quantityMax,
    unit: i.unit,
    isOptional: i.isOptional,
    alternativeOfId: i.alternativeOfId,
    sortOrder: i.sortOrder,
    notes: i.notes,
    nutrition: min.nutrients,
    nutritionMax: max.nutrients,
    unitError: min.error,
  };
}

export function serializeTemplate(t: TemplateWithItems) {
  const primaries = t.items.filter((i) => !i.alternativeOfId);
  const items = primaries.map((p) => ({
    ...serializeItem(p),
    alternatives: t.items.filter((a) => a.alternativeOfId === p.id).map(serializeItem),
  }));
  const counted = items.filter((i) => !i.isOptional);
  return {
    id: t.id,
    slotId: t.slotId,
    name: t.name,
    dayType: t.dayType,
    isPlan: t.isPlan,
    notes: t.notes,
    preparation: t.preparation,
    archivedAt: t.archivedAt,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    items,
    // Planned nutrition counts required primary items only (optional items and alternatives excluded).
    planned: {
      min: sumNutrients(counted.map((i) => i.nutrition ?? {})),
      max: sumNutrients(counted.map((i) => i.nutritionMax ?? {})),
    },
  };
}

export type TemplateDto = ReturnType<typeof serializeTemplate>;

// ───────────────────────────── Loading (one round trip) ─────────────────────────────

const itemOrder: Prisma.MealTemplateItemOrderByWithRelationInput[] = [{ sortOrder: 'asc' }, { createdAt: 'asc' }];

/**
 * Loads templates with their items and linked foods. Prisma's nested `include` runs one query per
 * level *sequentially*; here the three levels are independent queries run in parallel (one round trip).
 */
async function loadTemplates(
  where: Prisma.MealTemplateWhereInput,
  orderBy?: Prisma.MealTemplateOrderByWithRelationInput[],
  db: Db = prisma,
): Promise<TemplateWithItems[]> {
  const [templates, items, foods] = await Promise.all([
    db.mealTemplate.findMany({ where, orderBy }),
    db.mealTemplateItem.findMany({
      where: { template: where },
      orderBy: itemOrder,
    }),
    db.foodItem.findMany({
      where: { templateItems: { some: { template: where } } },
    }),
  ]);
  return attachItems(templates, items, foods);
}

function attachItems(templates: MealTemplate[], items: MealTemplateItem[], foods: FoodItem[]): TemplateWithItems[] {
  const foodById = new Map(foods.map((f) => [f.id, f]));
  const byTemplate = new Map<string, ItemWithFood[]>();
  for (const i of items) {
    const list = byTemplate.get(i.templateId) ?? [];
    list.push({
      ...i,
      food: i.foodId ? (foodById.get(i.foodId) ?? null) : null,
    });
    byTemplate.set(i.templateId, list);
  }
  return templates.map((t) => ({ ...t, items: byTemplate.get(t.id) ?? [] }));
}

const planTemplateWhere = (userId: string): Prisma.MealTemplateWhereInput => ({
  userId,
  isPlan: true,
  archivedAt: null,
  slotId: { not: null },
});
const activeSlotsQuery = (userId: string) =>
  prisma.mealSlot.findMany({
    where: { userId, archivedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

// ───────────────────────────── Slots ─────────────────────────────

export async function listSlots(userId: string, includeArchived = false) {
  const slots = await prisma.mealSlot.findMany({
    where: { userId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return slots.map(serializeSlot);
}

export async function createSlot(userId: string, input: z.infer<typeof slotInput>) {
  const max =
    input.sortOrder === undefined
      ? await prisma.mealSlot.aggregate({
          where: { userId },
          _max: { sortOrder: true },
        })
      : null;
  const slot = await prisma.mealSlot.create({
    data: {
      userId,
      name: input.name,
      defaultTime: input.defaultTime ?? null,
      sortOrder: input.sortOrder ?? (max?._max.sortOrder ?? -1) + 1,
    },
  });
  return serializeSlot(slot);
}

export async function updateSlot(userId: string, id: string, input: z.infer<typeof slotUpdate>) {
  const slot = await updateOwned<MealSlot>('MealSlot', id, userId, {
    name: input.name,
    defaultTime: input.defaultTime,
    sortOrder: input.sortOrder,
  });
  if (!slot) throw notFound('Meal slot');
  return serializeSlot(slot);
}

export async function reorderSlots(userId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  const owned = await prisma.mealSlot.count({
    where: { userId, id: { in: unique } },
  });
  if (owned !== unique.length || unique.length !== ids.length) throw badRequest('Unknown or duplicate meal slot ids');
  // One statement instead of one UPDATE per slot.
  await prisma.$executeRaw`
    UPDATE "MealSlot" AS s SET "sortOrder" = (x.ord - 1)::int, "updatedAt" = now()
    FROM unnest(${unique}::uuid[]) WITH ORDINALITY AS x(id, ord)
    WHERE s.id = x.id AND s."userId" = ${userId}::uuid`;
  return listSlots(userId);
}

export async function setSlotArchived(userId: string, id: string, archived: boolean) {
  const slot = await updateOwned<MealSlot>('MealSlot', id, userId, {
    archivedAt: archived ? new Date() : null,
  });
  if (!slot) throw notFound('Meal slot');
  return serializeSlot(slot);
}

/** Deletes a slot with no history; slots that have diary entries or statuses are archived instead. */
export async function deleteSlot(userId: string, id: string): Promise<{ archived: boolean }> {
  const [slot, entries, statuses] = await Promise.all([
    prisma.mealSlot.findFirst({ where: { id, userId }, select: { id: true } }),
    prisma.foodDiaryEntry.count({ where: { userId, slotId: id } }),
    prisma.dailyMealStatus.count({ where: { userId, slotId: id } }),
  ]);
  if (!slot) throw notFound('Meal slot');
  if (entries + statuses > 0) {
    await updateOwned('MealSlot', id, userId, { archivedAt: new Date() });
    return { archived: true };
  }
  await prisma.mealSlot.deleteMany({ where: { id, userId } });
  return { archived: false };
}

async function assertOwnedSlot(userId: string, id: string | null | undefined) {
  if (!id) return;
  const slot = await prisma.mealSlot.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!slot) throw notFound('Meal slot');
}

// ───────────────────────────── Templates ─────────────────────────────

async function getOwnedTemplate(userId: string, id: string, db: Db = prisma) {
  const [t] = await loadTemplates({ id, userId }, undefined, db);
  if (!t) throw notFound('Meal template');
  return t;
}

export async function listTemplates(userId: string, q: z.infer<typeof templateListQuery>) {
  const rows = await loadTemplates(
    {
      userId,
      ...(q.slotId ? { slotId: q.slotId } : {}),
      ...(q.dayType ? { dayType: q.dayType } : {}),
      ...(q.includeArchived ? {} : { archivedAt: null }),
    },
    [{ isPlan: 'desc' }, { name: 'asc' }],
  );
  return rows.map(serializeTemplate);
}

export async function getTemplate(userId: string, id: string) {
  return serializeTemplate(await getOwnedTemplate(userId, id));
}

type ItemInput = z.infer<typeof templateItemInput>;

/** Verifies linked foods belong to the user and that each unit can be converted for its food. */
async function validateItems(userId: string, items: ItemInput[]) {
  const ids = [...new Set(items.flatMap((i) => [i.foodId, ...i.alternatives.map((a) => a.foodId)]).filter((x): x is string => !!x))];
  const foods = ids.length ? await prisma.foodItem.findMany({ where: { userId, id: { in: ids } } }) : [];
  const byId = new Map(foods.map((f) => [f.id, f]));
  const check = (i: { foodId?: string | null; unit: FoodUnit; quantity: number }) => {
    if (!i.foodId) return;
    const food = byId.get(i.foodId);
    if (!food) throw badRequest('One or more foods do not exist');
    try {
      nutrientsFor({ ...food, servingUnit: food.servingUnit as FoodUnit }, i.quantity, i.unit);
    } catch (e) {
      if (e instanceof UnitMismatchError)
        throw badRequest(
          `${food.name} is measured in ${UNIT_LABELS[food.servingUnit as FoodUnit]} — use ${UNIT_LABELS[food.servingUnit as FoodUnit]} or servings`,
        );
      throw e;
    }
  };
  for (const i of items) {
    check(i);
    i.alternatives.forEach(check);
  }
}

/**
 * Item rows for a template, primaries and alternatives together. Ids are generated here so the
 * alternatives can point at their primary within the same multi-row INSERT (FKs are checked per statement).
 */
function itemRows(templateId: string, items: ItemInput[]): Prisma.MealTemplateItemCreateManyInput[] {
  const rows: Prisma.MealTemplateItemCreateManyInput[] = [];
  for (const [idx, it] of items.entries()) {
    const id = randomUUID();
    rows.push({
      id,
      templateId,
      foodId: it.foodId ?? null,
      customName: it.customName,
      quantity: it.quantity,
      quantityMax: it.quantityMax ?? null,
      unit: it.unit,
      isOptional: it.isOptional,
      sortOrder: idx,
      notes: it.notes,
    });
    for (const [j, a] of it.alternatives.entries()) {
      rows.push({
        id: randomUUID(),
        templateId,
        alternativeOfId: id,
        foodId: a.foodId ?? null,
        customName: a.customName,
        quantity: a.quantity,
        quantityMax: a.quantityMax ?? null,
        unit: a.unit,
        isOptional: false,
        sortOrder: j,
        notes: a.notes,
      });
    }
  }
  return rows;
}

/** Copies existing item rows to another template, remapping alternative links. */
function copiedItemRows(templateId: string, items: MealTemplateItem[]): Prisma.MealTemplateItemCreateManyInput[] {
  const idMap = new Map(items.filter((i) => !i.alternativeOfId).map((i) => [i.id, randomUUID()]));
  return items
    .filter((i) => !i.alternativeOfId || idMap.has(i.alternativeOfId))
    .map((i) => ({
      id: i.alternativeOfId ? randomUUID() : idMap.get(i.id)!,
      templateId,
      alternativeOfId: i.alternativeOfId ? idMap.get(i.alternativeOfId)! : null,
      foodId: i.foodId,
      customName: i.customName,
      quantity: i.quantity,
      quantityMax: i.quantityMax,
      unit: i.unit,
      isOptional: i.alternativeOfId ? false : i.isOptional,
      sortOrder: i.sortOrder,
      notes: i.notes,
    }));
}

export async function createTemplate(userId: string, input: z.infer<typeof templateInput>) {
  await Promise.all([assertOwnedSlot(userId, input.slotId), validateItems(userId, input.items)]);
  const id = randomUUID();
  const rows = itemRows(id, input.items);
  await prisma.mealTemplate.create({
    data: {
      id,
      userId,
      slotId: input.slotId ?? null,
      name: input.name,
      dayType: input.dayType,
      notes: input.notes,
      preparation: input.preparation,
      ...(rows.length
        ? {
            items: {
              createMany: { data: rows.map(({ templateId: _t, ...r }) => r) },
            },
          }
        : {}),
    },
    select: { id: true },
  });
  return getTemplate(userId, id);
}

/**
 * Updates a template. When `items` is given they are replaced atomically.
 * Diary entries logged from the old items keep their snapshots (templateItemId becomes null).
 */
export async function updateTemplate(userId: string, id: string, input: z.infer<typeof templateUpdate>) {
  const [existing] = await Promise.all([
    prisma.mealTemplate.findFirst({ where: { id, userId } }),
    assertOwnedSlot(userId, input.slotId),
    input.items ? validateItems(userId, input.items) : null,
  ]);
  if (!existing) throw notFound('Meal template');
  const movesPlan =
    existing.isPlan &&
    ((input.slotId !== undefined && input.slotId !== existing.slotId) || (input.dayType !== undefined && input.dayType !== existing.dayType));
  const data: Prisma.MealTemplateUpdateInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.slotId !== undefined
      ? {
          slot: input.slotId ? { connect: { id: input.slotId } } : { disconnect: true },
        }
      : {}),
    ...(input.dayType !== undefined ? { dayType: input.dayType } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.preparation !== undefined ? { preparation: input.preparation } : {}),
    // A plan template moved to another slot/day type stops being the plan (never silently replace another plan).
    ...(movesPlan ? { isPlan: false } : {}),
  };
  if (input.items) {
    const rows = itemRows(id, input.items).map(({ templateId: _t, ...r }) => r);
    // Nested writes run in one transaction: items are replaced atomically with the template fields.
    data.items = {
      deleteMany: {},
      ...(rows.length ? { createMany: { data: rows } } : {}),
    };
  }
  await prisma.mealTemplate.update({
    where: { id },
    data,
    select: { id: true },
  });
  return getTemplate(userId, id);
}

/** Creates a copy of `src` (already loaded). Returns the new id. */
async function copyTemplate(userId: string, src: TemplateWithItems, overrides: { name?: string; dayType?: DayType }, db: Db = prisma) {
  const id = randomUUID();
  const rows = copiedItemRows(id, src.items).map(({ templateId: _t, ...r }) => r);
  await db.mealTemplate.create({
    data: {
      id,
      userId,
      slotId: src.slotId,
      name: overrides.name ?? `${src.name} (copy)`,
      dayType: overrides.dayType ?? src.dayType,
      isPlan: false,
      notes: src.notes,
      preparation: src.preparation,
      ...(rows.length ? { items: { createMany: { data: rows } } } : {}),
    },
    select: { id: true },
  });
  return id;
}

export async function duplicateTemplate(userId: string, id: string, overrides: { name?: string; dayType?: DayType } = {}, db?: Tx) {
  const src = await getOwnedTemplate(userId, id, db ?? prisma);
  return copyTemplate(userId, src, overrides, db ?? prisma);
}

export async function setTemplateArchived(userId: string, id: string, archived: boolean) {
  const { count } = await prisma.mealTemplate.updateMany({
    where: { id, userId },
    data: archived ? { archivedAt: new Date(), isPlan: false } : { archivedAt: null },
  });
  if (!count) throw notFound('Meal template');
  return getTemplate(userId, id);
}

export async function deleteTemplate(userId: string, id: string) {
  const { count } = await prisma.mealTemplate.deleteMany({
    where: { id, userId },
  });
  if (!count) throw notFound('Meal template');
}

// ───────────────────────────── Plan ─────────────────────────────

type PlanInputs = {
  date: string | null;
  dayType: DayType;
  slots: MealSlot[];
  templates: TemplateWithItems[];
  statuses: DailyMealStatus[];
  target: NutritionTarget | null;
};

/** Plan template for each active slot. GYM/REST prefer an exact match, then fall back to ANY. */
function buildPlan({ date, dayType, slots, templates, statuses, target }: PlanInputs) {
  const statusBySlot = new Map(statuses.map((s) => [s.slotId, s]));
  const allowed: DayType[] = dayType === 'ANY' ? ['ANY'] : [dayType, 'ANY'];
  const usable = templates.filter((t) => allowed.includes(t.dayType));

  const planSlots = slots.map((slot) => {
    const forSlot = usable.filter((t) => t.slotId === slot.id);
    const chosen = forSlot.find((t) => t.dayType === dayType) ?? forSlot.find((t) => t.dayType === 'ANY') ?? null;
    const st = statusBySlot.get(slot.id);
    const template = chosen ? serializeTemplate(chosen) : null;
    return {
      slot: serializeSlot(slot),
      template,
      inherited: !!chosen && chosen.dayType !== dayType,
      planned: template?.planned ?? null,
      status: date ? ((st?.status ?? 'PENDING') as MealStatus) : null,
      statusNotes: st?.notes ?? null,
      completedAt: st?.completedAt ?? null,
    };
  });

  const withPlan = planSlots.filter((s) => s.planned);
  const totals = withPlan.length
    ? {
        min: sumNutrients(withPlan.map((s) => s.planned!.min)),
        max: sumNutrients(withPlan.map((s) => s.planned!.max)),
      }
    : null;

  return {
    date,
    dayType,
    slots: planSlots,
    totals,
    target: serializeTarget(target),
    progress: totals && target ? nutrientProgress(totals.min, target) : null,
  };
}

/** Everything for the plan loads in one round trip (day type, slots, plan templates, statuses, targets). */
export async function getPlan(userId: string, opts: { date?: string; dayType?: DayType; gymWeekdays: number[] }) {
  const date = opts.date ?? null;
  const [resolvedDayType, slots, templates, statuses, targets] = await Promise.all([
    opts.dayType ?? (date ? getDayType(userId, date, opts.gymWeekdays) : ('ANY' as const)),
    activeSlotsQuery(userId),
    loadTemplates(planTemplateWhere(userId)),
    date
      ? prisma.dailyMealStatus.findMany({
          where: { userId, date: toDbDate(date) },
        })
      : Promise.resolve([]),
    targetsOf(userId),
  ]);
  const target = date ? targetOn(targets, date) : (targets[targets.length - 1] ?? null);
  return buildPlan({
    date,
    dayType: resolvedDayType,
    slots,
    templates,
    statuses,
    target,
  });
}

/**
 * Diary day plus that day's meal plan in a single round trip (GET /api/food-diary?withPlan=true).
 * The diary screen needs both; sharing the slot/status/target queries avoids a second request.
 */
export async function getDiaryWithPlan(userId: string, date: string, gymWeekdays: number[]) {
  const [[entries, statuses, slots, targets, dayType], templates] = await Promise.all([
    loadDayRows(userId, date, gymWeekdays),
    loadTemplates(planTemplateWhere(userId)),
  ]);
  const target = targetOn(targets, date);
  const day = buildDay(date, dayType, entries, statuses, slots, target);
  const plan = buildPlan({
    date,
    dayType,
    slots: slots.filter((s) => !s.archivedAt),
    templates,
    statuses,
    target,
  });
  return { ...day, plan };
}

/**
 * Sets (or clears, templateId=null) the plan template for a slot + day type.
 * A template that is already the plan for another day type is duplicated so that plan stays intact.
 */
export async function setPlan(userId: string, slotId: string, input: z.infer<typeof setPlanInput>) {
  const [slot, t] = await Promise.all([
    prisma.mealSlot.findFirst({
      where: { id: slotId, userId },
      select: { id: true },
    }),
    input.templateId ? getOwnedTemplate(userId, input.templateId) : null,
  ]);
  if (!slot) throw notFound('Meal slot');
  if (input.templateId && t?.archivedAt) throw badRequest('Unarchive this template before using it as a plan');

  const unsetCurrent = prisma.mealTemplate.updateMany({
    where: { userId, slotId, dayType: input.dayType, isPlan: true },
    data: { isPlan: false },
  });
  if (!t) {
    await unsetCurrent;
    return null;
  }
  const keepsOtherPlan = t.isPlan && (t.dayType !== input.dayType || t.slotId !== slotId);
  if (keepsOtherPlan) {
    // The copy is created directly as the plan for this slot/day type.
    const id = randomUUID();
    const rows = copiedItemRows(id, t.items).map(({ templateId: _t, ...r }) => r);
    await prisma.$transaction([
      unsetCurrent,
      prisma.mealTemplate.create({
        data: {
          id,
          userId,
          slotId,
          name: t.name,
          dayType: input.dayType,
          isPlan: true,
          notes: t.notes,
          preparation: t.preparation,
          ...(rows.length ? { items: { createMany: { data: rows } } } : {}),
        },
        select: { id: true },
      }),
    ]);
    return getTemplate(userId, id);
  }
  const [, updated] = await prisma.$transaction([
    unsetCurrent,
    prisma.mealTemplate.update({
      where: { id: t.id },
      data: { isPlan: true, slotId, dayType: input.dayType },
    }),
  ]);
  return serializeTemplate({ ...t, ...updated });
}

// ───────────────────────────── Meal status ─────────────────────────────

export function serializeStatus(s: {
  id: string;
  date: Date;
  slotId: string;
  templateId: string | null;
  status: MealStatus;
  completedAt: Date | null;
  notes: string | null;
}) {
  return {
    id: s.id,
    date: fromDbDate(s.date),
    slotId: s.slotId,
    templateId: s.templateId,
    status: s.status,
    completedAt: s.completedAt,
    notes: s.notes,
  };
}

/**
 * Owner-checked status upsert as ONE statement: the INSERT selects from the user's slot (and checks the
 * template when given), so a foreign slot/template inserts nothing and returns no row. `completedAt` keeps the
 * first completion time. Prisma's upsert would need the ownership reads and the current row first.
 */
async function upsertStatus(
  userId: string,
  date: string,
  slotId: string,
  status: MealStatus,
  extra: { notes?: string | null; templateId?: string | null } = {},
): Promise<DailyMealStatus | null> {
  const done = status === 'COMPLETED' || status === 'PARTIAL';
  const templateId = extra.templateId ?? null;
  const rows = await prisma.$queryRaw<DailyMealStatus[]>`
    INSERT INTO "DailyMealStatus" ("id", "userId", "date", "slotId", "templateId", "status", "completedAt", "notes", "createdAt", "updatedAt")
    SELECT ${randomUUID()}::uuid, s."userId", ${date}::date, s."id", ${templateId}::uuid, ${status}::"MealStatus",
           CASE WHEN ${done} THEN now() END, ${extra.notes ?? null}, now(), now()
    FROM "MealSlot" s
    WHERE s."id" = ${slotId}::uuid AND s."userId" = ${userId}::uuid
      AND (${templateId}::uuid IS NULL OR EXISTS (SELECT 1 FROM "MealTemplate" t WHERE t."id" = ${templateId}::uuid AND t."userId" = ${userId}::uuid))
    ON CONFLICT ("userId", "date", "slotId") DO UPDATE SET
      "status" = EXCLUDED."status",
      "completedAt" = CASE WHEN ${done} THEN COALESCE("DailyMealStatus"."completedAt", now()) END,
      "notes" = CASE WHEN ${extra.notes !== undefined} THEN EXCLUDED."notes" ELSE "DailyMealStatus"."notes" END,
      "templateId" = CASE WHEN ${extra.templateId !== undefined} THEN EXCLUDED."templateId" ELSE "DailyMealStatus"."templateId" END,
      "updatedAt" = now()
    RETURNING ${returningColumns('DailyMealStatus')}`;
  return rows[0] ?? null;
}

/** One round trip: the upsert itself checks slot/template ownership. */
export async function setStatus(userId: string, input: z.infer<typeof statusInput>) {
  const row = await upsertStatus(userId, input.date, input.slotId, input.status, {
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.templateId !== undefined ? { templateId: input.templateId } : {}),
  });
  if (!row) {
    // Rare failure path: work out which reference was wrong for the error message.
    const slot = await prisma.mealSlot.findFirst({
      where: { id: input.slotId, userId },
      select: { id: true },
    });
    throw notFound(slot ? 'Meal template' : 'Meal slot');
  }
  return serializeStatus(row);
}

/**
 * Explicitly logs a planned meal: creates diary entries (with nutrition snapshots) for the
 * selected items that have a linked food, then marks the slot COMPLETED or PARTIAL.
 * Free-text items (no food) count as eaten when selected but create no entry.
 * Two round trips: all reads/validation together, then the inserts + status upsert together.
 */
export async function applyTemplate(userId: string, input: z.infer<typeof applyTemplateInput>) {
  const swapIds = [...new Set(input.overrides.map((o) => o.foodId).filter((x): x is string => !!x))];
  const [slot, templates, swapFoods] = await Promise.all([
    prisma.mealSlot.findFirst({
      where: { id: input.slotId, userId },
      select: { id: true },
    }),
    loadTemplates({ id: input.templateId, userId }),
    swapIds.length ? prisma.foodItem.findMany({ where: { userId, id: { in: swapIds } } }) : Promise.resolve([]),
  ]);
  if (!slot) throw notFound('Meal slot');
  const template = templates[0];
  if (!template) throw notFound('Meal template');
  const byId = new Map(template.items.map((i) => [i.id, i]));
  const primaries = template.items.filter((i) => !i.alternativeOfId);

  const selectedIds = input.itemIds ?? primaries.filter((p) => !p.isOptional).map((p) => p.id);
  for (const id of selectedIds) if (!byId.has(id)) throw badRequest('Selected item is not part of this template');
  for (const o of input.overrides) if (!byId.has(o.itemId)) throw badRequest('Override item is not part of this template');
  if (!selectedIds.length) throw badRequest('Select at least one item to log');

  const overrides = new Map(input.overrides.map((o) => [o.itemId, o]));
  if (swapFoods.length !== swapIds.length) throw badRequest('Food not found');
  const swapById = new Map(swapFoods.map((f) => [f.id, f]));

  const consumedAt = input.consumedAt ? new Date(input.consumedAt) : new Date();
  const rows: Prisma.FoodDiaryEntryCreateManyInput[] = [];
  for (const id of [...new Set(selectedIds)]) {
    const item = byId.get(id)!;
    const o = overrides.get(id);
    const food = o?.foodId ? swapById.get(o.foodId)! : item.food;
    if (!food) continue; // free-text item
    const qty = o?.quantity ?? item.quantity;
    const unit = (o?.unit ?? item.unit) as FoodUnit;
    let snap;
    try {
      snap = snapshotFromFood(food, qty, unit);
    } catch (e) {
      if (e instanceof UnitMismatchError) throw badRequest(`${food.name}: ${e.message}`);
      throw e;
    }
    rows.push({
      ...snap,
      userId,
      date: toDbDate(input.date),
      slotId: input.slotId,
      templateItemId: item.id,
      consumedAt,
      notes: input.notes ?? null,
    });
  }

  // A required primary item is covered when it or one of its alternatives was selected.
  const selected = new Set(selectedIds);
  const required = primaries.filter((p) => !p.isOptional);
  const covered = required.every((p) => selected.has(p.id) || template.items.some((a) => a.alternativeOfId === p.id && selected.has(a.id)));
  const status: MealStatus = covered ? 'COMPLETED' : 'PARTIAL';

  // Single-statement INSERTs + the status upsert, sent side by side: one round trip. (createMany and an
  // explicit transaction both add BEGIN/COMMIT round trips on the remote database.)
  const loggedAt = Date.now();
  const [st, ...entries] = await Promise.all([
    upsertStatus(userId, input.date, input.slotId, status, {
      templateId: template.id,
    }),
    // Explicit createdAt keeps the template's item order (parallel inserts would otherwise tie or interleave).
    ...rows.map((data, i) =>
      prisma.foodDiaryEntry.create({
        data: { ...data, createdAt: new Date(loggedAt + i) },
      }),
    ),
  ]);
  return { status: serializeStatus(st!), entries: entries.map(serializeEntry) };
}

/** Duplicates diary entries (and meal statuses) from one day to another. Time eaten is left blank. */
export async function copyDay(userId: string, input: z.infer<typeof copyDayInput>) {
  const slotFilter = input.slotIds ? { slotId: { in: input.slotIds } } : {};
  const [entries, statuses] = await Promise.all([
    prisma.foodDiaryEntry.findMany({
      where: { userId, date: toDbDate(input.fromDate), ...slotFilter },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.dailyMealStatus.findMany({
      where: { userId, date: toDbDate(input.fromDate), ...slotFilter },
    }),
  ]);
  if (!entries.length) throw conflict('Nothing was logged on that day for the selected meals');

  const slotsWithEntries = new Set(entries.map((e) => e.slotId));
  const toCopy = statuses.filter((s) => slotsWithEntries.has(s.slotId));
  // Independent single statements in parallel (one round trip for typical day sizes); createdAt keeps the order.
  const base = Date.now();
  await Promise.all([
    ...entries.map(({ id: _id, createdAt: _c, updatedAt: _u, ...e }, i) =>
      prisma.foodDiaryEntry.create({
        data: {
          ...e,
          date: toDbDate(input.toDate),
          consumedAt: null,
          createdAt: new Date(base + i),
        },
        select: { id: true },
      }),
    ),
    ...toCopy.map((s) =>
      upsertStatus(userId, input.toDate, s.slotId, s.status, {
        templateId: s.templateId,
        notes: s.notes,
      }),
    ),
  ]);
  return { copied: entries.length, statuses: toCopy.length };
}
