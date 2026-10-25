import { describe, expect, it } from 'vitest';
import {
  UnitMismatchError,
  allowedUnits,
  caloriesFromMacros,
  nutrientsFor,
  servingFactor,
  sumNutrients,
  targetProgress,
} from './nutrition';

const oats = { servingSize: 40, servingUnit: 'G' as const, calories: 150, protein: 5.3, carbs: 27, fat: 2.6, fiber: 4 };

describe('servingFactor', () => {
  it('scales by serving size for matching units', () => {
    expect(servingFactor(80, 'G', 40, 'G')).toBe(2);
    expect(servingFactor(20, 'G', 40, 'G')).toBe(0.5);
  });
  it('treats SERVING as a count of servings', () => {
    expect(servingFactor(1.5, 'SERVING', 40, 'G')).toBe(1.5);
  });
  it('rejects unconvertible units', () => {
    expect(() => servingFactor(1, 'ML', 40, 'G')).toThrow(UnitMismatchError);
    expect(() => servingFactor(1, 'PIECE', 1, 'SCOOP')).toThrow(UnitMismatchError);
  });
  it('rejects invalid numbers', () => {
    expect(() => servingFactor(-1, 'G', 40, 'G')).toThrow(RangeError);
    expect(() => servingFactor(1, 'G', 0, 'G')).toThrow(RangeError);
    expect(() => servingFactor(Number.NaN, 'G', 40, 'G')).toThrow(RangeError);
  });
  it('lists allowed units', () => {
    expect(allowedUnits('G')).toEqual(['G', 'SERVING']);
    expect(allowedUnits('SERVING')).toEqual(['SERVING']);
  });
});

describe('nutrientsFor', () => {
  it('calculates proportional nutrition rounded to 0.1', () => {
    expect(nutrientsFor(oats, 60, 'G')).toEqual({ calories: 225, protein: 8, carbs: 40.5, fat: 3.9, fiber: 6 });
  });
  it('returns zeros for zero quantity', () => {
    expect(nutrientsFor(oats, 0, 'G')).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  });
});

describe('sumNutrients', () => {
  it('adds entries and avoids float drift', () => {
    expect(sumNutrients([{ calories: 0.1, protein: 0.2 }, { calories: 0.2, protein: 0.1 }])).toEqual({
      calories: 0.3,
      protein: 0.3,
      carbs: 0,
      fat: 0,
      fiber: 0,
    });
  });
});

describe('targetProgress', () => {
  it('reports remaining and within-range status', () => {
    const p = targetProgress(1880, 1900, 1850, 1950);
    expect(p).toMatchObject({ remaining: 20, over: 0, status: 'within', percent: 99 });
  });
  it('reports under target', () => {
    expect(targetProgress(100, 160).status).toBe('under');
    expect(targetProgress(100, 160).remaining).toBe(60);
  });
  it('flags exceeding the upper bound', () => {
    const p = targetProgress(2000, 1900, 1850, 1950);
    expect(p).toMatchObject({ status: 'over', remaining: 0, over: 50, percent: 105 });
  });
  it('uses the target as the bound when no range is set', () => {
    expect(targetProgress(161, 160).status).toBe('over');
    expect(targetProgress(160, 160).status).toBe('within');
  });
  it('handles a zero target without dividing by zero', () => {
    expect(targetProgress(5, 0).percent).toBe(0);
  });
});

describe('caloriesFromMacros', () => {
  it('uses 4/4/9 and ignores fiber', () => {
    expect(caloriesFromMacros({ protein: 160, carbs: 160, fat: 60 })).toBe(1820);
  });
});
