import { describe, expect, it } from 'vitest';
import {
  aggregatePeriod,
  calorieBounds,
  completionScore,
  isWithinCalorieRange,
  toSeriesPoint,
  type DayRecord,
  type TargetValues,
} from '../../src/server/services/reports/aggregate';
import { weekdayOf } from '../../src/server/lib/dates';

const target = (over: Partial<TargetValues> = {}): TargetValues => ({
  calories: 2000,
  caloriesMin: 1800,
  caloriesMax: 2200,
  protein: 150,
  proteinMin: 140,
  proteinMax: null,
  carbs: 200,
  carbsMin: null,
  carbsMax: null,
  fat: 60,
  fatMin: null,
  fatMax: null,
  fiber: 30,
  fiberMin: null,
  fiberMax: null,
  waterMl: 3000,
  waterMinMl: null,
  waterMaxMl: null,
  ...over,
});

function day(date: string, over: Partial<DayRecord> = {}): DayRecord {
  return {
    date,
    weekday: weekdayOf(date),
    future: false,
    dayType: 'GYM',
    nutrition: null,
    waterMl: null,
    target: target(),
    meals: { planned: 4, completed: 0, partial: 0, skipped: 0 },
    workout: { sessions: 0, completed: 0, inProgress: 0 },
    routine: { total: 0, completed: 0, skipped: 0 },
    weightKg: null,
    hasNotes: false,
    ...over,
  };
}

const food = (calories: number, protein = 100, carbs = 200, fat = 60, fiber = 20) => ({ calories, protein, carbs, fat, fiber });

describe('calorie range', () => {
  it('uses explicit min/max when set', () => {
    expect(calorieBounds(target())).toEqual({ min: 1800, max: 2200 });
    expect(isWithinCalorieRange(1800, target())).toBe(true);
    expect(isWithinCalorieRange(2201, target())).toBe(false);
  });
  it('falls back to ±10 % of the target', () => {
    const t = target({ caloriesMin: null, caloriesMax: null });
    expect(calorieBounds(t)).toEqual({ min: 1800, max: 2200 });
    expect(isWithinCalorieRange(1799, t)).toBe(false);
  });
});

describe('completionScore', () => {
  it('blends only applicable components (no workout on rest days, no routine without entries)', () => {
    const s = completionScore(
      day('2026-10-19', {
        dayType: 'REST',
        nutrition: food(2000, 140),
        waterMl: 3000,
        meals: { planned: 4, completed: 4, partial: 0, skipped: 0 },
      }),
    )!;
    expect(s.components.map((c) => c.key)).toEqual(['meals', 'calories', 'protein', 'water']);
    expect(s.score).toBe(100);
    expect(s.components.reduce((n, c) => n + c.maxPoints, 0)).toBeCloseTo(100, 0);
  });

  it('weights components: meals 25, calories 20, protein 15, water 15, workout 15, routine 10', () => {
    // meals 50% (2 of 4), calories in range (1), protein 70/140 = 0.5, water 1500/3000 = 0.5, workout 0, routine 1/2
    const s = completionScore(
      day('2026-10-19', {
        nutrition: food(2000, 70),
        waterMl: 1500,
        meals: { planned: 4, completed: 1, partial: 2, skipped: 0 },
        routine: { total: 2, completed: 1, skipped: 0 },
      }),
    )!;
    const expected = (25 * 0.5 + 20 * 1 + 15 * 0.5 + 15 * 0.5 + 15 * 0 + 10 * 0.5) / 100;
    expect(s.score).toBe(Math.round(expected * 100));
    expect(s.components.find((c) => c.key === 'workout')!.value).toBe(0);
  });

  it('gives partial credit for in-progress workouts and penalises calorie overshoot', () => {
    const s = completionScore(
      day('2026-10-19', { nutrition: food(2640, 140), waterMl: 3000, workout: { sessions: 1, completed: 0, inProgress: 1 } }),
    )!;
    expect(s.components.find((c) => c.key === 'workout')!.value).toBe(0.5);
    // 2640 is 440 over max 2200 → 1 - 440/2200 = 0.8
    expect(s.components.find((c) => c.key === 'calories')!.value).toBeCloseTo(0.8, 3);
  });

  it('scores an unlogged past day as 0 for food/water and returns null when nothing applies', () => {
    const s = completionScore(day('2026-10-19'))!;
    expect(s.score).toBe(0);
    expect(
      completionScore(day('2026-10-19', { target: null, dayType: 'REST', meals: { planned: 0, completed: 0, partial: 0, skipped: 0 } })),
    ).toBeNull();
  });
});

describe('aggregatePeriod', () => {
  // Week Mon 2026-10-19 … Sun 2026-10-25; pretend "today" is Thu 22nd → Fri–Sun are future.
  const week = (): DayRecord[] => [
    day('2026-10-19', {
      nutrition: food(2000, 150, 220, 70, 30),
      waterMl: 3000,
      meals: { planned: 4, completed: 4, partial: 0, skipped: 0 },
      workout: { sessions: 1, completed: 1, inProgress: 0 },
      routine: { total: 4, completed: 4, skipped: 0 },
      weightKg: 80,
    }),
    day('2026-10-20', {
      // missing food log, water only
      waterMl: 1000,
      meals: { planned: 4, completed: 0, partial: 2, skipped: 1 },
      routine: { total: 4, completed: 2, skipped: 1 },
    }),
    day('2026-10-21', {
      nutrition: food(2600, 110, 300, 90, 10),
      meals: { planned: 4, completed: 2, partial: 0, skipped: 0 },
      workout: { sessions: 1, completed: 1, inProgress: 0 },
      weightKg: 79.4,
      target: target({ calories: 2400, caloriesMin: 2300, caloriesMax: 2700, protein: 160 }),
    }),
    day('2026-10-22', { dayType: 'REST' }),
    day('2026-10-23', { future: true, nutrition: null, workout: { sessions: 1, completed: 0, inProgress: 0 } }),
    day('2026-10-24', { future: true }),
    day('2026-10-25', { future: true, dayType: 'REST' }),
  ];

  it('counts elapsed days and excludes future days from missing logs', () => {
    const r = aggregatePeriod(week());
    expect(r.from).toBe('2026-10-19');
    expect(r.to).toBe('2026-10-25');
    expect(r.daysInPeriod).toBe(7);
    expect(r.daysElapsed).toBe(4);
    expect(r.daysWithFoodLogs).toBe(2);
    expect(r.missingLogDates).toEqual(['2026-10-20', '2026-10-22']);
  });

  it('averages over logged days only (missing ≠ zero)', () => {
    const r = aggregatePeriod(week());
    expect(r.loggedDays).toEqual({ food: 2, water: 2 });
    expect(r.averages.calories).toBe(2300);
    expect(r.averages.protein).toBe(130);
    expect(r.averages.fiber).toBe(20);
    expect(r.averages.waterMl).toBe(2000);
  });

  it('uses the per-day target in force for target comparisons', () => {
    const r = aggregatePeriod(week());
    expect(r.averageTargets.calories).toBe(2200); // (2000 + 2400) / 2
    expect(r.vsTargetPct.calories).toBeCloseTo((2300 / 2200) * 100, 0);
    // Day 1 2000 in [1800,2200]; day 3 2600 in [2300,2700] (would be "over" against the old target).
    expect(r.daysWithinCalorieRange).toBe(2);
  });

  it('computes workout consistency on elapsed gym days only', () => {
    const r = aggregatePeriod(week());
    expect(r.plannedGymDays).toBe(3); // 19, 20, 21 — 22 is rest, 23/24 future
    expect(r.workoutsCompleted).toBe(2);
    expect(r.workoutConsistencyPct).toBeCloseTo(66.7, 1);
  });

  it('computes meal adherence as (completed + 0.5 × partial) / planned on elapsed days', () => {
    const r = aggregatePeriod(week());
    // planned 4 × 4 elapsed days = 16; done 4 + 1 + 2 + 0 = 7
    expect(r.mealAdherencePct).toBeCloseTo((7 / 16) * 100, 1);
  });

  it('computes routine completion and weight trend', () => {
    const r = aggregatePeriod(week());
    expect(r.routineCompletionPct).toBe(75); // 6 / 8
    expect(r.weight.first).toEqual({ date: '2026-10-19', weightKg: 80 });
    expect(r.weight.last).toEqual({ date: '2026-10-21', weightKg: 79.4 });
    expect(r.weight.change).toBe(-0.6);
    expect(r.weight.series).toHaveLength(2);
  });

  it('ranks weekdays by adherence and never scores future days', () => {
    const r = aggregatePeriod(week());
    expect(r.series.filter((p) => p.future).every((p) => p.score == null)).toBe(true);
    expect(r.mostConsistentWeekdays[0].label).toBe('Monday');
    expect(r.mostConsistentWeekdays[0].rank).toBe(1);
    expect(r.mostConsistentWeekdays).toHaveLength(4);
    const scores = r.mostConsistentWeekdays.map((w) => w.averageScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('returns nulls rather than zeros when nothing is logged', () => {
    const r = aggregatePeriod([day('2026-10-19'), day('2026-10-20', { future: true })]);
    expect(r.averages).toEqual({ calories: null, protein: null, carbs: null, fat: null, fiber: null, waterMl: null });
    expect(r.vsTargetPct.calories).toBeNull();
    expect(r.weight.change).toBeNull();
    expect(r.missingLogDates).toEqual(['2026-10-19']);
  });
});

describe('toSeriesPoint', () => {
  it('keeps missing values as null', () => {
    const p = toSeriesPoint(day('2026-10-19'));
    expect(p.foodLogged).toBe(false);
    expect(p.calories).toBeNull();
    expect(p.waterMl).toBeNull();
    expect(p.calorieTarget).toBe(2000);
    expect(p.workoutStatus).toBe('NONE');
  });
});
