import { Prisma, type BodyMeasurement } from '@prisma/client';
import { prisma } from '../db';
import { badRequest, notFound, pageMeta } from '../lib/http';
import { fromDbDate, toDbDate } from '../lib/dates';
import { assertOwnedMedia } from './media.service';

export const METRIC_FIELDS = ['weightKg', 'bodyFatPct', 'waistCm', 'chestCm', 'hipsCm', 'armCm', 'thighCm'] as const;
export type MetricField = (typeof METRIC_FIELDS)[number];

export type MeasurementValues = Partial<Record<MetricField, number | null>> & {
  notes?: string | null;
  photoMediaId?: string | null;
};
export type MeasurementInput = MeasurementValues & { date: string; measuredAt?: Date };

export function serializeMeasurement(m: BodyMeasurement) {
  return {
    id: m.id,
    date: fromDbDate(m.date),
    measuredAt: m.measuredAt.toISOString(),
    weightKg: m.weightKg,
    bodyFatPct: m.bodyFatPct,
    waistCm: m.waistCm,
    chestCm: m.chestCm,
    hipsCm: m.hipsCm,
    armCm: m.armCm,
    thighCm: m.thighCm,
    notes: m.notes,
    photoMediaId: m.photoMediaId,
    createdAt: m.createdAt.toISOString(),
  };
}

function hasContent(v: MeasurementValues): boolean {
  return METRIC_FIELDS.some((f) => v[f] != null) || !!v.photoMediaId;
}

async function owned(userId: string, id: string) {
  const m = await prisma.bodyMeasurement.findFirst({ where: { id, userId } });
  if (!m) throw notFound('Measurement');
  return m;
}

const NEED_VALUE = 'Enter at least one measurement or attach a progress photo.';

export async function listMeasurements(userId: string, q: { from?: string; to?: string; page: number; pageSize: number }) {
  const where: Prisma.BodyMeasurementWhereInput = {
    userId,
    ...(q.from || q.to ? { date: { ...(q.from ? { gte: toDbDate(q.from) } : {}), ...(q.to ? { lte: toDbDate(q.to) } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.bodyMeasurement.findMany({
      where,
      orderBy: [{ date: 'desc' }, { measuredAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.bodyMeasurement.count({ where }),
  ]);
  return { data: rows.map(serializeMeasurement), meta: pageMeta(q.page, q.pageSize, total) };
}

/**
 * Latest entry plus the most recent value of each metric (they may come from different entries).
 * One statement: the latest row via LATERAL plus one scalar subquery per metric.
 */
export async function latestMeasurements(userId: string) {
  // Column names come from the fixed METRIC_FIELDS whitelist, never from input.
  const perMetric = Prisma.join(
    METRIC_FIELDS.map(
      (f) => Prisma.sql`(SELECT json_build_object('value', b.${Prisma.raw(`"${f}"`)}, 'date', to_char(b.date, 'YYYY-MM-DD'))
        FROM "BodyMeasurement" b WHERE b."userId" = ${userId}::uuid AND b.${Prisma.raw(`"${f}"`)} IS NOT NULL
        ORDER BY b.date DESC, b."measuredAt" DESC LIMIT 1) AS ${Prisma.raw(`"m_${f}"`)}`,
    ),
  );
  const [row] = await prisma.$queryRaw<(Partial<BodyMeasurement> & Record<string, unknown>)[]>`
    SELECT m.*, ${perMetric}
    FROM (SELECT 1) one
    LEFT JOIN LATERAL (
      SELECT * FROM "BodyMeasurement" WHERE "userId" = ${userId}::uuid ORDER BY date DESC, "measuredAt" DESC LIMIT 1
    ) m ON true`;
  const metrics = Object.fromEntries(
    METRIC_FIELDS.map((f) => {
      const v = row?.[`m_${f}`] as { value: number | null; date: string } | null | undefined;
      return [f, v && v.value != null ? { value: Number(v.value), date: v.date } : null];
    }),
  ) as Record<MetricField, { value: number; date: string } | null>;
  return { entry: row?.id ? serializeMeasurement(row as BodyMeasurement) : null, metrics };
}

export async function createMeasurement(userId: string, input: MeasurementInput) {
  if (!hasContent(input)) throw badRequest(NEED_VALUE);
  if (input.photoMediaId) await assertOwnedMedia(userId, input.photoMediaId);
  const { date, ...rest } = input;
  const m = await prisma.bodyMeasurement.create({ data: { ...rest, userId, date: toDbDate(date) } });
  return serializeMeasurement(m);
}

export async function updateMeasurement(userId: string, id: string, patch: Partial<MeasurementInput>) {
  // Ownership + photo checks in parallel, then one UPDATE (2 round trips).
  const [current, photo] = await Promise.all([
    owned(userId, id),
    patch.photoMediaId ? assertOwnedMedia(userId, patch.photoMediaId).catch((e: unknown) => e as Error) : null,
  ]);
  if (photo instanceof Error) throw photo;
  const merged = { ...current, ...patch };
  if (!hasContent(merged)) throw badRequest(NEED_VALUE);
  const { date, ...rest } = patch;
  const m = await prisma.bodyMeasurement.update({ where: { id }, data: { ...rest, ...(date ? { date: toDbDate(date) } : {}) } });
  return serializeMeasurement(m);
}

/** The linked progress photo is NOT deleted (it can be removed separately via DELETE /api/media/:id). */
export async function deleteMeasurement(userId: string, id: string) {
  const { count } = await prisma.bodyMeasurement.deleteMany({ where: { id, userId } });
  if (!count) throw notFound('Measurement');
}

export interface TrendPoint {
  date: string;
  weightKg: number;
}

/** Pure: one point per day (the last reading of the day), plus summary stats. Points must be sorted by date then time. */
export function summarizeWeightTrend(readings: { date: string; weightKg: number }[]) {
  const byDay = new Map<string, number>();
  for (const r of readings) byDay.set(r.date, r.weightKg);
  const points: TrendPoint[] = [...byDay.entries()].map(([date, weightKg]) => ({ date, weightKg }));
  if (points.length === 0) return { points, first: null, last: null, change: null, changePct: null, min: null, max: null, average: null };
  const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
  const first = points[0];
  const last = points[points.length - 1];
  const weights = points.map((p) => p.weightKg);
  return {
    points,
    first,
    last,
    change: round(last.weightKg - first.weightKg),
    changePct: first.weightKg > 0 ? round(((last.weightKg - first.weightKg) / first.weightKg) * 100) : null,
    min: Math.min(...weights),
    max: Math.max(...weights),
    average: round(weights.reduce((a, b) => a + b, 0) / weights.length),
  };
}

export async function weightTrend(userId: string, from: string, to: string) {
  const rows = await prisma.bodyMeasurement.findMany({
    where: { userId, weightKg: { not: null }, date: { gte: toDbDate(from), lte: toDbDate(to) } },
    orderBy: [{ date: 'asc' }, { measuredAt: 'asc' }],
    select: { date: true, weightKg: true },
  });
  return { from, to, ...summarizeWeightTrend(rows.map((r) => ({ date: fromDbDate(r.date), weightKg: r.weightKg as number }))) };
}
