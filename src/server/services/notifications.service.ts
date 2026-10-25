import { z } from 'zod';
import { prisma } from '../db';
import { notFound } from '../lib/http';
import { isPushConfigured, sendPushToUser, vapidPublicKey } from './push.service';

export const subscribeSchema = z.object({
  endpoint: z.string().url().max(2000).refine((u) => u.startsWith('https://'), 'Push endpoint must be https'),
  keys: z.object({ p256dh: z.string().min(1).max(500), auth: z.string().min(1).max(500) }),
  userAgent: z.string().max(500).nullish(),
});

export const unsubscribeSchema = z.object({ endpoint: z.string().min(1).max(2000) });

export const inAppAckSchema = z.object({ occurrenceId: z.string().uuid(), action: z.literal('shown') });

export function pushConfig() {
  return { pushConfigured: isPushConfigured(), vapidPublicKey: vapidPublicKey() };
}

function subscriptionDto(s: { id: string; endpoint: string; userAgent: string | null; failureCount: number; lastSuccessAt: Date | null; revokedAt: Date | null; createdAt: Date; updatedAt: Date }) {
  let host: string | null = null;
  try {
    host = new URL(s.endpoint).host;
  } catch {
    host = null;
  }
  return {
    id: s.id,
    endpoint: s.endpoint,
    endpointHost: host,
    userAgent: s.userAgent,
    failureCount: s.failureCount,
    lastSuccessAt: s.lastSuccessAt,
    revokedAt: s.revokedAt,
    active: !s.revokedAt,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Upsert by endpoint: a browser endpoint belongs to whoever subscribed with it most recently. */
export async function subscribe(userId: string, input: z.infer<typeof subscribeSchema>) {
  const data = { userId, p256dh: input.keys.p256dh, auth: input.keys.auth, userAgent: input.userAgent?.slice(0, 500) ?? null, revokedAt: null, failureCount: 0 };
  const s = await prisma.pushSubscription.upsert({
    where: { endpoint: input.endpoint },
    create: { endpoint: input.endpoint, ...data },
    update: data,
  });
  return subscriptionDto(s);
}

export async function unsubscribe(userId: string, endpoint: string) {
  const res = await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  return { removed: res.count };
}

export async function listSubscriptions(userId: string) {
  const rows = await prisma.pushSubscription.findMany({ where: { userId }, orderBy: [{ revokedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }] });
  return rows.map(subscriptionDto);
}

export async function deleteSubscription(userId: string, id: string) {
  const { count } = await prisma.pushSubscription.deleteMany({ where: { id, userId } });
  if (count === 0) throw notFound('Subscription');
}

export async function sendTest(userId: string) {
  const deliveries = await sendPushToUser(
    { title: 'MyFit Routine test', body: 'Notifications are working on this device.', tag: `test-${Date.now()}`, url: '/alarms', category: 'CUSTOM', test: true, actions: [] },
    { userId, channel: 'TEST' },
  );
  return { ...pushConfig(), deliveries };
}

export async function listDeliveries(userId: string, page: number, pageSize: number) {
  const where = { userId };
  const [total, rows] = await Promise.all([
    prisma.notificationDeliveryLog.count({ where }),
    prisma.notificationDeliveryLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        reminder: { select: { id: true, title: true, category: true } },
        occurrence: { select: { id: true, scheduledFor: true, status: true } },
        subscription: { select: { id: true, userAgent: true } },
      },
    }),
  ]);
  return {
    total,
    items: rows.map((d) => ({
      id: d.id,
      channel: d.channel,
      status: d.status,
      statusCode: d.statusCode,
      error: d.error,
      createdAt: d.createdAt,
      reminder: d.reminder,
      occurrence: d.occurrence,
      device: d.subscription?.userAgent ?? null,
      subscriptionId: d.subscriptionId,
    })),
  };
}

/**
 * Records that the open app showed an occurrence's alarm. One IN_APP row per occurrence (unique key);
 * a repeat ack (after a snooze re-ring) refreshes its timestamp instead of duplicating.
 */
export async function inAppAck(userId: string, occurrenceId: string) {
  const now = new Date();
  // One statement: ownership check, refresh of an existing IN_APP row, or insert of a new one.
  // (The unique key cannot dedupe here because subscriptionId is NULL for in-app rows.)
  const rows = await prisma.$queryRaw<{ found: boolean }[]>`
    WITH o AS (
      SELECT id, "reminderId" FROM "ReminderOccurrence" WHERE id = ${occurrenceId}::uuid AND "userId" = ${userId}::uuid
    ), upd AS (
      UPDATE "NotificationDeliveryLog" d SET "createdAt" = ${now}, status = 'SENT'
      FROM o WHERE d."occurrenceId" = o.id AND d.channel = 'IN_APP' AND d."subscriptionId" IS NULL
      RETURNING d.id
    ), ins AS (
      INSERT INTO "NotificationDeliveryLog" (id, "userId", "reminderId", "occurrenceId", channel, status, "createdAt")
      SELECT gen_random_uuid(), ${userId}::uuid, o."reminderId", o.id, 'IN_APP'::"DeliveryChannel", 'SENT'::"DeliveryStatus", ${now}
      FROM o WHERE NOT EXISTS (SELECT 1 FROM upd)
      RETURNING id
    )
    SELECT EXISTS (SELECT 1 FROM o) AS found, (SELECT count(*) FROM ins)::int AS inserted`;
  if (!rows[0]?.found) throw notFound('Occurrence');
  return { occurrenceId, shownAt: now };
}
