import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { created, idParam, noContent, ok, parseBody, parseParams, parseQuery } from '../lib/http';
import * as meals from '../services/meals.service';

const router = Router();
const slotIdParam = z.object({ slotId: z.string().uuid() });
const includeArchivedQuery = z.object({
  includeArchived: z
    .enum(['true', 'false', '1', '0'])
    .transform((v) => v === 'true' || v === '1')
    .optional(),
});

// ── Slots ──

router.get('/slots', async (req, res) => {
  const { includeArchived } = parseQuery(req, includeArchivedQuery);
  ok(res, await meals.listSlots(auth(req).userId, includeArchived));
});

router.post('/slots', async (req, res) => {
  const body = parseBody(req, meals.slotInput);
  created(res, await meals.createSlot(auth(req).userId, body));
});

router.post('/slots/reorder', async (req, res) => {
  const { ids } = parseBody(req, meals.reorderInput);
  ok(res, await meals.reorderSlots(auth(req).userId, ids));
});

router.patch('/slots/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(req, meals.slotUpdate);
  ok(res, await meals.updateSlot(auth(req).userId, id, body));
});

router.post('/slots/:id/archive', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await meals.setSlotArchived(auth(req).userId, id, true));
});

router.post('/slots/:id/unarchive', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await meals.setSlotArchived(auth(req).userId, id, false));
});

/** 204 when deleted; 200 { archived: true } when the slot has history and was archived instead. */
router.delete('/slots/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const result = await meals.deleteSlot(auth(req).userId, id);
  if (result.archived) ok(res, result);
  else noContent(res);
});

// ── Templates ──

router.get('/templates', async (req, res) => {
  const q = parseQuery(req, meals.templateListQuery);
  ok(res, await meals.listTemplates(auth(req).userId, q));
});

router.get('/templates/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await meals.getTemplate(auth(req).userId, id));
});

router.post('/templates', async (req, res) => {
  const body = parseBody(req, meals.templateInput);
  created(res, await meals.createTemplate(auth(req).userId, body));
});

router.patch('/templates/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(req, meals.templateUpdate);
  ok(res, await meals.updateTemplate(auth(req).userId, id, body));
});

router.post('/templates/:id/duplicate', async (req, res) => {
  const userId = auth(req).userId;
  const { id } = parseParams(req, idParam);
  const body = parseBody(req, z.object({ name: z.string().trim().min(1).max(120).optional() }));
  const newId = await meals.duplicateTemplate(userId, id, body);
  created(res, await meals.getTemplate(userId, newId));
});

router.post('/templates/:id/archive', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await meals.setTemplateArchived(auth(req).userId, id, true));
});

router.post('/templates/:id/unarchive', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await meals.setTemplateArchived(auth(req).userId, id, false));
});

router.delete('/templates/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await meals.deleteTemplate(auth(req).userId, id);
  noContent(res);
});

// ── Plan ──

router.get('/plan', async (req, res) => {
  const a = auth(req);
  const q = parseQuery(req, meals.planQuery);
  ok(res, await meals.getPlan(a.userId, { date: q.date, dayType: q.dayType, gymWeekdays: a.gymWeekdays }));
});

router.put('/plan/:slotId', async (req, res) => {
  const { slotId } = parseParams(req, slotIdParam);
  const body = parseBody(req, meals.setPlanInput);
  ok(res, await meals.setPlan(auth(req).userId, slotId, body));
});

// ── Daily meal status & logging ──

router.put('/status', async (req, res) => {
  const body = parseBody(req, meals.statusInput);
  ok(res, await meals.setStatus(auth(req).userId, body));
});

router.post('/apply-template', async (req, res) => {
  const body = parseBody(req, meals.applyTemplateInput);
  created(res, await meals.applyTemplate(auth(req).userId, body));
});

router.post('/copy-day', async (req, res) => {
  const body = parseBody(req, meals.copyDayInput);
  created(res, await meals.copyDay(auth(req).userId, body));
});

export default router;
