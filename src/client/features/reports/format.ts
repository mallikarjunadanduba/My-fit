import type { MealDayStatus, SessionStatus, WorkoutDayStatus } from './types';
import { brand } from '../../theme/theme';

/** Number formatter: integers with separators, otherwise one decimal. `null` → em dash. */
export const fmt = (n: number | null | undefined, digits = 1) => {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number.isInteger(n)
    ? n.toLocaleString()
    : n.toLocaleString(undefined, {
        maximumFractionDigits: digits,
        minimumFractionDigits: 0,
      });
};

export const fmtPct = (n: number | null | undefined) => (n == null ? '—' : `${Math.round(n)}%`);

export const fmtMl = (ml: number | null | undefined) => {
  if (ml == null) return '—';
  return ml >= 1000 ? `${(ml / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })} L` : `${ml} ml`;
};

/** Colour for a 0–100 adherence score (status palette; always paired with a number/label). */
export function scoreColor(score: number | null | undefined) {
  if (score == null) return 'transparent';
  if (score >= 80) return brand.success;
  if (score >= 50) return brand.warning;
  return brand.error;
}

export function scoreLabel(score: number | null | undefined) {
  if (score == null) return 'No score';
  if (score >= 80) return 'Great';
  if (score >= 50) return 'Fair';
  return 'Low';
}

type ChipColor = 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary';

export const MEAL_STATUS: Record<MealDayStatus, { label: string; color: ChipColor }> = {
  COMPLETED: { label: 'Completed', color: 'success' },
  PARTIAL: { label: 'Partial', color: 'warning' },
  SKIPPED: { label: 'Skipped', color: 'error' },
  LOGGED: { label: 'Logged', color: 'info' },
  PENDING: { label: 'Pending', color: 'default' },
  NOT_LOGGED: { label: 'Not logged', color: 'default' },
};

export const SESSION_STATUS: Record<SessionStatus, { label: string; color: ChipColor }> = {
  COMPLETED: { label: 'Completed', color: 'success' },
  IN_PROGRESS: { label: 'In progress', color: 'warning' },
  PLANNED: { label: 'Planned', color: 'info' },
  SKIPPED: { label: 'Skipped', color: 'error' },
};

export const WORKOUT_DAY_STATUS: Record<WorkoutDayStatus, string> = {
  COMPLETED: 'Workout completed',
  IN_PROGRESS: 'Workout in progress',
  PLANNED: 'Workout planned',
  NONE: 'No workout',
};

export const STATUS_CHIP: Record<string, ChipColor> = {
  COMPLETED: 'success',
  SKIPPED: 'error',
  MISSED: 'error',
  DISMISSED: 'default',
  SNOOZED: 'warning',
  SENT: 'info',
  PENDING: 'default',
  IN_PROGRESS: 'warning',
  PLANNED: 'info',
};

export const titleCase = (s: string) => s.toLowerCase().replace(/(^|_)(\w)/g, (_m, sep: string, c: string) => (sep ? ' ' : '') + c.toUpperCase());
