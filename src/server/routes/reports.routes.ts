import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { addDays, dateRange, dateString, monthString, todayIn } from '../lib/dates';
import { badRequest, ok, pageMeta, parseBody, parseParams, parseQuery } from '../lib/http';
import {
  getCalendar,
  getDailyReport,
  getHistory,
  getPeriodReport,
  HISTORY_KINDS,
  upsertDailyLog,
  type UserCtx,
} from '../services/reports.service';

const router = Router();

const ctxOf = (req: Parameters<typeof auth>[0]): UserCtx => {
  const a = auth(req);
  return { userId: a.userId, timezone: a.timezone, gymWeekdays: a.gymWeekdays };
};

const dateParam = z.object({ date: dateString });

const dailyLogBody = z
  .object({
    notes: z.string().max(5000).nullable().optional(),
    dayType: z.enum(['GYM', 'REST']).nullable().optional(),
  })
  .strict()
  .refine((b) => b.notes !== undefined || b.dayType !== undefined, 'Provide notes and/or dayType');

router.get('/daily/:date', async (req, res) => {
  const { date } = parseParams(req, dateParam);
  ok(res, await getDailyReport(ctxOf(req), date));
});

router.put('/daily/:date', async (req, res) => {
  const { date } = parseParams(req, dateParam);
  const body = parseBody(req, dailyLogBody);
  ok(res, await upsertDailyLog(ctxOf(req), date, body));
});

router.get('/calendar', async (req, res) => {
  const ctx = ctxOf(req);
  const { month } = parseQuery(req, z.object({ month: monthString.optional() }));
  ok(res, await getCalendar(ctx, month ?? todayIn(ctx.timezone).slice(0, 7)));
});

router.get('/weekly', async (req, res) => {
  const ctx = ctxOf(req);
  const { date } = parseQuery(req, z.object({ date: dateString.optional() }));
  ok(res, await getPeriodReport(ctx, 'weekly', date ?? todayIn(ctx.timezone)));
});

router.get('/monthly', async (req, res) => {
  const ctx = ctxOf(req);
  const { month } = parseQuery(req, z.object({ month: monthString.optional() }));
  ok(res, await getPeriodReport(ctx, 'monthly', month ?? todayIn(ctx.timezone).slice(0, 7)));
});

const historyQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

router.get('/history/:kind', async (req, res) => {
  const ctx = ctxOf(req);
  const { kind } = parseParams(req, z.object({ kind: z.enum(HISTORY_KINDS) }));
  const q = parseQuery(req, historyQuery);
  const to = q.to ?? todayIn(ctx.timezone);
  const from = q.from ?? addDays(to, -29);
  if (from > to) throw badRequest('from must be on or before to');
  if (dateRange(from, to).length > 400) throw badRequest('Range too large (max 400 days)');
  const result = await getHistory(ctx, kind, { from, to, page: q.page, pageSize: q.pageSize });
  ok(res, result.rows, { ...pageMeta(q.page, q.pageSize, result.total), from, to, kind });
});

export default router;
