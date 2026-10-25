import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { created, idParam, noContent, ok, parseBody, parseParams, parseQuery } from '../lib/http';
import { dateRangeQuery, dateString, todayIn } from '../lib/dates';
import * as water from '../services/water.service';

const router = Router();

router.get('/', async (req, res) => {
  const a = auth(req);
  const { date, historyDays } = parseQuery(
    req,
    z.object({
      date: dateString.optional(),
      historyDays: z.coerce.number().int().min(1).max(92).optional(),
    }),
  );
  ok(res, await water.getDay(a.userId, date ?? todayIn(a.timezone), historyDays));
});

router.get('/range', async (req, res) => {
  const { from, to } = parseQuery(req, dateRangeQuery);
  ok(res, await water.getRange(auth(req).userId, from, to));
});

router.post('/', async (req, res) => {
  const a = auth(req);
  const body = parseBody(req, water.waterInput);
  created(res, await water.createEntry(a.userId, a.timezone, body));
});

router.patch('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(req, water.waterUpdate);
  ok(res, await water.updateEntry(auth(req).userId, id, body));
});

router.delete('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await water.deleteEntry(auth(req).userId, id);
  noContent(res);
});

export default router;
