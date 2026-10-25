import { Prisma, type FoodCategory, type FoodItem } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Db } from '../db';
import { badRequest, conflict, notFound, paginationQuery } from '../lib/http';
import { FOOD_UNITS, type FoodUnit } from '../../shared/nutrition';

// ───────────────────────────── Validation ─────────────────────────────

export const foodUnitSchema = z.enum(FOOD_UNITS as [FoodUnit, ...FoodUnit[]]);

/** Query-string boolean: only 'true'/'1' are true (z.coerce.boolean would treat 'false' as true). */
export const boolQuery = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const nutrient = z.number().finite().min(0, 'Must be 0 or more').max(100_000);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined ? undefined : v || null));

export const foodInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  brand: optionalText(120),
  preparation: optionalText(500),
  notes: optionalText(1000),
  servingSize: z.number().finite().positive('Serving size must be greater than 0').max(100_000),
  servingUnit: foodUnitSchema,
  servingLabel: optionalText(80),
  calories: nutrient,
  protein: nutrient,
  carbs: nutrient,
  fat: nutrient,
  fiber: nutrient.default(0),
  isEstimate: z.boolean().default(true),
  source: z.enum(['CUSTOM', 'LABEL']).default('CUSTOM'),
  isFavorite: z.boolean().default(false),
  imageMediaId: z.string().uuid().nullish(),
  categoryIds: z.array(z.string().uuid()).max(30).default([]),
});

export const foodUpdate = foodInput
  .omit({ source: true })
  .extend({ source: z.enum(['SEED', 'CUSTOM', 'LABEL']) })
  .partial();

export const foodListQuery = paginationQuery.extend({
  search: z.string().trim().max(120).optional(),
  categoryId: z.string().uuid().optional(),
  favorites: boolQuery.optional(),
  includeArchived: boolQuery.optional(),
  archivedOnly: boolQuery.optional(),
  minProtein: z.coerce.number().min(0).optional(),
  minFiber: z.coerce.number().min(0).optional(),
  maxCalories: z.coerce.number().min(0).optional(),
  sort: z.enum(['name', 'protein', 'fiber', 'calories', 'recent']).default('name'),
  order: z.enum(['asc', 'desc']).optional(),
});

export const categoryInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});

// ───────────────────────────── Serialisation ─────────────────────────────

type FoodWithCategories = FoodItem & {
  categories: { category: FoodCategory }[];
};

export function serializeCategory(c: FoodCategory) {
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    isSystem: c.isSystem,
    sortOrder: c.sortOrder,
  };
}

export function serializeFood(f: FoodWithCategories) {
  const { categories, ...rest } = f;
  return {
    ...rest,
    categories: categories.map((c) => serializeCategory(c.category)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
  };
}

export type FoodDto = ReturnType<typeof serializeFood>;

// ───────────────────────────── Single-statement writes ─────────────────────────────

type Scalar = string | number | boolean | Date | null;
type Cast = { value: Scalar; type: string };
export type OwnedValue = Scalar | Cast;

/** Marks a value that needs an explicit SQL cast (enums, uuid, date) in `updateOwned`. */
export const sqlCast = (value: Scalar, type: string): Cast => ({ value, type });

/**
 * `UPDATE "table" SET … WHERE id = $id AND "userId" = $userId RETURNING *` as ONE statement.
 * Prisma's update/updateMany/updateManyAndReturn wrap the write in BEGIN/COMMIT (three round trips on a
 * remote database); this is one. Returns null when the row doesn't exist or isn't the user's.
 * Column names come from code (never from input); values are always bound parameters.
 */
/**
 * RETURNING list for raw statements: every column of the model, enums cast to text. Without the casts the
 * driver looks up the enum type OIDs first — extra round trips on each new connection.
 */
export function returningColumns(model: 'FoodDiaryEntry' | 'WaterEntry' | 'FoodItem' | 'MealSlot' | 'DailyMealStatus') {
  const fields = Prisma.dmmf.datamodel.models.find((m) => m.name === model)!.fields.filter((x) => x.kind === 'scalar' || x.kind === 'enum');
  return Prisma.raw(fields.map((x) => (x.kind === 'enum' ? `"${x.name}"::text AS "${x.name}"` : `"${x.name}"`)).join(', '));
}

export async function updateOwned<T>(
  table: 'FoodDiaryEntry' | 'WaterEntry' | 'FoodItem' | 'MealSlot',
  id: string,
  userId: string,
  set: Record<string, OwnedValue | undefined>,
): Promise<T | null> {
  const assignments = Object.entries(set)
    .filter((e): e is [string, OwnedValue] => e[1] !== undefined)
    .map(([col, v]) => {
      const column = Prisma.raw(`"${col.replace(/[^A-Za-z0-9_]/g, '')}"`);
      if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
        return Prisma.sql`${column} = ${v.value}::${Prisma.raw(v.type)}`;
      }
      return Prisma.sql`${column} = ${v}`;
    });
  assignments.push(Prisma.sql`"updatedAt" = now()`);
  const rows = await prisma.$queryRaw<T[]>`
    UPDATE ${Prisma.raw(`"${table}"`)} SET ${Prisma.join(assignments)}
    WHERE "id" = ${id}::uuid AND "userId" = ${userId}::uuid
    RETURNING ${returningColumns(table)}`;
  return rows[0] ?? null;
}

// ───────────────────────────── Helpers ─────────────────────────────

export function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'category'
  );
}

/** Returns the user's categories with these ids; throws if any is unknown. */
async function assertCategories(userId: string, ids: string[], db: Db = prisma) {
  const unique = [...new Set(ids)];
  if (!unique.length) return [];
  const rows = await db.foodCategory.findMany({
    where: { userId, id: { in: unique } },
  });
  if (rows.length !== unique.length) throw badRequest('One or more categories do not exist');
  return rows;
}

async function assertMedia(userId: string, mediaId: string | null | undefined, db: Db = prisma) {
  if (!mediaId) return;
  const media = await db.mediaAsset.findFirst({
    where: { id: mediaId, userId, deletedAt: null },
    select: { id: true },
  });
  if (!media) throw badRequest('Image not found');
}

function attachCategories(foods: FoodItem[], links: { foodId: string; categoryId: string }[], categories: FoodCategory[]): FoodWithCategories[] {
  const catById = new Map(categories.map((c) => [c.id, c]));
  const byFood = new Map<string, { category: FoodCategory }[]>();
  for (const l of links) {
    const category = catById.get(l.categoryId);
    if (!category) continue;
    const list = byFood.get(l.foodId) ?? [];
    list.push({ category });
    byFood.set(l.foodId, list);
  }
  return foods.map((f) => ({ ...f, categories: byFood.get(f.id) ?? [] }));
}

/** Category links + the user's categories for foods matching `where` — both queries can run beside the food query. */
function categoryQueries(userId: string, where: Prisma.FoodItemWhereInput) {
  return [
    prisma.foodItemCategory.findMany({
      where: { food: where },
      select: { foodId: true, categoryId: true },
    }),
    prisma.foodCategory.findMany({ where: { userId } }),
  ] as const;
}

/** One food with categories in one round trip (Prisma's nested include would cost two more). */
export async function getOwnedFood(userId: string, id: string) {
  const where = { id, userId };
  const [food, links, categories] = await Promise.all([prisma.foodItem.findFirst({ where }), ...categoryQueries(userId, where)]);
  if (!food) throw notFound('Food');
  return attachCategories([food], links, categories)[0];
}

// ───────────────────────────── Foods ─────────────────────────────

export async function listFoods(userId: string, q: z.infer<typeof foodListQuery>) {
  const where: Prisma.FoodItemWhereInput = { userId };
  if (q.archivedOnly) where.archivedAt = { not: null };
  else if (!q.includeArchived) where.archivedAt = null;
  if (q.search) {
    where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { brand: { contains: q.search, mode: 'insensitive' } }];
  }
  if (q.categoryId) where.categories = { some: { categoryId: q.categoryId } };
  if (q.favorites) where.isFavorite = true;
  if (q.minProtein != null) where.protein = { gte: q.minProtein };
  if (q.minFiber != null) where.fiber = { gte: q.minFiber };
  if (q.maxCalories != null) where.calories = { lte: q.maxCalories };

  const orderBy: Prisma.FoodItemOrderByWithRelationInput[] = [];
  switch (q.sort) {
    case 'protein':
    case 'fiber':
      orderBy.push({ [q.sort]: q.order ?? 'desc' });
      break;
    case 'calories':
      orderBy.push({ calories: q.order ?? 'asc' });
      break;
    case 'recent':
      orderBy.push({ updatedAt: q.order ?? 'desc' });
      break;
    default:
      // Favourites first when browsing alphabetically.
      orderBy.push({ isFavorite: 'desc' }, { name: q.order ?? 'asc' });
  }
  orderBy.push({ id: 'asc' });

  // Count, page, category links and categories are independent: one round trip, no transaction.
  const [total, rows, links, categories] = await Promise.all([
    prisma.foodItem.count({ where }),
    prisma.foodItem.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    ...categoryQueries(userId, where),
  ]);
  return {
    total,
    items: attachCategories(rows, links, categories).map(serializeFood),
  };
}

export async function getFood(userId: string, id: string) {
  return serializeFood(await getOwnedFood(userId, id));
}

export async function createFood(userId: string, input: z.infer<typeof foodInput>) {
  const [cats] = await Promise.all([assertCategories(userId, input.categoryIds), assertMedia(userId, input.imageMediaId)]);
  const { categoryIds: _ignored, ...data } = input;
  void _ignored;
  const food = await prisma.foodItem.create({
    data: {
      ...data,
      imageMediaId: input.imageMediaId ?? null,
      userId,
      ...(cats.length ? { categories: { create: cats.map((c) => ({ categoryId: c.id })) } } : {}),
    },
  });
  return serializeFood({
    ...food,
    categories: cats.map((category) => ({ category })),
  });
}

/**
 * Updates the reusable food only. Diary entries keep their own nutrition snapshot,
 * so past days are never rewritten by this.
 */
export async function updateFood(userId: string, id: string, input: z.infer<typeof foodUpdate>) {
  const [existing, cats] = await Promise.all([
    prisma.foodItem.findFirst({ where: { id, userId }, select: { id: true } }),
    input.categoryIds ? assertCategories(userId, input.categoryIds) : null,
    input.imageMediaId !== undefined ? assertMedia(userId, input.imageMediaId) : null,
  ]);
  if (!existing) throw notFound('Food');
  const { categoryIds: _ignored, ...data } = input;
  void _ignored;
  if (cats) {
    // Nested writes run atomically with the field update.
    const food = await prisma.foodItem.update({
      where: { id },
      data: {
        ...data,
        categories: {
          deleteMany: {},
          ...(cats.length ? { create: cats.map((c) => ({ categoryId: c.id })) } : {}),
        },
      },
    });
    return serializeFood({
      ...food,
      categories: cats.map((category) => ({ category })),
    });
  }
  return patchFood(userId, id, {
    ...data,
    servingUnit: data.servingUnit !== undefined ? sqlCast(data.servingUnit, '"FoodUnit"') : undefined,
    source: data.source !== undefined ? sqlCast(data.source, '"FoodSource"') : undefined,
    imageMediaId: data.imageMediaId !== undefined ? sqlCast(data.imageMediaId, 'uuid') : undefined,
  });
}

/** Single-field update + category lookups in one round trip; the owner filter is the ownership check. */
async function patchFood(userId: string, id: string, set: Record<string, OwnedValue | undefined>) {
  const where = { id, userId };
  const [food, links, categories] = await Promise.all([updateOwned<FoodItem>('FoodItem', id, userId, set), ...categoryQueries(userId, where)]);
  if (!food) throw notFound('Food');
  return serializeFood(attachCategories([food], links, categories)[0]);
}

export async function setArchived(userId: string, id: string, archived: boolean) {
  return patchFood(userId, id, { archivedAt: archived ? new Date() : null });
}

export async function setFavorite(userId: string, id: string, isFavorite: boolean) {
  return patchFood(userId, id, { isFavorite });
}

/** Hard delete. Diary entries and template items keep their history via SetNull FKs. */
export async function deleteFood(userId: string, id: string) {
  const { count } = await prisma.foodItem.deleteMany({ where: { id, userId } });
  if (!count) throw notFound('Food');
}

// ───────────────────────────── Categories ─────────────────────────────

export async function listCategories(userId: string) {
  const rows = await prisma.foodCategory.findMany({
    where: { userId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    include: { _count: { select: { foods: true } } },
  });
  return rows.map((c) => ({
    ...serializeCategory(c),
    foodCount: c._count.foods,
  }));
}

async function uniqueSlug(userId: string, name: string, exceptId?: string) {
  const slug = slugify(name);
  const clash = await prisma.foodCategory.findFirst({
    where: { userId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
  if (clash) throw conflict(`A category named "${clash.name}" already exists`);
  return slug;
}

export async function createCategory(userId: string, input: z.infer<typeof categoryInput>) {
  const slug = await uniqueSlug(userId, input.name);
  const max = await prisma.foodCategory.aggregate({
    where: { userId },
    _max: { sortOrder: true },
  });
  const c = await prisma.foodCategory.create({
    data: {
      userId,
      name: input.name,
      slug,
      isSystem: false,
      sortOrder: input.sortOrder ?? (max._max.sortOrder ?? 0) + 1,
    },
  });
  return { ...serializeCategory(c), foodCount: 0 };
}

/**
 * System categories can be renamed but keep their slug (other code may look them up by slug).
 */
export async function updateCategory(userId: string, id: string, input: Partial<z.infer<typeof categoryInput>>) {
  const existing = await prisma.foodCategory.findFirst({
    where: { id, userId },
  });
  if (!existing) throw notFound('Category');
  const data: Prisma.FoodCategoryUpdateInput = {};
  if (input.name !== undefined) {
    data.name = input.name;
    if (!existing.isSystem) data.slug = await uniqueSlug(userId, input.name, id);
  }
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  const c = await prisma.foodCategory.update({
    where: { id },
    data,
    include: { _count: { select: { foods: true } } },
  });
  return { ...serializeCategory(c), foodCount: c._count.foods };
}

export async function deleteCategory(userId: string, id: string) {
  const existing = await prisma.foodCategory.findFirst({
    where: { id, userId },
  });
  if (!existing) throw notFound('Category');
  if (existing.isSystem) throw badRequest('Built-in categories can be renamed but not deleted');
  await prisma.foodCategory.delete({ where: { id } });
}
