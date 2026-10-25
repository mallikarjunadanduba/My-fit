/**
 * Pure nutrition math shared by the API and the React app.
 * Food nutrition values are stored per one serving (servingSize × servingUnit).
 */

export type FoodUnit = 'G' | 'ML' | 'PIECE' | 'SCOOP' | 'SERVING';

export const FOOD_UNITS: FoodUnit[] = ['G', 'ML', 'PIECE', 'SCOOP', 'SERVING'];

export const UNIT_LABELS: Record<FoodUnit, string> = {
  G: 'g',
  ML: 'ml',
  PIECE: 'piece',
  SCOOP: 'scoop',
  SERVING: 'serving',
};

export interface Nutrients {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
}

export const ZERO_NUTRIENTS: Nutrients = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };

export const NUTRIENT_KEYS: (keyof Nutrients)[] = ['calories', 'protein', 'carbs', 'fat', 'fiber'];

export interface ServingBasis extends Nutrients {
  servingSize: number;
  servingUnit: FoodUnit;
}

export class UnitMismatchError extends Error {}

/**
 * How many servings `quantity unit` represents.
 * - Same unit as the serving → quantity / servingSize.
 * - SERVING → quantity servings.
 * Anything else can't be converted without density/weight data and is rejected.
 */
export function servingFactor(quantity: number, unit: FoodUnit, servingSize: number, servingUnit: FoodUnit): number {
  if (!Number.isFinite(quantity) || quantity < 0) throw new RangeError('Quantity must be a non-negative number');
  if (!Number.isFinite(servingSize) || servingSize <= 0) throw new RangeError('Serving size must be positive');
  if (unit === servingUnit) return quantity / servingSize;
  if (unit === 'SERVING') return quantity;
  throw new UnitMismatchError(`Cannot convert ${UNIT_LABELS[unit]} to ${UNIT_LABELS[servingUnit]}`);
}

/** Units a food can be logged in. */
export function allowedUnits(servingUnit: FoodUnit): FoodUnit[] {
  return servingUnit === 'SERVING' ? ['SERVING'] : [servingUnit, 'SERVING'];
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

export function scaleNutrients(basis: Nutrients, factor: number): Nutrients {
  return {
    calories: round1(basis.calories * factor),
    protein: round1(basis.protein * factor),
    carbs: round1(basis.carbs * factor),
    fat: round1(basis.fat * factor),
    fiber: round1(basis.fiber * factor),
  };
}

export function nutrientsFor(basis: ServingBasis, quantity: number, unit: FoodUnit): Nutrients {
  return scaleNutrients(basis, servingFactor(quantity, unit, basis.servingSize, basis.servingUnit));
}

export function sumNutrients(items: Partial<Nutrients>[]): Nutrients {
  const total = { ...ZERO_NUTRIENTS };
  for (const it of items) for (const k of NUTRIENT_KEYS) total[k] += it[k] ?? 0;
  for (const k of NUTRIENT_KEYS) total[k] = round1(total[k]);
  return total;
}

/** Energy implied by macros (4/4/9 kcal per g). Fiber is intentionally excluded. */
export function caloriesFromMacros(n: Pick<Nutrients, 'protein' | 'carbs' | 'fat'>): number {
  return round1(n.protein * 4 + n.carbs * 4 + n.fat * 9);
}

export type ProgressStatus = 'under' | 'within' | 'over';

export interface TargetProgress {
  target: number;
  min: number | null;
  max: number | null;
  actual: number;
  remaining: number; // never negative
  over: number; // amount above max (or target if no max), never negative
  percent: number; // actual / target × 100, rounded
  status: ProgressStatus;
}

export function targetProgress(actual: number, target: number, min?: number | null, max?: number | null): TargetProgress {
  const lo = min ?? target;
  const hi = max ?? target;
  const status: ProgressStatus = actual > hi ? 'over' : actual >= lo ? 'within' : 'under';
  return {
    target,
    min: min ?? null,
    max: max ?? null,
    actual: round1(actual),
    remaining: round1(Math.max(0, target - actual)),
    over: round1(Math.max(0, actual - hi)),
    percent: target > 0 ? Math.round((actual / target) * 100) : 0,
    status,
  };
}
