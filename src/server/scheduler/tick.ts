import type { Reminder } from '@prisma/client';
import { prisma } from '../db';
import { alarmPayload, computeNextTrigger, triggerContextFor, type TriggerContext, type UserScheduleContext } from '../services/reminders.service';
import { sendPushToUser } from '../services/push.service';
import { ensureTodayForAllUsers, markPastRoutineEntriesMissed } from '../services/routines.service';

/**
 * One scheduler pass. Duplicate prevention:
 *  - cross-process: the whole pass runs while holding pg_try_advisory_xact_lock(SCHEDULER_LOCK_KEY)
 *    inside a transaction, so the lock is released automatically on commit, rollback or crash;
 *  - per occurrence: rows are inserted with createMany({ skipDuplicates }) on the unique
 *    (reminderId, scheduledFor) and then claimed with updateMany({ status: PENDING → SENT/MISSED });
 *    only the caller whose update count is 1 sends notifications;
 *  - per device: NotificationDeliveryLog is unique on (occurrenceId, subscriptionId, channel);
 *  - reminder advance is conditional on nextTriggerAt still being the processed value.
 */

export const SCHEDULER_LOCK_KEY = 74_210_901;
/** A reminder processed more than this late is recorded as MISSED instead of notifying. */
export const MISSED_GRACE_MS = 30 * 60_000;
const MAINTENANCE_EVERY_MS = 60 * 60_000;
const BATCH = 500;

export interface TickStats {
  locked: boolean;
  filled: number;
  fired: number;
  missed: number;
  skipped: number;
  snoozeResent: number;
  errors: number;
  maintenance: boolean;
  routineMissed: number;
}

let lastMaintenanceAt = 0;

/** When the next hourly maintenance is due (now-ish if it never ran in this process). */
export function nextMaintenanceAt(): Date {
  return new Date(lastMaintenanceAt + MAINTENANCE_EVERY_MS);
}

/** For tests: forces the hourly maintenance on the next tick. */
export function resetMaintenanceClock() {
  lastMaintenanceAt = 0;
}

type Ctx = TriggerContext & UserScheduleContext;

async function contextCache(now: Date) {
  const cache = new Map<string, Ctx>();
  return async (userId: string) => {
    let c = cache.get(userId);
    if (!c) {
      c = await triggerContextFor(userId, now);
      cache.set(userId, c);
    }
    return c;
  };
}

const later = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

async function processDueReminder(r: Reminder, ctx: Ctx, now: Date, stats: TickStats) {
  const scheduledFor = r.nextTriggerAt!;
  // Settings / day-type overrides may have changed since nextTriggerAt was computed: re-validate.
  const expected = computeNextTrigger(r, { ...ctx, now: new Date(scheduledFor.getTime() - 1) });
  const stillValid = expected?.getTime() === scheduledFor.getTime();
  const next = computeNextTrigger(r, { ...ctx, now: later(now, scheduledFor) });
  const isOneTime = Boolean(r.oneTimeDate);

  if (!stillValid) {
    await prisma.reminder.updateMany({
      where: { id: r.id, nextTriggerAt: scheduledFor },
      data: { nextTriggerAt: computeNextTrigger(r, ctx) },
    });
    stats.skipped++;
    return;
  }

  const lateMs = now.getTime() - scheduledFor.getTime();
  const missed = lateMs > MISSED_GRACE_MS;

  await prisma.reminderOccurrence.createMany({
    data: [{ reminderId: r.id, userId: r.userId, scheduledFor, status: 'PENDING' }],
    skipDuplicates: true,
  });
  const occ = await prisma.reminderOccurrence.findUniqueOrThrow({ where: { reminderId_scheduledFor: { reminderId: r.id, scheduledFor } } });
  const claim = await prisma.reminderOccurrence.updateMany({
    where: { id: occ.id, status: 'PENDING' },
    data: missed ? { status: 'MISSED', firedAt: now } : { status: 'SENT', firedAt: now },
  });
  const owned = claim.count === 1;

  // Advance first so a slow push never causes a second pass to re-process this trigger.
  await prisma.reminder.updateMany({
    where: { id: r.id, nextTriggerAt: scheduledFor },
    data: {
      nextTriggerAt: next,
      ...(owned ? { lastTriggeredAt: now } : {}),
      ...(isOneTime ? { enabled: false, nextTriggerAt: null } : {}),
    },
  });

  if (!owned) return;
  if (missed) {
    await prisma.notificationDeliveryLog.create({
      data: {
        userId: r.userId,
        reminderId: r.id,
        occurrenceId: occ.id,
        channel: 'WEB_PUSH',
        status: 'SKIPPED',
        error: `Missed: processed ${Math.round(lateMs / 60_000)} min late (server was not running); notification suppressed.`,
      },
    });
    stats.missed++;
    console.log(`[scheduler] missed "${r.title}" (${r.id}) scheduled ${scheduledFor.toISOString()}`);
    return;
  }
  const outcomes = await sendPushToUser(alarmPayload(r, occ.id), {
    userId: r.userId,
    reminderId: r.id,
    occurrenceId: occ.id,
    channel: 'WEB_PUSH',
    skipReason: ctx.notificationsEnabled ? undefined : 'Notifications are turned off in Settings.',
  });
  stats.fired++;
  const sent = outcomes.filter((o) => o.status === 'SENT').length;
  console.log(`[scheduler] fired "${r.title}" (${r.id}) → ${sent}/${outcomes.length} push sent`);
}

async function fillMissingNextTrigger(ctxFor: (u: string) => Promise<Ctx>, stats: TickStats) {
  const rows = await prisma.reminder.findMany({ where: { enabled: true, nextTriggerAt: null }, take: BATCH });
  for (const r of rows) {
    try {
      const ctx = await ctxFor(r.userId);
      const next = computeNextTrigger(r, ctx);
      if (next) {
        const res = await prisma.reminder.updateMany({ where: { id: r.id, nextTriggerAt: null }, data: { nextTriggerAt: next } });
        stats.filled += res.count;
      } else if (r.oneTimeDate) {
        // One-time reminder whose moment has passed: it can never fire again.
        await prisma.reminder.updateMany({ where: { id: r.id, nextTriggerAt: null }, data: { enabled: false } });
      }
    } catch (err) {
      stats.errors++;
      console.error(`[scheduler] could not compute next trigger for reminder ${r.id}:`, err);
    }
  }
}

async function resendSnoozed(now: Date, ctxFor: (u: string) => Promise<Ctx>, stats: TickStats) {
  const rows = await prisma.reminderOccurrence.findMany({
    where: { status: 'SNOOZED', snoozedUntil: { lte: now } },
    include: { reminder: true },
    orderBy: { snoozedUntil: 'asc' },
    take: BATCH,
  });
  for (const o of rows) {
    try {
      const lateMs = now.getTime() - o.snoozedUntil!.getTime();
      const missed = lateMs > MISSED_GRACE_MS;
      // Claim: only one pass moves SNOOZED → SENT for this snoozedUntil, so it re-sends exactly once.
      const claim = await prisma.reminderOccurrence.updateMany({
        where: { id: o.id, status: 'SNOOZED', snoozedUntil: o.snoozedUntil },
        data: missed ? { status: 'MISSED' } : { status: 'SENT', firedAt: now },
      });
      if (claim.count !== 1 || missed) continue;
      const ctx = await ctxFor(o.userId);
      await sendPushToUser(alarmPayload(o.reminder, o.id, { snoozed: true }), {
        userId: o.userId,
        reminderId: o.reminderId,
        occurrenceId: o.id,
        channel: 'WEB_PUSH',
        skipReason: ctx.notificationsEnabled ? undefined : 'Notifications are turned off in Settings.',
      });
      stats.snoozeResent++;
      console.log(`[scheduler] re-sent snoozed "${o.reminder.title}" (${o.id})`);
    } catch (err) {
      stats.errors++;
      console.error(`[scheduler] snooze re-send failed for occurrence ${o.id}:`, err);
    }
  }
}

/** Hourly: recompute future triggers (settings may have changed), close past routine days, materialise today. */
async function maintenance(now: Date, ctxFor: (u: string) => Promise<Ctx>, stats: TickStats) {
  stats.maintenance = true;
  try {
    const rows = await prisma.reminder.findMany({ where: { enabled: true, nextTriggerAt: { gt: now } }, take: 5000 });
    for (const r of rows) {
      const next = computeNextTrigger(r, await ctxFor(r.userId));
      if (next?.getTime() !== r.nextTriggerAt?.getTime()) {
        await prisma.reminder.updateMany({ where: { id: r.id, nextTriggerAt: r.nextTriggerAt }, data: { nextTriggerAt: next } });
      }
    }
  } catch (err) {
    stats.errors++;
    console.error('[scheduler] trigger recompute failed:', err);
  }
  try {
    stats.routineMissed = await markPastRoutineEntriesMissed(now);
  } catch (err) {
    stats.errors++;
    console.error('[scheduler] routine missed sweep failed:', err);
  }
  try {
    await ensureTodayForAllUsers(now);
  } catch (err) {
    stats.errors++;
    console.error('[scheduler] routine materialisation failed:', err);
  }
}

async function work(now: Date, stats: TickStats, forceMaintenance: boolean) {
  const ctxFor = await contextCache(now);
  await fillMissingNextTrigger(ctxFor, stats);

  const due = await prisma.reminder.findMany({
    where: { enabled: true, nextTriggerAt: { lte: now } },
    orderBy: { nextTriggerAt: 'asc' },
    take: BATCH,
  });
  for (const r of due) {
    try {
      await processDueReminder(r, await ctxFor(r.userId), now, stats);
    } catch (err) {
      stats.errors++;
      console.error(`[scheduler] reminder ${r.id} failed:`, err);
    }
  }

  await resendSnoozed(now, ctxFor, stats);

  if (forceMaintenance || now.getTime() - lastMaintenanceAt >= MAINTENANCE_EVERY_MS) {
    lastMaintenanceAt = now.getTime();
    await maintenance(now, ctxFor, stats);
  }
}

/**
 * Runs one pass if this process can take the advisory lock; otherwise returns { locked: false }.
 * The lock is a transaction-level lock held on a dedicated connection for the pass's duration.
 */
export async function runSchedulerTick(now = new Date(), opts: { forceMaintenance?: boolean } = {}): Promise<TickStats> {
  const stats: TickStats = { locked: false, filled: 0, fired: 0, missed: 0, skipped: 0, snoozeResent: 0, errors: 0, maintenance: false, routineMissed: 0 };
  await prisma.$transaction(
    async (tx) => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${SCHEDULER_LOCK_KEY}::bigint) AS locked`;
      if (!row?.locked) return;
      stats.locked = true;
      await work(now, stats, opts.forceMaintenance ?? false);
    },
    { maxWait: 10_000, timeout: 10 * 60_000 },
  );
  return stats;
}
