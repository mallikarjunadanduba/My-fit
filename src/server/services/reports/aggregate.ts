/**
 * Pure aggregation helpers for the dashboard, calendar and weekly/monthly reports.
 * No I/O here — callers load rows from Prisma into `DayRecord`s and pass them in.
 *
 * Rules:
 *  - Missing ≠ zero: a day with no diary entries has `nutrition: null` and is excluded from averages.
 *  - Future days (after "today" in the user's timezone) are planned, never "missed", and never scored.
 */
import { round1, type Nutrients } from '../../../shared/nutrition';

export type DayKind = 'GYM' | 'REST';

/** Subset of NutritionTarget used for scoring (the Prisma model is assignable to this). */
export interface TargetValues {
  calories: number;
  caloriesMin: number | null;
  caloriesMax: number | null;
  protein: number;
  proteinMin: number | null;
  proteinMax: number | null;
  carbs: number;
  carbsMin: number | null;
  carbsMax: number | null;
  fat: number;
  fatMin: number | null;
  fatMax: number | null;
  fiber: number;
  fiberMin: number | null;
  fiberMax: number | null;
  waterMl: number;
  waterMinMl: number | null;
  waterMaxMl: number | null;
}

export interface MealCounts {
  /** Active meal slots planned for the day. */
  planned: number;
  completed: number;
  partial: number;
  skipped: number;
}

export interface WorkoutCounts {
  sessions: number;
  completed: number;
  inProgress: number;
}

export interface RoutineCounts {
  total: number;
  completed: number;
  skipped: number;
}

export interface DayRecord {
  date: string;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  future: boolean;
  dayType: DayKind;
  /** null when nothing was logged in the food diary. */
  nutrition: Nutrients | null;
  /** null when no water entries exist. */
  waterMl: number | null;
  target: TargetValues | null;
  meals: MealCounts;
  workout: WorkoutCounts;
  routine: RoutineCounts;
  /** Last weight recorded that day, if any. */
  weightKg: number | null;
  hasNotes: boolean;
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ───────────────────────────── Calorie range ─────────────────────────────

/** When a target has no explicit min/max, ±10 % of the calorie target counts as "within range". */
export const CALORIE_TOLERANCE = 0.1;

export function calorieBounds(t: Pick<TargetValues, 'calories' | 'caloriesMin' | 'caloriesMax'>) {
  return {
    min: t.caloriesMin ?? round1(t.calories * (1 - CALORIE_TOLERANCE)),
    max: t.caloriesMax ?? round1(t.calories * (1 + CALORIE_TOLERANCE)),
  };
}

export function isWithinCalorieRange(actual: number, t: Pick<TargetValues, 'calories' | 'caloriesMin' | 'caloriesMax'>) {
  const { min, max } = calorieBounds(t);
  return actual >= min && actual <= max;
}

// ───────────────────────────── Completion score ─────────────────────────────

/**
 * Completion score (0–100) = weighted average of the components that apply to the day:
 *
 * | key      | weight | value (0–1)                                                        | applies when                 |
 * |----------|--------|--------------------------------------------------------------------|------------------------------|
 * | meals    | 25     | (completed + 0.5 × partial) / planned meal slots                   | ≥ 1 active meal slot         |
 * | calories | 20     | 1 inside the calorie range; under → actual/min; over → 1 − excess/max (≥ 0); not logged → 0 | a target exists |
 * | protein  | 15     | min(1, protein / (proteinMin ?? protein)); not logged → 0           | a target exists (protein > 0) |
 * | water    | 15     | min(1, water / waterMl target); not logged → 0                     | a target exists (water > 0)  |
 * | workout  | 15     | completed session → 1, in progress → 0.5, else 0                   | GYM day only                 |
 * | routine  | 10     | completed / total routine entries                                  | ≥ 1 routine entry            |
 *
 * score = round(Σ weight × value / Σ weight(applicable) × 100). Future days are not scored (null).
 */
export const SCORE_WEIGHTS = {
  meals: 25,
  calories: 20,
  protein: 15,
  water: 15,
  workout: 15,
  routine: 10,
} as const;

export type ScoreKey = keyof typeof SCORE_WEIGHTS;

export interface ScoreComponent {
  key: ScoreKey;
  label: string;
  weight: number;
  /** 0–1 */
  value: number;
  /** Share of the final score this component contributed (points out of 100). */
  points: number;
  /** Maximum points this component could contribute. */
  maxPoints: number;
  detail: string;
}

export interface CompletionScore {
  score: number;
  components: ScoreComponent[];
}

export type ScoreInput = Pick<DayRecord, 'dayType' | 'nutrition' | 'waterMl' | 'target' | 'meals' | 'workout' | 'routine'>;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function calorieValue(actual: number | null, t: TargetValues): number {
  if (actual == null) return 0;
  const { min, max } = calorieBounds(t);
  if (actual < min) return clamp01(min > 0 ? actual / min : 0);
  if (actual > max) return clamp01(max > 0 ? 1 - (actual - max) / max : 0);
  return 1;
}

export function completionScore(day: ScoreInput): CompletionScore | null {
  const raw: Omit<ScoreComponent, 'points' | 'maxPoints'>[] = [];
  const { meals, target, nutrition } = day;

  if (meals.planned > 0) {
    const value = clamp01((meals.completed + 0.5 * meals.partial) / meals.planned);
    raw.push({
      key: 'meals',
      label: 'Meals completed',
      weight: SCORE_WEIGHTS.meals,
      value,
      detail: `${meals.completed} completed${meals.partial ? `, ${meals.partial} partial` : ''} of ${meals.planned}`,
    });
  }
  if (target && target.calories > 0) {
    const { min, max } = calorieBounds(target);
    raw.push({
      key: 'calories',
      label: 'Calories in range',
      weight: SCORE_WEIGHTS.calories,
      value: calorieValue(nutrition?.calories ?? null, target),
      detail: nutrition ? `${round1(nutrition.calories)} kcal (range ${min}–${max})` : 'No food logged',
    });
  }
  if (target && target.protein > 0) {
    const goal = target.proteinMin ?? target.protein;
    raw.push({
      key: 'protein',
      label: 'Protein goal',
      weight: SCORE_WEIGHTS.protein,
      value: nutrition ? clamp01(goal > 0 ? nutrition.protein / goal : 1) : 0,
      detail: nutrition ? `${round1(nutrition.protein)} g of ${goal} g minimum` : 'No food logged',
    });
  }
  if (target && target.waterMl > 0) {
    raw.push({
      key: 'water',
      label: 'Water',
      weight: SCORE_WEIGHTS.water,
      value: day.waterMl != null ? clamp01(day.waterMl / target.waterMl) : 0,
      detail: day.waterMl != null ? `${day.waterMl} of ${target.waterMl} ml` : 'No water logged',
    });
  }
  if (day.dayType === 'GYM') {
    const w = day.workout;
    raw.push({
      key: 'workout',
      label: 'Workout',
      weight: SCORE_WEIGHTS.workout,
      value: w.completed > 0 ? 1 : w.inProgress > 0 ? 0.5 : 0,
      detail: w.completed > 0 ? 'Completed' : w.inProgress > 0 ? 'In progress' : 'Not done',
    });
  }
  if (day.routine.total > 0) {
    raw.push({
      key: 'routine',
      label: 'Routine',
      weight: SCORE_WEIGHTS.routine,
      value: clamp01(day.routine.completed / day.routine.total),
      detail: `${day.routine.completed} of ${day.routine.total} done`,
    });
  }

  if (raw.length === 0) return null;
  const totalWeight = raw.reduce((s, c) => s + c.weight, 0);
  const components = raw.map((c) => ({
    ...c,
    value: Math.round(c.value * 1000) / 1000,
    points: round1((c.weight * c.value * 100) / totalWeight),
    maxPoints: round1((c.weight * 100) / totalWeight),
  }));
  const score = Math.round((raw.reduce((s, c) => s + c.weight * c.value, 0) / totalWeight) * 100);
  return { score, components };
}

export function dayScore(day: DayRecord): number | null {
  if (day.future) return null;
  return completionScore(day)?.score ?? null;
}

// ───────────────────────────── Per-day series ─────────────────────────────

export interface DaySeriesPoint {
  date: string;
  weekday: number;
  future: boolean;
  dayType: DayKind;
  foodLogged: boolean;
  waterLogged: boolean;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  waterMl: number | null;
  calorieTarget: number | null;
  calorieMin: number | null;
  calorieMax: number | null;
  proteinTarget: number | null;
  waterTarget: number | null;
  workoutCompleted: boolean;
  workoutStatus: 'COMPLETED' | 'IN_PROGRESS' | 'PLANNED' | 'NONE';
  mealAdherence: number | null;
  routinePct: number | null;
  weightKg: number | null;
  score: number | null;
}

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export function mealAdherenceOf(m: MealCounts) {
  return pct(m.completed + 0.5 * m.partial, m.planned);
}

export function toSeriesPoint(day: DayRecord): DaySeriesPoint {
  const n = day.nutrition;
  const bounds = day.target ? calorieBounds(day.target) : null;
  return {
    date: day.date,
    weekday: day.weekday,
    future: day.future,
    dayType: day.dayType,
    foodLogged: n != null,
    waterLogged: day.waterMl != null,
    calories: n ? n.calories : null,
    protein: n ? n.protein : null,
    carbs: n ? n.carbs : null,
    fat: n ? n.fat : null,
    fiber: n ? n.fiber : null,
    waterMl: day.waterMl,
    calorieTarget: day.target?.calories ?? null,
    calorieMin: bounds?.min ?? null,
    calorieMax: bounds?.max ?? null,
    proteinTarget: day.target ? (day.target.proteinMin ?? day.target.protein) : null,
    waterTarget: day.target?.waterMl ?? null,
    workoutCompleted: day.workout.completed > 0,
    workoutStatus: day.workout.completed > 0 ? 'COMPLETED' : day.workout.inProgress > 0 ? 'IN_PROGRESS' : day.workout.sessions > 0 ? 'PLANNED' : 'NONE',
    mealAdherence: day.future ? null : mealAdherenceOf(day.meals),
    routinePct: pct(day.routine.completed, day.routine.total),
    weightKg: day.weightKg,
    score: dayScore(day),
  };
}

// ───────────────────────────── Period summary ─────────────────────────────

export interface PeriodAverages {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  waterMl: number | null;
}

export interface WeekdayConsistency {
  weekday: number;
  label: string;
  averageScore: number;
  days: number;
  rank: number;
}

export interface WeightTrend {
  first: { date: string; weightKg: number } | null;
  last: { date: string; weightKg: number } | null;
  change: number | null;
  series: { date: string; weightKg: number }[];
}

export interface PeriodSummary {
  from: string;
  to: string;
  daysInPeriod: number;
  daysElapsed: number;
  daysWithFoodLogs: number;
  daysWithWaterLogs: number;
  missingLogDates: string[];
  loggedDays: { food: number; water: number };
  averages: PeriodAverages;
  /** Average per-day target in force over the same logged days the averages use. */
  averageTargets: PeriodAverages;
  /** averages ÷ averageTargets × 100 */
  vsTargetPct: PeriodAverages;
  daysWithinCalorieRange: number;
  workoutsCompleted: number;
  plannedGymDays: number;
  gymDaysWithWorkout: number;
  workoutConsistencyPct: number | null;
  mealAdherencePct: number | null;
  routineCompletionPct: number | null;
  averageScore: number | null;
  weight: WeightTrend;
  mostConsistentWeekdays: WeekdayConsistency[];
  series: DaySeriesPoint[];
}

const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const ratio = (a: number | null, b: number | null) => (a != null && b != null && b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export function aggregatePeriod(days: DayRecord[]): PeriodSummary {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const elapsed = sorted.filter((d) => !d.future);
  const food = elapsed.filter((d) => d.nutrition != null);
  const water = elapsed.filter((d) => d.waterMl != null);
  const foodTargeted = food.filter((d) => d.target);
  const waterTargeted = water.filter((d) => d.target);

  const nAvg = (k: keyof Nutrients) => avg(food.map((d) => d.nutrition![k]));
  const averages: PeriodAverages = {
    calories: nAvg('calories'),
    protein: nAvg('protein'),
    carbs: nAvg('carbs'),
    fat: nAvg('fat'),
    fiber: nAvg('fiber'),
    waterMl: water.length ? Math.round(water.reduce((s, d) => s + d.waterMl!, 0) / water.length) : null,
  };
  const tAvg = (k: 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber') => avg(foodTargeted.map((d) => d.target![k]));
  const averageTargets: PeriodAverages = {
    calories: tAvg('calories'),
    protein: tAvg('protein'),
    carbs: tAvg('carbs'),
    fat: tAvg('fat'),
    fiber: tAvg('fiber'),
    waterMl: waterTargeted.length ? Math.round(waterTargeted.reduce((s, d) => s + d.target!.waterMl, 0) / waterTargeted.length) : null,
  };
  // Compare like with like: averages restricted to days that also had a target.
  const nAvgT = (k: keyof Nutrients) => avg(foodTargeted.map((d) => d.nutrition![k]));
  const waterAvgT = waterTargeted.length ? waterTargeted.reduce((s, d) => s + d.waterMl!, 0) / waterTargeted.length : null;
  const vsTargetPct: PeriodAverages = {
    calories: ratio(nAvgT('calories'), averageTargets.calories),
    protein: ratio(nAvgT('protein'), averageTargets.protein),
    carbs: ratio(nAvgT('carbs'), averageTargets.carbs),
    fat: ratio(nAvgT('fat'), averageTargets.fat),
    fiber: ratio(nAvgT('fiber'), averageTargets.fiber),
    waterMl: ratio(waterAvgT, averageTargets.waterMl),
  };

  const gymDays = elapsed.filter((d) => d.dayType === 'GYM');
  const gymDaysWithWorkout = gymDays.filter((d) => d.workout.completed > 0).length;

  const mealPlanned = elapsed.reduce((s, d) => s + d.meals.planned, 0);
  const mealDone = elapsed.reduce((s, d) => s + d.meals.completed + 0.5 * d.meals.partial, 0);
  const routineTotal = elapsed.reduce((s, d) => s + d.routine.total, 0);
  const routineDone = elapsed.reduce((s, d) => s + d.routine.completed, 0);

  const series = sorted.map(toSeriesPoint);
  const scored = series.filter((p) => p.score != null);

  const weightSeries = elapsed.filter((d) => d.weightKg != null).map((d) => ({ date: d.date, weightKg: d.weightKg! }));
  const first = weightSeries[0] ?? null;
  const last = weightSeries.length ? weightSeries[weightSeries.length - 1] : null;

  const byWeekday = new Map<number, number[]>();
  for (const p of scored) {
    const list = byWeekday.get(p.weekday) ?? [];
    list.push(p.score!);
    byWeekday.set(p.weekday, list);
  }
  const mostConsistentWeekdays = [...byWeekday.entries()]
    .map(([weekday, scores]) => ({
      weekday,
      label: WEEKDAY_NAMES[weekday],
      averageScore: avg(scores)!,
      days: scores.length,
    }))
    .sort((a, b) => b.averageScore - a.averageScore || b.days - a.days || a.weekday - b.weekday)
    .map((w, i) => ({ ...w, rank: i + 1 }));

  return {
    from: sorted[0]?.date ?? '',
    to: sorted[sorted.length - 1]?.date ?? '',
    daysInPeriod: sorted.length,
    daysElapsed: elapsed.length,
    daysWithFoodLogs: food.length,
    daysWithWaterLogs: water.length,
    missingLogDates: elapsed.filter((d) => d.nutrition == null).map((d) => d.date),
    loggedDays: { food: food.length, water: water.length },
    averages,
    averageTargets,
    vsTargetPct,
    daysWithinCalorieRange: foodTargeted.filter((d) => isWithinCalorieRange(d.nutrition!.calories, d.target!)).length,
    workoutsCompleted: elapsed.reduce((s, d) => s + d.workout.completed, 0),
    plannedGymDays: gymDays.length,
    gymDaysWithWorkout,
    workoutConsistencyPct: pct(gymDaysWithWorkout, gymDays.length),
    mealAdherencePct: pct(mealDone, mealPlanned),
    routineCompletionPct: pct(routineDone, routineTotal),
    averageScore: avg(scored.map((p) => p.score!)),
    weight: {
      first,
      last,
      change: first && last ? round1(last.weightKg - first.weightKg) : null,
      series: weightSeries,
    },
    mostConsistentWeekdays,
    series,
  };
}
