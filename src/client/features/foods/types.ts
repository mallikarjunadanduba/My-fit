import type { FoodUnit, Nutrients } from '../../../shared/nutrition';

export type FoodSource = 'SEED' | 'CUSTOM' | 'LABEL';

export interface FoodCategory {
  id: string;
  name: string;
  slug: string;
  isSystem: boolean;
  sortOrder: number;
  foodCount?: number;
}

/** Shape of GET /api/foods items. Nutrition is per one serving (servingSize × servingUnit). */
export interface Food extends Nutrients {
  id: string;
  name: string;
  brand: string | null;
  preparation: string | null;
  notes: string | null;
  servingSize: number;
  servingUnit: FoodUnit;
  servingLabel: string | null;
  isEstimate: boolean;
  source: FoodSource;
  isFavorite: boolean;
  imageMediaId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  categories: FoodCategory[];
}

export type FoodSort = 'name' | 'protein' | 'fiber' | 'calories' | 'recent';
