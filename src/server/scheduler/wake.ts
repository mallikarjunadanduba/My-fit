/**
 * Wake-up planning for the scheduler, kept free of service imports so services can call
 * `pokeScheduler()` without an import cycle.
 *
 * The scheduler does not poll: after each pass it sleeps until the earliest of the next enabled
 * reminder trigger, the next snoozed occurrence and the next hourly maintenance, clamped to
 * [MIN_SLEEP_MS, MAX_SLEEP_MS] (the max is a safety net). This lets a serverless database
 * (Neon) auto-suspend between alarms instead of being queried every 30 s.
 */

export const MIN_SLEEP_MS = 5_000;
export const MAX_SLEEP_MS = 15 * 60_000;
/** Timers can fire a hair early relative to DB clocks; wake slightly after the due instant. */
export const WAKE_MARGIN_MS = 250;

/** Delay (ms) until the earliest candidate instant, clamped to [min, max]. No candidates → max. */
export function computeWakeDelay(now: Date, candidates: (Date | null | undefined)[], min = MIN_SLEEP_MS, max = MAX_SLEEP_MS): number {
  const times = candidates.filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime())).map((d) => d.getTime());
  if (times.length === 0) return max;
  const delay = Math.min(...times) - now.getTime() + WAKE_MARGIN_MS;
  return Math.min(max, Math.max(min, delay));
}

type PokeHandler = (at?: Date | null) => void;
let handler: PokeHandler | null = null;

/** Registered by the running scheduler (startScheduler); cleared by stopScheduler. */
export function setPokeHandler(h: PokeHandler | null) {
  handler = h;
}

/**
 * Tell the sleeping scheduler that something may now be due earlier than planned.
 *  - `at` = the new due instant (e.g. a reminder's nextTriggerAt or a snoozedUntil): wakes by then if earlier.
 *  - `at` omitted: wake soon (MIN_SLEEP_MS) and re-plan.
 *  - `at` = null: nothing new is due (e.g. reminder disabled) — no-op.
 * Never touches the database; a no-op when the scheduler is not running (tests, SCHEDULER_ENABLED=false).
 */
export function pokeScheduler(at?: Date | null) {
  if (at === null) return;
  handler?.(at);
}
