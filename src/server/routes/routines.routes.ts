import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { created, idParam, noContent, ok, parseBody, parseParams, parseQuery } from '../lib/http';
import { dateString, todayIn } from '../lib/dates';
import {
  copySchema,
  copyTemplate,
  createItem,
  createTemplate,
  deleteItem,
  deleteTemplate,
  entryUpdateSchema,
  getDay,
  getTemplate,
  itemCreateSchema,
  itemUpdateSchema,
  listTemplates,
  reorderItems,
  reorderSchema,
  templateCreateSchema,
  templateUpdateSchema,
  updateEntry,
  updateItem,
  updateTemplate,
} from '../services/routines.service';

const router = Router();

router.get('/day', async (req, res) => {
  const a = auth(req);
  const { date } = parseQuery(req, z.object({ date: dateString.optional() }));
  ok(res, await getDay(a.userId, date ?? todayIn(a.timezone), { timezone: a.timezone, gymWeekdays: a.gymWeekdays }));
});

router.patch('/entries/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const a = auth(req);
  ok(res, await updateEntry(a.userId, id, parseBody(req, entryUpdateSchema), new Date(), a.timezone));
});

router.get('/templates', async (req, res) => {
  ok(res, await listTemplates(auth(req).userId));
});

router.post('/templates', async (req, res) => {
  created(res, await createTemplate(auth(req).userId, parseBody(req, templateCreateSchema)));
});

router.get('/templates/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await getTemplate(auth(req).userId, id));
});

router.patch('/templates/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await updateTemplate(auth(req).userId, id, parseBody(req, templateUpdateSchema)));
});

router.delete('/templates/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await deleteTemplate(auth(req).userId, id);
  noContent(res);
});

router.post('/templates/:id/items', async (req, res) => {
  const { id } = parseParams(req, idParam);
  created(res, await createItem(auth(req).userId, id, parseBody(req, itemCreateSchema)));
});

router.post('/templates/:id/items/reorder', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await reorderItems(auth(req).userId, id, parseBody(req, reorderSchema).ids));
});

router.post('/templates/:id/copy', async (req, res) => {
  const { id } = parseParams(req, idParam);
  created(res, await copyTemplate(auth(req).userId, id, parseBody(req, copySchema)));
});

router.patch('/items/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await updateItem(auth(req).userId, id, parseBody(req, itemUpdateSchema)));
});

router.delete('/items/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await deleteItem(auth(req).userId, id);
  noContent(res);
});

export default router;
