import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { badRequest, created, idParam, noContent, ok, parseBody, parseParams } from '../lib/http';
import { dateString, timezoneString } from '../lib/dates';
import {
  deleteTarget,
  getSettingsBundle,
  getTargets,
  listSessions,
  revokeSession,
  updateProfile,
  updateSettings,
  upsertTarget,
} from '../services/settings.service';

const router = Router();

const settingsPatch = z
  .object({
    timezone: timezoneString,
    theme: z.enum(['LIGHT', 'DARK', 'SYSTEM']),
    gymWeekdays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .refine((a) => new Set(a).size === a.length, 'Weekdays must be unique'),
    defaultSnoozeMinutes: z.number().int().min(1).max(120),
    notificationsEnabled: z.boolean(),
    profileMediaId: z.string().uuid().nullable(),
  })
  .partial()
  .strict();

const profileBody = z.object({ name: z.string().trim().min(1, 'Name is required').max(80) });

const amount = (max: number) => z.number().finite().min(0).max(max);
const optAmount = (max: number) => amount(max).nullable().optional();
const optInt = (max: number) => z.number().int().min(0).max(max).nullable().optional();

const targetBody = z.object({
  effectiveFrom: dateString.optional(),
  calories: amount(20_000),
  caloriesMin: optAmount(20_000),
  caloriesMax: optAmount(20_000),
  protein: amount(1_000),
  proteinMin: optAmount(1_000),
  proteinMax: optAmount(1_000),
  carbs: amount(2_000),
  carbsMin: optAmount(2_000),
  carbsMax: optAmount(2_000),
  fat: amount(1_000),
  fatMin: optAmount(1_000),
  fatMax: optAmount(1_000),
  fiber: amount(500),
  fiberMin: optAmount(500),
  fiberMax: optAmount(500),
  waterMl: z.number().int().min(0).max(20_000),
  waterMinMl: optInt(20_000),
  waterMaxMl: optInt(20_000),
  notes: z.string().max(1000).nullable().optional(),
});

router.get('/', async (req, res) => ok(res, await getSettingsBundle(auth(req).userId)));

router.patch('/', async (req, res) => {
  const patch = parseBody(req, settingsPatch);
  if (Object.keys(patch).length === 0) throw badRequest('Nothing to update');
  return ok(res, await updateSettings(auth(req).userId, patch));
});

router.patch('/profile', async (req, res) => {
  const { name } = parseBody(req, profileBody);
  return ok(res, await updateProfile(auth(req).userId, name));
});

router.get('/targets', async (req, res) => {
  const { userId, timezone } = auth(req);
  return ok(res, await getTargets(userId, timezone));
});

router.post('/targets', async (req, res) => {
  const { userId, timezone } = auth(req);
  return created(res, await upsertTarget(userId, timezone, parseBody(req, targetBody)));
});

router.delete('/targets/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await deleteTarget(auth(req).userId, id);
  return noContent(res);
});

router.get('/sessions', async (req, res) => {
  const { userId, sessionId } = auth(req);
  return ok(res, await listSessions(userId, sessionId));
});

router.delete('/sessions/:id', async (req, res) => {
  const { userId, sessionId } = auth(req);
  const { id } = parseParams(req, idParam);
  await revokeSession(userId, sessionId, id);
  return noContent(res);
});

export default router;
