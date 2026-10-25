import type { FoodUnit, Nutrients } from '../../../shared/nutrition';
import type { DayType, MealSlot, MealStatus, NutrientProgress, NutritionTarget } from '../meals/types';

export interface DiaryEntry extends Nutrients {
  id: string;
  date: string;
  slotId: string | null;
  foodId: string | null;
  templateItemId: string | null;
  foodName: string;
  brand: string | null;
  quantity: number;
  unit: FoodUnit;
  basis: Nutrients & { servingSize: number; servingUnit: FoodUnit };
  isEstimate: boolean;
  consumedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiarySlotDay {
  slot: MealSlot;
  status: MealStatus;
  statusNotes: string | null;
  completedAt: string | null;
  templateId: string | null;
  entries: DiaryEntry[];
  totals: Nutrients | null;
}

/** GET /api/food-diary?date= */
export interface DiaryDay {
  date: string;
  dayType: Exclude<DayType, 'ANY'>;
  logged: boolean;
  slots: DiarySlotDay[];
  unslotted: { entries: DiaryEntry[]; totals: Nutrients | null };
  totals: Nutrients | null;
  target: NutritionTarget | null;
  progress: NutrientProgress | null;
}
