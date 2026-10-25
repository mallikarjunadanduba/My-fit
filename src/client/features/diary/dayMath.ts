import { sumNutrients, targetProgress, type Nutrients } from '../../../shared/nutrition';
import type { MealPlan, MealStatus, NutrientProgress, NutritionTarget } from '../meals/types';
import type { DiaryDay, DiaryEntry } from './types';

/** GET /api/food-diary?withPlan=true */
export type DiaryWithPlan = DiaryDay & { plan: MealPlan };

const totalsOf = (list: Nutrients[]) => (list.length ? sumNutrients(list) : null);

function progressFor(t: Nutrients, target: NutritionTarget): NutrientProgress {
  return {
    calories: targetProgress(t.calories, target.calories, target.caloriesMin, target.caloriesMax),
    protein: targetProgress(t.protein, target.protein, target.proteinMin, target.proteinMax),
    carbs: targetProgress(t.carbs, target.carbs, target.carbsMin, target.carbsMax),
    fat: targetProgress(t.fat, target.fat, target.fatMin, target.fatMax),
    fiber: targetProgress(t.fiber, target.fiber, target.fiberMin, target.fiberMax),
  };
}

const byTime = (a: DiaryEntry, b: DiaryEntry) => {
  if (a.consumedAt && b.consumedAt && a.consumedAt !== b.consumedAt) return a.consumedAt < b.consumedAt ? -1 : 1;
  if (!a.consumedAt !== !b.consumedAt) return a.consumedAt ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
};

/**
 * Re-derives a diary day locally after a mutation (same rules as the server: missing ≠ zero),
 * so the screen updates from the mutation response instead of refetching everything.
 */
export function withEntries<T extends DiaryDay>(day: T, change: { add?: DiaryEntry[]; remove?: string[]; replace?: DiaryEntry }): T {
  const all = [...day.slots.flatMap((s) => s.entries), ...day.unslotted.entries].filter((e) => !change.remove?.includes(e.id) && e.id !== change.replace?.id);
  if (change.replace && change.replace.date === day.date) all.push(change.replace);
  for (const e of change.add ?? []) if (e.date === day.date) all.push(e);
  all.sort(byTime);

  const slotIds = new Set(day.slots.map((s) => s.slot.id));
  const slots = day.slots.map((s) => {
    const entries = all.filter((e) => e.slotId === s.slot.id);
    return { ...s, entries, totals: totalsOf(entries) };
  });
  const unslotted = all.filter((e) => !e.slotId || !slotIds.has(e.slotId));
  const totals = totalsOf(all);
  return {
    ...day,
    logged: all.length > 0,
    slots,
    unslotted: { entries: unslotted, totals: totalsOf(unslotted) },
    totals,
    progress: totals && day.target ? progressFor(totals, day.target) : null,
  };
}

export function withStatus<T extends DiaryDay>(day: T, slotId: string, status: MealStatus): T {
  return {
    ...day,
    slots: day.slots.map((s) => (s.slot.id === slotId ? { ...s, status } : s)),
  };
}
