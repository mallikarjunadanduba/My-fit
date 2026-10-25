import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { created, idParam, noContent, ok, pageMeta, paginationQuery, parseBody, parseParams, parseQuery } from '../lib/http';
import { dateString } from '../lib/dates';
import { isPushConfigured } from '../services/push.service';
import {
  alarmSummary,
  completeOccurrence,
  createReminder,
  deleteReminder,
  dismissOccurrence,
  history,
  listReminders,
  nextReminder,
  overdue,
  reminderCreateSchema,
  reminderDto,
  reminderUpdateSchema,
  getReminder,
  ringReminder,
  setReminderEnabled,
  snoozeMinutesSchema,
  snoozeOccurrence,
  testReminder,
  updateReminder,
} from '../services/reminders.service';

const router = Router();

router.get('/', async (req, res) => {
  ok(res, await listReminders(auth(req).userId), { pushConfigured: isPushConfigured() });
});

router.get('/next', async (req, res) => {
  ok(res, await nextReminder(auth(req).userId));
});

router.get('/overdue', async (req, res) => {
  const a = auth(req);
  ok(res, await overdue(a.userId, new Date(), a.timezone));
});

/** Aggregated poll for the always-mounted AlarmProvider: { next, overdue, pushConfigured, vapidPublicKey }. */
router.get('/summary', async (req, res) => {
  const a = auth(req);
  ok(res, await alarmSummary(a.userId, a.timezone));
});

const historyQuery = paginationQuery.extend({ from: dateString.optional(), to: dateString.optional() });

router.get('/history', async (req, res) => {
  const q = parseQuery(req, historyQuery);
  const a = auth(req);
  const { total, items } = await history(a.userId, q, a.timezone);
  ok(res, items, pageMeta(q.page, q.pageSize, total));
});

router.post('/occurrences/:id/complete', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await completeOccurrence(auth(req).userId, id));
});

router.post('/occurrences/:id/dismiss', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await dismissOccurrence(auth(req).userId, id));
});

router.post('/occurrences/:id/snooze', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const { minutes } = parseBody(req, z.object({ minutes: snoozeMinutesSchema.optional() }));
  ok(res, await snoozeOccurrence(auth(req).userId, id, minutes));
});

router.post('/', async (req, res) => {
  created(res, await createReminder(auth(req).userId, parseBody(req, reminderCreateSchema)));
});

router.get('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, reminderDto(await getReminder(auth(req).userId, id)));
});

router.patch('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await updateReminder(auth(req).userId, id, parseBody(req, reminderUpdateSchema)));
});

router.delete('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await deleteReminder(auth(req).userId, id);
  noContent(res);
});

router.post('/:id/pause', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await setReminderEnabled(auth(req).userId, id, false));
});

router.post('/:id/resume', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await setReminderEnabled(auth(req).userId, id, true));
});

router.post('/:id/test', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, { pushConfigured: isPushConfigured(), ...(await testReminder(auth(req).userId, id)) });
});

/** In-page timer reached nextTriggerAt: ensure the occurrence exists so the app can ring it now. */
router.post('/:id/ring', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const { scheduledFor } = parseBody(req, z.object({ scheduledFor: z.string().datetime({ offset: true }) }));
  ok(res, await ringReminder(auth(req).userId, id, new Date(scheduledFor)));
});

export default router;
