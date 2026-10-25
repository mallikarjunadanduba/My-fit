import type { FoodUnit } from '../../../shared/nutrition';
import type { MealTemplate, TemplateItem } from './types';

/** Request shape for template items (POST/PATCH /api/meals/templates). */
export interface ItemInput {
  foodId: string | null;
  customName: string | null;
  quantity: number;
  quantityMax: number | null;
  unit: FoodUnit;
  notes: string | null;
  isOptional?: boolean;
  alternatives?: Omit<ItemInput, 'alternatives' | 'isOptional'>[];
}

const base = (i: TemplateItem) => ({
  foodId: i.foodId,
  customName: i.foodId ? null : (i.customName ?? i.displayName),
  quantity: i.quantity,
  quantityMax: i.quantityMax,
  unit: i.unit,
  notes: i.notes,
});

/** Converts a fetched template's items back into the input shape (for append/replace edits). */
export function templateItemsToInput(t: MealTemplate): ItemInput[] {
  return t.items.map((i) => ({
    ...base(i),
    isOptional: i.isOptional,
    alternatives: i.alternatives.map(base),
  }));
}
