import { prisma } from '../db';
import { addDays, fromDbDate, toDbDate, zonedToUtc } from '../lib/dates';
import type { UserCtx } from './reports/daySnapshot';

export const EXPORT_DATASETS = ['diary', 'water', 'workouts', 'measurements', 'routine', 'reminders', 'targets', 'foods'] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];

type Cell = string | number | boolean | null | undefined | Date;
export type Row = Record<string, Cell>;

// ───────────────────────────── CSV ─────────────────────────────

const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Formats one CSV cell (RFC 4180):
 *  - strings that start with = + - @ (or tab/CR) are prefixed with ' so spreadsheets never evaluate them;
 *  - cells containing a quote, comma, CR or LF (or leading/trailing spaces) are quoted, quotes doubled.
 * Numbers and booleans are written as-is (negative numbers are values, not formulas).
 */
export function csvCell(value: Cell): string {
  if (value == null) return '';
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  else if (typeof value === 'boolean') return value ? 'true' : 'false';
  else {
    s = String(value);
    if (FORMULA_START.test(s)) s = `'${s}`;
  }
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(columns: string[], rows: Row[]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

// ───────────────────────────── Datasets ─────────────────────────────

interface Range {
  from: string;
  to: string;
}

interface DatasetDef {
  columns: string[];
  load: (ctx: UserCtx, r: Range) => Promise<Row[]>;
}

const dbRange = (r: Range) => ({ gte: toDbDate(r.from), lte: toDbDate(r.to) });

const DATASETS: Record<ExportDataset, DatasetDef> = {
  diary: {
    columns: ['date', 'meal', 'food', 'brand', 'quantity', 'unit', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'estimate', 'consumed_at', 'notes'],
    load: async (ctx, r) => {
      const rows = await prisma.foodDiaryEntry.findMany({
        where: { userId: ctx.userId, date: dbRange(r) },
        orderBy: [{ date: 'asc' }, { consumedAt: 'asc' }, { createdAt: 'asc' }],
        include: { slot: { select: { name: true } } },
      });
      return rows.map((e) => ({
        date: fromDbDate(e.date),
        meal: e.slot?.name ?? null,
        food: e.foodName,
        brand: e.brand,
        quantity: e.quantity,
        unit: e.unit,
        calories: e.calories,
        protein_g: e.protein,
        carbs_g: e.carbs,
        fat_g: e.fat,
        fiber_g: e.fiber,
        estimate: e.isEstimate,
        consumed_at: e.consumedAt,
        notes: e.notes,
      }));
    },
  },
  water: {
    columns: ['date', 'amount_ml', 'logged_at', 'note'],
    load: async (ctx, r) => {
      const rows = await prisma.waterEntry.findMany({ where: { userId: ctx.userId, date: dbRange(r) }, orderBy: [{ date: 'asc' }, { loggedAt: 'asc' }] });
      return rows.map((w) => ({ date: fromDbDate(w.date), amount_ml: w.amountMl, logged_at: w.loggedAt, note: w.note }));
    },
  },
  workouts: {
    columns: ['date', 'session', 'session_status', 'started_at', 'finished_at', 'exercise', 'exercise_status', 'set_number', 'reps', 'weight_kg', 'duration_sec', 'set_completed', 'notes'],
    load: async (ctx, r) => {
      const sessions = await prisma.workoutSession.findMany({
        where: { userId: ctx.userId, date: dbRange(r) },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
        include: { entries: { orderBy: { sortOrder: 'asc' }, include: { sets: { orderBy: { setNumber: 'asc' } } } } },
      });
      const out: Row[] = [];
      for (const s of sessions) {
        const base = { date: fromDbDate(s.date), session: s.name, session_status: s.status, started_at: s.startedAt, finished_at: s.finishedAt };
        if (!s.entries.length) out.push({ ...base, notes: s.notes });
        for (const e of s.entries) {
          if (!e.sets.length) out.push({ ...base, exercise: e.exerciseName, exercise_status: e.status, notes: e.notes });
          for (const set of e.sets) {
            out.push({
              ...base,
              exercise: e.exerciseName,
              exercise_status: e.status,
              set_number: set.setNumber,
              reps: set.reps,
              weight_kg: set.weightKg,
              duration_sec: set.durationSec,
              set_completed: set.completed,
              notes: e.notes,
            });
          }
        }
      }
      return out;
    },
  },
  measurements: {
    columns: ['date', 'measured_at', 'weight_kg', 'body_fat_pct', 'waist_cm', 'chest_cm', 'hips_cm', 'arm_cm', 'thigh_cm', 'notes'],
    load: async (ctx, r) => {
      const rows = await prisma.bodyMeasurement.findMany({ where: { userId: ctx.userId, date: dbRange(r) }, orderBy: [{ date: 'asc' }, { measuredAt: 'asc' }] });
      return rows.map((m) => ({
        date: fromDbDate(m.date),
        measured_at: m.measuredAt,
        weight_kg: m.weightKg,
        body_fat_pct: m.bodyFatPct,
        waist_cm: m.waistCm,
        chest_cm: m.chestCm,
        hips_cm: m.hipsCm,
        arm_cm: m.armCm,
        thigh_cm: m.thighCm,
        notes: m.notes,
      }));
    },
  },
  routine: {
    columns: ['date', 'scheduled_time', 'title', 'category', 'status', 'completed_at', 'skip_reason', 'notes'],
    load: async (ctx, r) => {
      const rows = await prisma.dailyRoutineEntry.findMany({
        where: { userId: ctx.userId, date: dbRange(r) },
        orderBy: [{ date: 'asc' }, { scheduledAt: 'asc' }, { sortOrder: 'asc' }],
      });
      return rows.map((e) => ({
        date: fromDbDate(e.date),
        scheduled_time: e.scheduledTime,
        title: e.title,
        category: e.category,
        status: e.status,
        completed_at: e.completedAt,
        skip_reason: e.skipReason,
        notes: e.notes,
      }));
    },
  },
  reminders: {
    columns: ['scheduled_for', 'reminder', 'category', 'status', 'fired_at', 'acted_at', 'snoozed_until'],
    load: async (ctx, r) => {
      const rows = await prisma.reminderOccurrence.findMany({
        where: {
          userId: ctx.userId,
          scheduledFor: { gte: zonedToUtc(r.from, '00:00', ctx.timezone), lt: zonedToUtc(addDays(r.to, 1), '00:00', ctx.timezone) },
        },
        orderBy: { scheduledFor: 'asc' },
        include: { reminder: { select: { title: true, category: true } } },
      });
      return rows.map((o) => ({
        scheduled_for: o.scheduledFor,
        reminder: o.reminder.title,
        category: o.reminder.category,
        status: o.status,
        fired_at: o.firedAt,
        acted_at: o.actedAt,
        snoozed_until: o.snoozedUntil,
      }));
    },
  },
  targets: {
    columns: [
      'effective_from', 'calories', 'calories_min', 'calories_max', 'protein_g', 'protein_min', 'protein_max', 'carbs_g', 'carbs_min', 'carbs_max',
      'fat_g', 'fat_min', 'fat_max', 'fiber_g', 'fiber_min', 'fiber_max', 'water_ml', 'water_min_ml', 'water_max_ml', 'notes',
    ],
    // Targets are versioned: include every version that was in force at some point up to `to`.
    load: async (ctx, r) => {
      const rows = await prisma.nutritionTarget.findMany({ where: { userId: ctx.userId, effectiveFrom: { lte: toDbDate(r.to) } }, orderBy: { effectiveFrom: 'asc' } });
      return rows.map((t) => ({
        effective_from: fromDbDate(t.effectiveFrom),
        calories: t.calories,
        calories_min: t.caloriesMin,
        calories_max: t.caloriesMax,
        protein_g: t.protein,
        protein_min: t.proteinMin,
        protein_max: t.proteinMax,
        carbs_g: t.carbs,
        carbs_min: t.carbsMin,
        carbs_max: t.carbsMax,
        fat_g: t.fat,
        fat_min: t.fatMin,
        fat_max: t.fatMax,
        fiber_g: t.fiber,
        fiber_min: t.fiberMin,
        fiber_max: t.fiberMax,
        water_ml: t.waterMl,
        water_min_ml: t.waterMinMl,
        water_max_ml: t.waterMaxMl,
        notes: t.notes,
      }));
    },
  },
  foods: {
    columns: ['name', 'brand', 'preparation', 'serving_size', 'serving_unit', 'serving_label', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'estimate', 'source', 'favorite', 'archived', 'categories', 'notes'],
    // The food library is not date-scoped.
    load: async (ctx) => {
      const rows = await prisma.foodItem.findMany({
        where: { userId: ctx.userId },
        orderBy: { name: 'asc' },
        include: { categories: { include: { category: { select: { name: true } } } } },
      });
      return rows.map((f) => ({
        name: f.name,
        brand: f.brand,
        preparation: f.preparation,
        serving_size: f.servingSize,
        serving_unit: f.servingUnit,
        serving_label: f.servingLabel,
        calories: f.calories,
        protein_g: f.protein,
        carbs_g: f.carbs,
        fat_g: f.fat,
        fiber_g: f.fiber,
        estimate: f.isEstimate,
        source: f.source,
        favorite: f.isFavorite,
        archived: f.archivedAt != null,
        categories: f.categories.map((c) => c.category.name).join('; ') || null,
        notes: f.notes,
      }));
    },
  },
};

export interface ExportFile {
  filename: string;
  contentType: string;
  body: string;
}

export function exportFilename(dataset: string, from: string, to: string, ext: 'csv' | 'json') {
  return `myfit-${dataset}-${from}-to-${to}.${ext}`;
}

export async function buildExport(
  ctx: UserCtx,
  opts: { format: 'csv' | 'json'; dataset: ExportDataset | 'all'; from: string; to: string },
  now: Date = new Date(),
): Promise<ExportFile> {
  const range = { from: opts.from, to: opts.to };
  const filename = exportFilename(opts.dataset, opts.from, opts.to, opts.format);
  if (opts.format === 'csv') {
    if (opts.dataset === 'all') throw new Error('CSV export requires a single dataset');
    const def = DATASETS[opts.dataset];
    return { filename, contentType: 'text/csv; charset=utf-8', body: toCsv(def.columns, await def.load(ctx, range)) };
  }
  const names = opts.dataset === 'all' ? [...EXPORT_DATASETS] : [opts.dataset];
  const loaded = await Promise.all(names.map(async (n) => [n, await DATASETS[n].load(ctx, range)] as const));
  const body: Record<string, unknown> = {
    meta: { app: 'MyFit Routine', exportedAt: now.toISOString(), from: opts.from, to: opts.to, timezone: ctx.timezone, datasets: names },
  };
  for (const [n, rows] of loaded) body[n] = rows;
  return { filename, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body, null, 2) };
}
