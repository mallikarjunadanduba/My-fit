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
import { computeWakeDelay, loadNextDue, MAX_SLEEP_MS, MIN_SLEEP_MS, nextWakeDelay, pokeScheduler, runSchedulerTick } from '../../src/server/scheduler';
import { createTestUser } from './helpers';

const send = vi.mocked(webpush.sendNotification);

afterAll(() => {
  process.env.VAPID_PUBLIC_KEY = saved.pub;
  process.env.VAPID_PRIVATE_KEY = saved.priv;
  process.env.VAPID_SUBJECT = saved.sub;
});

beforeEach(() => {
  send.mockClear();
});

async function userWithDevices(n = 2) {
  const u = await createTestUser();
  const endpoints: string[] = [];
  for (let i = 0; i < n; i++) {
    const endpoint = `https://push.example.test/${crypto.randomUUID()}`;
    endpoints.push(endpoint);
    await prisma.pushSubscription.create({ data: { userId: u.user.id, endpoint, p256dh: 'p256dh-key', auth: 'auth-key' } });
  }
  return { ...u, endpoints };
}

const callsTo = (endpoints: string[]) => send.mock.calls.filter((c) => endpoints.includes((c[0] as { endpoint: string }).endpoint));

async function dueReminder(userId: string, minutesAgo: number, extra: Record<string, unknown> = {}) {
  const r = await prisma.reminder.create({ data: { userId, title: 'Due reminder', time: '07:00', ...extra } });
  // Align nextTriggerAt with a real schedule so the re-validation accepts it: weekdays=[] and time from the instant.
  const at = new Date(Math.floor((Date.now() - minutesAgo * 60_000) / 60_000) * 60_000);
  const hhmm = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return prisma.reminder.update({ where: { id: r.id }, data: { time: hhmm, nextTriggerAt: at } });
}

describe('scheduler tick', () => {
  it('fires a due reminder once even when ticks overlap / repeat', async () => {
    const { user, endpoints } = await userWithDevices(2);
    const r = await dueReminder(user.id, 1);
    const scheduledFor = r.nextTriggerAt!;

    const first = await runSchedulerTick(new Date());
    expect(first.locked).toBe(true);
    await runSchedulerTick(new Date());

    const occ = await prisma.reminderOccurrence.findMany({ where: { reminderId: r.id } });
    expect(occ).toHaveLength(1);
    expect(occ[0].status).toBe('SENT');
    expect(occ[0].scheduledFor.toISOString()).toBe(scheduledFor.toISOString());
    expect(callsTo(endpoints)).toHaveLength(2);
    const logs = await prisma.notificationDeliveryLog.findMany({ where: { occurrenceId: occ[0].id } });
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.status === 'SENT' && l.channel === 'WEB_PUSH')).toBe(true);

    const payload = JSON.parse(callsTo(endpoints)[0][1] as string);
    expect(payload).toMatchObject({ tag: occ[0].id, occurrenceId: occ[0].id, reminderId: r.id, url: `/alarms?occurrence=${occ[0].id}` });
    expect(payload.actions.map((a: { action: string }) => a.action)).toEqual(['done', 'snooze']);

    const after = await prisma.reminder.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.lastTriggeredAt).not.toBeNull();
    expect(after.nextTriggerAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('records a reminder processed >30 min late as MISSED without pushing', async () => {
    const { user, endpoints } = await userWithDevices(1);
    const r = await dueReminder(user.id, 90);
    const stats = await runSchedulerTick(new Date());
    expect(stats.missed).toBeGreaterThanOrEqual(1);
    const occ = await prisma.reminderOccurrence.findFirstOrThrow({ where: { reminderId: r.id } });
    expect(occ.status).toBe('MISSED');
    expect(callsTo(endpoints)).toHaveLength(0);
    const log = await prisma.notificationDeliveryLog.findFirstOrThrow({ where: { occurrenceId: occ.id } });
    expect(log.status).toBe('SKIPPED');
    const after = await prisma.reminder.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.nextTriggerAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('disables one-time reminders after firing', async () => {
    const { user } = await userWithDevices(1);
    const r = await dueReminder(user.id, 1);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(r.nextTriggerAt!);
    await prisma.reminder.update({ where: { id: r.id }, data: { oneTimeDate: new Date(`${today}T00:00:00Z`) } });
    await runSchedulerTick(new Date());
    const after = await prisma.reminder.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.enabled).toBe(false);
    expect(after.nextTriggerAt).toBeNull();
    expect(await prisma.reminderOccurrence.count({ where: { reminderId: r.id, status: 'SENT' } })).toBe(1);
  });

  it('fills a null nextTriggerAt for enabled reminders', async () => {
    const { user } = await createTestUser();
    const r = await prisma.reminder.create({ data: { userId: user.id, title: 'Seeded', time: '12:00' } });
    await runSchedulerTick(new Date());
    const after = await prisma.reminder.findUniqueOrThrow({ where: { id: r.id } });
    expect(after.nextTriggerAt).not.toBeNull();
  });

  it('re-sends a snoozed occurrence exactly once', async () => {
    const { user, endpoints } = await userWithDevices(1);
    const r = await prisma.reminder.create({ data: { userId: user.id, title: 'Snoozy', time: '07:00', nextTriggerAt: new Date(Date.now() + 86_400_000) } });
    const occ = await prisma.reminderOccurrence.create({
      data: { reminderId: r.id, userId: user.id, scheduledFor: new Date(Date.now() - 15 * 60_000), status: 'SNOOZED', snoozedUntil: new Date(Date.now() - 30_000) },
    });
    await runSchedulerTick(new Date());
    await runSchedulerTick(new Date());
    expect(callsTo(endpoints)).toHaveLength(1);
    const after = await prisma.reminderOccurrence.findUniqueOrThrow({ where: { id: occ.id } });
    expect(after.status).toBe('SENT');
    expect(await prisma.notificationDeliveryLog.count({ where: { occurrenceId: occ.id } })).toBe(1);
  });

  it('does not throw when another tick holds the advisory lock', async () => {
    const results = await Promise.all([runSchedulerTick(new Date()), runSchedulerTick(new Date())]);
    expect(results.some((r) => r.locked)).toBe(true);
  });

  it('skips push (logged) when the user turned notifications off', async () => {
    const { user, endpoints } = await userWithDevices(1);
    await prisma.userSettings.update({ where: { userId: user.id }, data: { notificationsEnabled: false } });
    const r = await dueReminder(user.id, 1);
    await runSchedulerTick(new Date());
    expect(callsTo(endpoints)).toHaveLength(0);
    const occ = await prisma.reminderOccurrence.findFirstOrThrow({ where: { reminderId: r.id } });
    const log = await prisma.notificationDeliveryLog.findFirstOrThrow({ where: { occurrenceId: occ.id } });
    expect(log.status).toBe('SKIPPED');
  });

  it('marks past PENDING routine entries as MISSED during maintenance', async () => {
    const { user } = await createTestUser();
    const e = await prisma.dailyRoutineEntry.create({
      data: { userId: user.id, date: new Date('2026-01-01T00:00:00Z'), title: 'Old', category: 'CUSTOM', scheduledTime: '07:00', scheduledAt: new Date('2026-01-01T01:30:00Z') },
    });
    const stats = await runSchedulerTick(new Date(), { forceMaintenance: true });
    expect(stats.maintenance).toBe(true);
    expect((await prisma.dailyRoutineEntry.findUniqueOrThrow({ where: { id: e.id } })).status).toBe('MISSED');
  });
});

describe('scheduler wake planning', () => {
  const now = new Date('2026-10-25T10:00:00Z');
  const at = (ms: number) => new Date(now.getTime() + ms);

  it('sleeps until the earliest candidate, clamped to [5 s, 15 min]', () => {
    expect(computeWakeDelay(now, [at(120_000), at(60_000), null])).toBe(60_000 + 250);
    expect(computeWakeDelay(now, [at(1_000)])).toBe(MIN_SLEEP_MS);
    expect(computeWakeDelay(now, [at(-60_000)])).toBe(MIN_SLEEP_MS);
    expect(computeWakeDelay(now, [at(3 * 3600_000)])).toBe(MAX_SLEEP_MS);
    expect(computeWakeDelay(now, [])).toBe(MAX_SLEEP_MS);
    expect(computeWakeDelay(now, [null, undefined])).toBe(MAX_SLEEP_MS);
  });

  it('plans the next wake from the earliest due reminder / snooze in the database', async () => {
    const { user } = await createTestUser();
    const soon = new Date(Date.now() + 90_000);
    const r = await prisma.reminder.create({ data: { userId: user.id, title: 'Soon', time: '07:00', nextTriggerAt: soon } });
    const due = await loadNextDue();
    expect(due.nextTrigger!.getTime()).toBeLessThanOrEqual(soon.getTime());
    const delay = await nextWakeDelay(new Date());
    expect(delay).toBeGreaterThanOrEqual(MIN_SLEEP_MS);
    expect(delay).toBeLessThanOrEqual(90_000 + 250);

    const snoozeAt = new Date(Date.now() + 30_000);
    await prisma.reminderOccurrence.create({ data: { reminderId: r.id, userId: user.id, scheduledFor: new Date(), status: 'SNOOZED', snoozedUntil: snoozeAt } });
    expect((await loadNextDue()).nextSnooze!.getTime()).toBeLessThanOrEqual(snoozeAt.getTime());
    expect(await nextWakeDelay(new Date())).toBeLessThanOrEqual(30_000 + 250);
  });

  it('pokeScheduler is a no-op when the scheduler is not running', () => {
    expect(() => pokeScheduler(new Date())).not.toThrow();
    expect(() => pokeScheduler()).not.toThrow();
  });
});
