import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { addDays, dateString, todayIn, toDbDate } from '../lib/dates';
import { badRequest, parseQuery } from '../lib/http';
import { buildExport, EXPORT_DATASETS } from '../services/export.service';

const router = Router();

/** Exports may span up to ~10 years; history/report screens are limited to 400 days. */
const MAX_EXPORT_DAYS = 3660;

const exportQuery = z.object({
  format: z.enum(['csv', 'json']).default('csv'),
  dataset: z.enum(['all', ...EXPORT_DATASETS]).default('all'),
  from: dateString.optional(),
  to: dateString.optional(),
});

/** GET /api/export?format=csv|json&dataset=…&from=&to= → file attachment */
router.get('/', async (req, res) => {
  const a = auth(req);
  const q = parseQuery(req, exportQuery);
  const to = q.to ?? todayIn(a.timezone);
  const from = q.from ?? addDays(to, -89);
  if (from > to) throw badRequest('from must be on or before to');
  const spanDays = (toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000 + 1;
  if (spanDays > MAX_EXPORT_DAYS) throw badRequest(`Range too large (max ${MAX_EXPORT_DAYS} days)`);
  if (q.format === 'csv' && q.dataset === 'all') {
    throw badRequest('CSV export covers one dataset at a time — choose a dataset, or use JSON to export everything.');
  }
  const file = await buildExport({ userId: a.userId, timezone: a.timezone, gymWeekdays: a.gymWeekdays }, { ...q, from, to });
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(file.body);
});

export default router;
