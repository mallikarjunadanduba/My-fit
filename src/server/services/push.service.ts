import webpush from 'web-push';
import type { DeliveryChannel, DeliveryStatus, PushSubscription } from '@prisma/client';
import { prisma } from '../db';
import { env } from '../env';

/**
 * Web Push delivery.
 *  - VAPID keys come from env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT).
 *    Generate a pair with `npm run vapid:generate`.
 *  - When push is not configured every delivery is logged as SKIPPED with a clear reason.
 *  - 404/410 from the push service → subscription revoked. Other failures increment
 *    failureCount; the subscription is revoked after MAX_FAILURES consecutive failures.
 */

export const PUSH_TTL_SECONDS = 30 * 60;
export const MAX_FAILURES = 5;

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
  category?: string;
  reminderId?: string | null;
  occurrenceId?: string | null;
  requireInteraction?: boolean;
  actions?: { action: string; title: string }[];
  test?: boolean;
}

export interface DeliveryOutcome {
  subscriptionId: string | null;
  endpointHost: string | null;
  status: DeliveryStatus;
  statusCode: number | null;
  error: string | null;
}

let configuredWith: string | null = null;

export function isPushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

export function vapidPublicKey(): string | null {
  return isPushConfigured() ? env.VAPID_PUBLIC_KEY! : null;
}

function ensureVapid() {
  const signature = `${env.VAPID_SUBJECT}|${env.VAPID_PUBLIC_KEY}`;
  if (configuredWith === signature) return;
  webpush.setVapidDetails(env.VAPID_SUBJECT!, env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!);
  configuredWith = signature;
}

export const ALARM_ACTIONS = [
  { action: 'done', title: 'Done' },
  { action: 'snooze', title: 'Snooze 10 min' },
];

function endpointHost(endpoint: string): string | null {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 500);
  return String(err).slice(0, 500);
}

function statusCodeOf(err: unknown): number | null {
  if (err && typeof err === 'object' && 'statusCode' in err && typeof (err as { statusCode: unknown }).statusCode === 'number') {
    return (err as { statusCode: number }).statusCode;
  }
  return null;
}

interface LogTarget {
  userId: string;
  reminderId?: string | null;
  occurrenceId?: string | null;
  channel: DeliveryChannel;
}

/**
 * Writes a delivery log. Rows tied to an occurrence are unique per (occurrence, subscription, channel):
 * a repeat delivery (snooze re-send) updates the existing row instead of creating a duplicate.
 */
async function writeLog(target: LogTarget, subscriptionId: string | null, outcome: Omit<DeliveryOutcome, 'subscriptionId' | 'endpointHost'>) {
  const data = { status: outcome.status, statusCode: outcome.statusCode, error: outcome.error };
  if (target.occurrenceId && subscriptionId) {
    await prisma.notificationDeliveryLog.upsert({
      where: { occurrenceId_subscriptionId_channel: { occurrenceId: target.occurrenceId, subscriptionId, channel: target.channel } },
      create: { userId: target.userId, reminderId: target.reminderId ?? null, occurrenceId: target.occurrenceId, subscriptionId, channel: target.channel, ...data },
      update: { ...data, createdAt: new Date() },
    });
    return;
  }
  await prisma.notificationDeliveryLog.create({
    data: { userId: target.userId, reminderId: target.reminderId ?? null, occurrenceId: target.occurrenceId ?? null, subscriptionId, channel: target.channel, ...data },
  });
}

/** Sends one push to one subscription and updates its health counters. Never throws. */
async function deliver(sub: PushSubscription, body: string): Promise<Omit<DeliveryOutcome, 'subscriptionId' | 'endpointHost'>> {
  try {
    const res = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body, {
      TTL: PUSH_TTL_SECONDS,
      urgency: 'high',
      timeout: 10_000,
    });
    await prisma.pushSubscription.update({ where: { id: sub.id }, data: { lastSuccessAt: new Date(), failureCount: 0 } });
    return { status: 'SENT', statusCode: res?.statusCode ?? 201, error: null };
  } catch (err) {
    const code = statusCodeOf(err);
    if (code === 404 || code === 410) {
      await prisma.pushSubscription.update({ where: { id: sub.id }, data: { revokedAt: new Date() } });
      return { status: 'EXPIRED', statusCode: code, error: 'Subscription expired or was removed by the browser; it has been revoked.' };
    }
    const failureCount = sub.failureCount + 1;
    await prisma.pushSubscription.update({
      where: { id: sub.id },
      data: { failureCount, ...(failureCount >= MAX_FAILURES ? { revokedAt: new Date() } : {}) },
    });
    return {
      status: 'FAILED',
      statusCode: code,
      error: `${errorMessage(err)}${failureCount >= MAX_FAILURES ? ` (revoked after ${MAX_FAILURES} consecutive failures)` : ''}`,
    };
  }
}

export interface SendOptions extends LogTarget {
  /** Restrict to one subscription (used by device-level tests). */
  subscriptionId?: string;
  /** When set, no push is attempted and a SKIPPED row is logged with this reason. */
  skipReason?: string;
}

/**
 * Sends `payload` to every active subscription of the user and logs each outcome.
 * Returns one outcome per subscription (or a single SKIPPED outcome when nothing could be sent).
 */
export async function sendPushToUser(payload: PushPayload, opts: SendOptions): Promise<DeliveryOutcome[]> {
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: opts.userId, revokedAt: null, ...(opts.subscriptionId ? { id: opts.subscriptionId } : {}) },
    orderBy: { createdAt: 'asc' },
  });

  const reason = opts.skipReason ?? (!isPushConfigured() ? 'Web Push is not configured on the server (VAPID keys missing).' : subs.length === 0 ? 'No active push subscriptions for this user.' : null);
  if (reason) {
    const outcome = { status: 'SKIPPED' as const, statusCode: null, error: reason };
    if (subs.length === 0) {
      await writeLog(opts, null, outcome);
      return [{ subscriptionId: null, endpointHost: null, ...outcome }];
    }
    const out: DeliveryOutcome[] = [];
    for (const s of subs) {
      await writeLog(opts, s.id, outcome);
      out.push({ subscriptionId: s.id, endpointHost: endpointHost(s.endpoint), ...outcome });
    }
    return out;
  }

  ensureVapid();
  const body = JSON.stringify(payload);
  return Promise.all(
    subs.map(async (s) => {
      const outcome = await deliver(s, body);
      await writeLog(opts, s.id, outcome);
      return { subscriptionId: s.id, endpointHost: endpointHost(s.endpoint), ...outcome };
    }),
  );
}
