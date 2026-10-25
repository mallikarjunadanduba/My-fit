import type { FoodUnit, Nutrients, TargetProgress } from '../../../shared/nutrition';

export type DayType = 'ANY' | 'GYM' | 'REST';
export type MealStatus = 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'SKIPPED';

export interface MealSlot {
  id: string;
  key: string;
  name: string;
  defaultTime: string | null;
  sortOrder: number;
  archivedAt: string | null;
}

export interface TemplateFood extends Nutrients {
  id: string;
  name: string;
  brand: string | null;
  servingSize: number;
  servingUnit: FoodUnit;
  servingLabel: string | null;
  isEstimate: boolean;
  archivedAt: string | null;
}

export interface TemplateItem {
  id: string;
  foodId: string | null;
  food: TemplateFood | null;
  customName: string | null;
  displayName: string;
  quantity: number;
  quantityMax: number | null;
  unit: FoodUnit;
  isOptional: boolean;
  alternativeOfId: string | null;
  sortOrder: number;
  notes: string | null;
  nutrition: Nutrients | null;
  nutritionMax: Nutrients | null;
  unitError: string | null;
}

export interface MealTemplate {
  id: string;
  slotId: string | null;
  name: string;
  dayType: DayType;
  isPlan: boolean;
  notes: string | null;
  preparation: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: (TemplateItem & { alternatives: TemplateItem[] })[];
  planned: { min: Nutrients; max: Nutrients };
}

export interface NutritionTarget extends Nutrients {
  id: string;
  effectiveFrom: string;
  caloriesMin: number | null;
  caloriesMax: number | null;
  proteinMin: number | null;
  proteinMax: number | null;
  carbsMin: number | null;
  carbsMax: number | null;
  fatMin: number | null;
  fatMax: number | null;
  fiberMin: number | null;
  fiberMax: number | null;
  waterMl: number;
  waterMinMl: number | null;
  waterMaxMl: number | null;
}

export type NutrientProgress = Record<keyof Nutrients, TargetProgress>;

/** GET /api/meals/plan */
export interface MealPlan {
  date: string | null;
  dayType: DayType;
  slots: {
    slot: MealSlot;
    template: MealTemplate | null;
    inherited: boolean;
    planned: { min: Nutrients; max: Nutrients } | null;
    status: MealStatus | null;
    statusNotes: string | null;
    completedAt: string | null;
  }[];
  totals: { min: Nutrients; max: Nutrients } | null;
  target: NutritionTarget | null;
  progress: NutrientProgress | null;
}

export const DAY_TYPE_LABELS: Record<DayType, string> = {
  GYM: 'Gym day',
  REST: 'Rest day',
  ANY: 'Any day',
};

export const STATUS_META: Record<MealStatus, { label: string; color: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  PENDING: { label: 'Pending', color: 'default' },
  COMPLETED: { label: 'Completed', color: 'success' },
  PARTIAL: { label: 'Partial', color: 'warning' },
  SKIPPED: { label: 'Skipped', color: 'error' },
};
