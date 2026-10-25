import { Router } from 'express';
import { z } from 'zod';
import { auth } from '../middleware/auth';
import { created, idParam, noContent, ok, pageMeta, parseBody, parseParams, parseQuery } from '../lib/http';
import * as foods from '../services/foods.service';

const router = Router();

// ── Categories (declared before /:id so "categories" is not parsed as an id) ──

router.get('/categories', async (req, res) => {
  ok(res, await foods.listCategories(auth(req).userId));
});

router.post('/categories', async (req, res) => {
  const body = parseBody(req, foods.categoryInput);
  created(res, await foods.createCategory(auth(req).userId, body));
});

router.patch('/categories/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(req, foods.categoryInput.partial());
  ok(res, await foods.updateCategory(auth(req).userId, id, body));
});

router.delete('/categories/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await foods.deleteCategory(auth(req).userId, id);
  noContent(res);
});

// ── Foods ──

router.get('/', async (req, res) => {
  const q = parseQuery(req, foods.foodListQuery);
  const { total, items } = await foods.listFoods(auth(req).userId, q);
  ok(res, items, pageMeta(q.page, q.pageSize, total));
});

router.get('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await foods.getFood(auth(req).userId, id));
});

router.post('/', async (req, res) => {
  const body = parseBody(req, foods.foodInput);
  created(res, await foods.createFood(auth(req).userId, body));
});

router.patch('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const body = parseBody(req, foods.foodUpdate);
  ok(res, await foods.updateFood(auth(req).userId, id, body));
});

router.post('/:id/archive', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await foods.setArchived(auth(req).userId, id, true));
});

router.post('/:id/unarchive', async (req, res) => {
  const { id } = parseParams(req, idParam);
  ok(res, await foods.setArchived(auth(req).userId, id, false));
});

router.post('/:id/favorite', async (req, res) => {
  const { id } = parseParams(req, idParam);
  const { isFavorite } = parseBody(req, z.object({ isFavorite: z.boolean() }));
  ok(res, await foods.setFavorite(auth(req).userId, id, isFavorite));
});

router.delete('/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await foods.deleteFood(auth(req).userId, id);
  noContent(res);
});

export default router;
