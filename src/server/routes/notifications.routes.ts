import { Router } from 'express';
import { auth } from '../middleware/auth';
import { created, idParam, noContent, ok, pageMeta, paginationQuery, parseBody, parseParams, parseQuery } from '../lib/http';
import {
  deleteSubscription,
  inAppAck,
  inAppAckSchema,
  listDeliveries,
  listSubscriptions,
  pushConfig,
  sendTest,
  subscribe,
  subscribeSchema,
  unsubscribe,
  unsubscribeSchema,
} from '../services/notifications.service';

const router = Router();

router.get('/config', (_req, res) => {
  ok(res, pushConfig());
});

router.post('/subscribe', async (req, res) => {
  created(res, await subscribe(auth(req).userId, parseBody(req, subscribeSchema)));
});

router.post('/unsubscribe', async (req, res) => {
  const { endpoint } = parseBody(req, unsubscribeSchema);
  ok(res, await unsubscribe(auth(req).userId, endpoint));
});

router.get('/subscriptions', async (req, res) => {
  ok(res, await listSubscriptions(auth(req).userId));
});

router.delete('/subscriptions/:id', async (req, res) => {
  const { id } = parseParams(req, idParam);
  await deleteSubscription(auth(req).userId, id);
  noContent(res);
});

router.post('/test', async (req, res) => {
  ok(res, await sendTest(auth(req).userId));
});

router.get('/deliveries', async (req, res) => {
  const q = parseQuery(req, paginationQuery);
  const { total, items } = await listDeliveries(auth(req).userId, q.page, q.pageSize);
  ok(res, items, pageMeta(q.page, q.pageSize, total));
});

router.post('/in-app-ack', async (req, res) => {
  const { occurrenceId } = parseBody(req, inAppAckSchema);
  ok(res, await inAppAck(auth(req).userId, occurrenceId));
});

export default router;
