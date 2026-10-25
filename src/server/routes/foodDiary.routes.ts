import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { created, idParam, noContent, ok, parseBody, parseParams, parseQuery } from '../lib/http';
import { dateRangeQuery, dateString, todayIn } from '../lib/dates';
import * as diary from '../services/foodDiary.service';
import { getDiaryWithPlan } from '../services/meals.service';
import { boolQuery } from '../services/foods.service';

const router = Router();

router.get('/', async (req, res) => {
  const a = auth(req);
  const { date, withPlan } = parseQuery(req, z.object({ date: dateString.optional(), withPlan: boolQuery.optional() }));
  const day = date ?? todayIn(a.timezone);
  // withPlan=true also returns that day's meal plan (same shape as GET /api/meals/plan?date=) in one round trip.
  ok(res, withPlan ? await getDiaryWithPlan(a.userId, day, a.gymWeekdays) : await diary.getDay(a.userId, day, a.gymWeekdays));
});

router.get('/range', async (req, res) => {
  const { from, to } = parseQuery(req, dateRangeQuery);
  ok(res, await diary.getRange(auth(req).userId, from, to));
});

router.post('/', async (req, res) => {
  const body = parseBody(req, diary.diaryEntryInput);
  created(res, await diary.createEntry(auth(req).userId, body));
});

router.post('/manual', async (req, res) => {
  const body = parseBody(req, diary.manualEntryInput);
  created(res, await diary.createManualEntry(auth(req).userId, body));
});

router.patch('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(req, diary.diaryEntryUpdate);
  ok(res, await diary.updateEntry(auth(req).userId, id, body));
});

router.delete('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await diary.deleteEntry(auth(req).userId, id);
  noContent(res);
});

export default router;
