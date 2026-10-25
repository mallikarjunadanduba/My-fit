import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { dateString, todayIn } from '../lib/dates';
import { ok, parseQuery } from '../lib/http';
import { getDashboard } from '../services/dashboard.service';

const router = Router();

const dashboardQuery = z.object({ date: dateString.optional() });

/** GET /api/dashboard?date=YYYY-MM-DD (defaults to today in the user's timezone) */
router.get('/', async (req, res) => {
  const a = auth(req);
  const { date } = parseQuery(req, dashboardQuery);
  const data = await getDashboard(
    { userId: a.userId, name: a.name, timezone: a.timezone, gymWeekdays: a.gymWeekdays },
    date ?? todayIn(a.timezone),
  );
  ok(res, data);
});

export default router;
