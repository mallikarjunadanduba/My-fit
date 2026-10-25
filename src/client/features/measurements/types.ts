export const METRICS = [
  { key: 'weightKg', label: 'Weight', unit: 'kg', min: 20, max: 400, step: '0.1' },
  { key: 'bodyFatPct', label: 'Body fat', unit: '%', min: 2, max: 75, step: '0.1' },
  { key: 'waistCm', label: 'Waist', unit: 'cm', min: 30, max: 250, step: '0.5' },
  { key: 'chestCm', label: 'Chest', unit: 'cm', min: 40, max: 250, step: '0.5' },
  { key: 'hipsCm', label: 'Hips', unit: 'cm', min: 40, max: 250, step: '0.5' },
  { key: 'armCm', label: 'Arm', unit: 'cm', min: 10, max: 100, step: '0.5' },
  { key: 'thighCm', label: 'Thigh', unit: 'cm', min: 20, max: 150, step: '0.5' },
] as const;

export type MetricKey = (typeof METRICS)[number]['key'];

export interface Measurement extends Record<MetricKey, number | null> {
  id: string;
  date: string;
  measuredAt: string;
  notes: string | null;
  photoMediaId: string | null;
  createdAt: string;
}

export interface LatestMeasurements {
  entry: Measurement | null;
  metrics: Record<MetricKey, { value: number; date: string } | null>;
}

export interface WeightTrend {
  from: string;
  to: string;
  points: { date: string; weightKg: number }[];
  first: { date: string; weightKg: number } | null;
  last: { date: string; weightKg: number } | null;
  change: number | null;
  changePct: number | null;
  min: number | null;
  max: number | null;
  average: number | null;
}

export const fmtMetric = (v: number | null | undefined, unit: string) => (v == null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(1)} ${unit}`);
