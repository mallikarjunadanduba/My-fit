import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const saved = vi.hoisted(() => {
  const prev = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY, sub: process.env.VAPID_SUBJECT };
  process.env.VAPID_PUBLIC_KEY = 'test-public-key';
  process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  process.env.VAPID_SUBJECT = 'mailto:test@example.test';
  return prev;
});

vi.mock('web-push', () => {
  const sendNotification = vi.fn(async () => ({ statusCode: 201, body: '', headers: {} }));
  const setVapidDetails = vi.fn();
  return { default: { sendNotification, setVapidDetails }, sendNotification, setVapidDetails };
});

import webpush from 'web-push';
import { prisma } from '../../src/server/db';
import { env } from '../../src/server/env';
import { createTestUser } from './helpers';

const send = vi.mocked(webpush.sendNotification);

afterAll(() => {
  process.env.VAPID_PUBLIC_KEY = saved.pub;
  process.env.VAPID_PRIVATE_KEY = saved.priv;
  process.env.VAPID_SUBJECT = saved.sub;
});

beforeEach(() => {
  send.mockReset();
  send.mockImplementation(async () => ({ statusCode: 201, body: '', headers: {} }));
});

const sub = (endpoint = `https://push.example.test/${crypto.randomUUID()}`) => ({
  endpoint,
  keys: { p256dh: 'BPub-key', auth: 'auth-secret' },
  userAgent: 'Vitest Browser',
});

describe('notifications API', () => {
  it('reports push config', async () => {
    const { api } = await createTestUser();
    const res = await api.get('/api/notifications/config');
    expect(res.body.data).toEqual({ pushConfigured: true, vapidPublicKey: 'test-public-key' });
  });

  it('subscribes (upsert by endpoint, reassigns), lists, unsubscribes', async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const body = sub();
    const r1 = await a.api.post('/api/notifications/subscribe').send(body);
    expect(r1.status).toBe(201);
    const r2 = await a.api.post('/api/notifications/subscribe').send(body);
    expect(r2.body.data.id).toBe(r1.body.data.id);
    expect(await prisma.pushSubscription.count({ where: { endpoint: body.endpoint } })).toBe(1);

    // Same browser endpoint now used by another account → reassigned.
    await b.api.post('/api/notifications/subscribe').send(body);
    expect((await a.api.get('/api/notifications/subscriptions')).body.data).toHaveLength(0);
    expect((await b.api.get('/api/notifications/subscriptions')).body.data).toHaveLength(1);

    expect((await a.api.post('/api/notifications/unsubscribe').send({ endpoint: body.endpoint })).body.data.removed).toBe(0);
    expect((await b.api.post('/api/notifications/unsubscribe').send({ endpoint: body.endpoint })).body.data.removed).toBe(1);
  });

  it('rejects invalid subscriptions', async () => {
    const { api } = await createTestUser();
    expect((await api.post('/api/notifications/subscribe').send({ endpoint: 'http://insecure.test/x', keys: { p256dh: 'a', auth: 'b' } })).status).toBe(400);
    expect((await api.post('/api/notifications/subscribe').send({ endpoint: 'https://ok.test/x' })).status).toBe(400);
  });

  it('cross-user subscription delete is 404', async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const s = (await a.api.post('/api/notifications/subscribe').send(sub())).body.data;
    expect((await b.api.delete(`/api/notifications/subscriptions/${s.id}`)).status).toBe(404);
    expect((await a.api.delete(`/api/notifications/subscriptions/${s.id}`)).status).toBe(204);
  });

  it('test push returns per-subscription outcomes and revokes on 410', async () => {
    const { api } = await createTestUser();
    const good = (await api.post('/api/notifications/subscribe').send(sub())).body.data;
    const gone = (await api.post('/api/notifications/subscribe').send(sub())).body.data;
    send.mockImplementation(async (s: { endpoint: string }) => {
      if (s.endpoint === gone.endpoint) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      return { statusCode: 201, body: '', headers: {} };
    });
    const res = await api.post('/api/notifications/test');
    expect(res.status).toBe(200);
    const byId = Object.fromEntries(res.body.data.deliveries.map((d: { subscriptionId: string; status: string }) => [d.subscriptionId, d.status]));
    expect(byId[good.id]).toBe('SENT');
    expect(byId[gone.id]).toBe('EXPIRED');
    expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { id: gone.id } })).revokedAt).not.toBeNull();

    // Revoked subscriptions are not targeted again.
    send.mockClear();
    await api.post('/api/notifications/test');
    expect(send).toHaveBeenCalledTimes(1);

    const deliveries = await api.get('/api/notifications/deliveries?page=1');
    expect(deliveries.body.meta.total).toBe(3);
  });

  it('increments failureCount and revokes after 5 failures', async () => {
    const { api } = await createTestUser();
    const s = (await api.post('/api/notifications/subscribe').send(sub())).body.data;
    send.mockImplementation(async () => {
      throw Object.assign(new Error('Server error'), { statusCode: 500 });
    });
    for (let i = 0; i < 5; i++) await api.post('/api/notifications/test');
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.failureCount).toBe(5);
    expect(row.revokedAt).not.toBeNull();
  });

  it('in-app ack is recorded once per occurrence', async () => {
    const { api, user } = await createTestUser();
    const r = await prisma.reminder.create({ data: { userId: user.id, title: 'Ack', time: '07:00' } });
    const occ = await prisma.reminderOccurrence.create({ data: { reminderId: r.id, userId: user.id, scheduledFor: new Date(), status: 'SENT' } });
    expect((await api.post('/api/notifications/in-app-ack').send({ occurrenceId: occ.id, action: 'shown' })).status).toBe(200);
    await api.post('/api/notifications/in-app-ack').send({ occurrenceId: occ.id, action: 'shown' });
    expect(await prisma.notificationDeliveryLog.count({ where: { occurrenceId: occ.id, channel: 'IN_APP' } })).toBe(1);
    const other = await createTestUser();
    expect((await other.api.post('/api/notifications/in-app-ack').send({ occurrenceId: occ.id, action: 'shown' })).status).toBe(404);
  });

  it('skips with a reason when push is not configured', async () => {
    const { api } = await createTestUser();
    await api.post('/api/notifications/subscribe').send(sub());
    const prev = env.VAPID_PUBLIC_KEY;
    env.VAPID_PUBLIC_KEY = undefined;
    try {
      const cfg = await api.get('/api/notifications/config');
      expect(cfg.body.data.pushConfigured).toBe(false);
      const res = await api.post('/api/notifications/test');
      expect(res.body.data.deliveries[0].status).toBe('SKIPPED');
      expect(res.body.data.deliveries[0].error).toMatch(/not configured/i);
      expect(send).not.toHaveBeenCalled();
    } finally {
      env.VAPID_PUBLIC_KEY = prev;
    }
  });
});
