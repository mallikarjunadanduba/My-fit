import { targetProgress, type TargetProgress } from '../../../shared/nutrition';

export interface WaterEntry {
  id: string;
  date: string;
  amountMl: number;
  loggedAt: string;
  note: string | null;
  createdAt: string;
}

/** GET /api/water?date= */
export interface WaterDay {
  date: string;
  entries: WaterEntry[];
  logged: boolean;
  totalMl: number | null;
  targetMl: number | null;
  minMl: number | null;
  maxMl: number | null;
  remainingMl: number | null;
  overMax: boolean;
  progress: TargetProgress | null;
}

/** GET /api/water/range */
export interface WaterRange {
  from: string;
  to: string;
  days: {
    date: string;
    logged: boolean;
    entryCount: number;
    totalMl: number | null;
    targetMl: number | null;
    maxMl: number | null;
  }[];
}

export const fmtMl = (ml: number) => (ml >= 1000 ? `${parseFloat((ml / 1000).toFixed(2))} L` : `${ml} ml`);

/** GET /api/water?date=&historyDays= — the day plus the chart history in one response. */
export type WaterDayWithHistory = WaterDay & { history?: WaterRange };

/** Re-derives the day's totals (and today's bar in the history) after adding/removing entries locally. */
export function withWaterEntries<T extends WaterDayWithHistory>(day: T, entries: WaterEntry[]): T {
  const logged = entries.length > 0;
  const totalMl = logged ? entries.reduce((s, e) => s + e.amountMl, 0) : null;
  const t = day.targetMl;
  return {
    ...day,
    entries: [...entries].sort((a, b) => (a.loggedAt < b.loggedAt ? -1 : a.loggedAt > b.loggedAt ? 1 : 0)),
    logged,
    totalMl,
    remainingMl: t != null ? Math.max(0, t - (totalMl ?? 0)) : null,
    overMax: day.maxMl != null && totalMl != null && totalMl > day.maxMl,
    progress: t != null && totalMl != null ? targetProgress(totalMl, t, day.minMl, day.maxMl) : null,
    history: day.history && {
      ...day.history,
      days: day.history.days.map((d) => (d.date === day.date ? { ...d, logged, entryCount: entries.length, totalMl } : d)),
    },
  };
}
