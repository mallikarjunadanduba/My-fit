import { prisma } from '../db';
import { nextMaintenanceAt, runSchedulerTick } from './tick';
import { computeWakeDelay, MAX_SLEEP_MS, MIN_SLEEP_MS, setPokeHandler } from './wake';

export { runSchedulerTick, SCHEDULER_LOCK_KEY, MISSED_GRACE_MS } from './tick';
export { computeWakeDelay, pokeScheduler, MIN_SLEEP_MS, MAX_SLEEP_MS } from './wake';

/**
 * In-process reminder scheduler. One timer per process (module-level guard); a pass never overlaps
 * another; across instances only the holder of the Postgres advisory lock works.
 *
 * Instead of polling, it sleeps until the next thing is due (see ./wake.ts): earliest enabled
 * Reminder.nextTriggerAt, earliest SNOOZED occurrence, next hourly maintenance — clamped to
 * [5 s, 15 min]. Services call pokeScheduler() when a change can make something due earlier.
 * Delivery timing depends on this process being awake — hosts that sleep idle apps delay reminders
 * (late ones beyond 30 min are recorded as MISSED rather than sent).
 */

let started = false;
let timer: NodeJS.Timeout | null = null;
let wakeAt = 0;
let running = false;
let pokedWhileRunning = false;

/** Earliest due instants in ONE query (two indexed MIN lookups). */
export async function loadNextDue(): Promise<{ nextTrigger: Date | null; nextSnooze: Date | null }> {
  const [row] = await prisma.$queryRaw<{ next_trigger: Date | null; next_snooze: Date | null }[]>`
    SELECT (SELECT min("nextTriggerAt") FROM "Reminder" WHERE enabled AND "nextTriggerAt" IS NOT NULL) AS next_trigger,
           (SELECT min("snoozedUntil") FROM "ReminderOccurrence" WHERE status = 'SNOOZED') AS next_snooze`;
  return { nextTrigger: row?.next_trigger ?? null, nextSnooze: row?.next_snooze ?? null };
}

/** How long the scheduler should sleep after a pass that ended at `now`. */
export async function nextWakeDelay(now = new Date()): Promise<number> {
  const { nextTrigger, nextSnooze } = await loadNextDue();
  return computeWakeDelay(now, [nextTrigger, nextSnooze, nextMaintenanceAt()]);
}

function schedule(delayMs: number) {
  if (!started) return;
  if (timer) clearTimeout(timer);
  wakeAt = Date.now() + delayMs;
  timer = setTimeout(() => void loop(), delayMs);
  timer.unref?.();
}

async function loop() {
  if (running) {
    pokedWhileRunning = true;
    return;
  }
  running = true;
  timer = null;
  let delay = MAX_SLEEP_MS;
  try {
    const s = await runSchedulerTick();
    if (s.fired || s.missed || s.snoozeResent || s.errors || s.skipped) {
      console.log(
        `[scheduler] tick: fired=${s.fired} missed=${s.missed} snoozeResent=${s.snoozeResent} skipped=${s.skipped} filled=${s.filled} errors=${s.errors}`,
      );
    }
    delay = await nextWakeDelay();
  } catch (err) {
    console.error('[scheduler] tick failed:', err instanceof Error ? err.message : err);
    delay = 60_000;
  } finally {
    running = false;
  }
  if (pokedWhileRunning) {
    pokedWhileRunning = false;
    delay = MIN_SLEEP_MS;
  }
  schedule(delay);
}

function onPoke(at?: Date | null) {
  if (!started) return;
  if (running) {
    pokedWhileRunning = true;
    return;
  }
  const delay = at ? computeWakeDelay(new Date(), [at]) : MIN_SLEEP_MS;
  if (Date.now() + delay < wakeAt) schedule(delay);
}

export function startScheduler() {
  if (started) return;
  started = true;
  setPokeHandler(onPoke);
  console.log(`[scheduler] started (sleeps until the next due reminder, ${MIN_SLEEP_MS / 1000}s–${MAX_SLEEP_MS / 60_000}min)`);
  void loop();
}

export function stopScheduler() {
  if (!started) return;
  started = false;
  setPokeHandler(null);
  if (timer) clearTimeout(timer);
  timer = null;
  console.log('[scheduler] stopped');
}
