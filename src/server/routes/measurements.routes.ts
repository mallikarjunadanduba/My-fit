import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { badRequest, created, idParam, noContent, ok, paginationQuery, parseBody, parseParams, parseQuery } from '../lib/http';
import { addDays, dateRangeQuery, dateString, todayIn } from '../lib/dates';
import {
  createMeasurement,
  deleteMeasurement,
  latestMeasurements,
  listMeasurements,
  updateMeasurement,
  weightTrend,
} from '../services/measurements.service';

const router = Router();

/** Sane human ranges; values outside are almost certainly typos (e.g. lb entered as kg ×10). */
const metric = (min: number, max: number, label: string) =>
  z.number().min(min, `${label} must be at least ${min}`).max(max, `${label} must be at most ${max}`).nullable().optional();

const values = {
  weightKg: metric(20, 400, 'Weight (kg)'),
  bodyFatPct: metric(2, 75, 'Body fat %'),
  waistCm: metric(30, 250, 'Waist (cm)'),
  chestCm: metric(40, 250, 'Chest (cm)'),
  hipsCm: metric(40, 250, 'Hips (cm)'),
  armCm: metric(10, 100, 'Arm (cm)'),
  thighCm: metric(20, 150, 'Thigh (cm)'),
  notes: z
    .string()
    .trim()
    .max(1000)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v)),
  photoMediaId: z.string().uuid().nullable().optional(),
  measuredAt: z
    .string()
    .datetime({ offset: true })
    .transform((s) => new Date(s))
    .optional(),
};

router.get('/', async (req, res) => {
  const q = parseQuery(req, paginationQuery.extend({ from: dateString.optional(), to: dateString.optional() }));
  if (q.from && q.to && q.from > q.to) throw badRequest('from must be on or before to');
  const { data, meta } = await listMeasurements(auth(req).userId, q);
  ok(res, data, meta);
});

router.get('/latest', async (req, res) => {
  ok(res, await latestMeasurements(auth(req).userId));
});

router.get('/trend', async (req, res) => {
  const a = auth(req);
  const q = parseQuery(req, z.object({ from: dateString.optional(), to: dateString.optional() }));
  const to = q.to ?? todayIn(a.timezone);
  const from = q.from ?? addDays(to, -89);
  const range = dateRangeQuery.safeParse({ from, to });
  if (!range.success) throw badRequest(range.error.issues[0]?.message ?? 'Invalid range');
  ok(res, await weightTrend(a.userId, from, to));
});

router.post('/', async (req, res) => {
  const body = parseBody(req, z.object({ date: dateString, ...values }).strict());
  created(res, await createMeasurement(auth(req).userId, body));
});

router.patch('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(
    req,
    z
      .object({ date: dateString.optional(), ...values })
      .strict()
      .refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
  );
  ok(res, await updateMeasurement(auth(req).userId, id, body));
});

router.delete('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await deleteMeasurement(auth(req).userId, id);
  noContent(res);
});

export default router;
