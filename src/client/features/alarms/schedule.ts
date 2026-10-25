import type { Occurrence } from './types';

/** Pure helpers for in-page alarm timing (unit-tested in tests/client/alarmSchedule.test.ts). */

/** Browsers clamp setTimeout to ~24.8 days; we also re-arm at least every 10 minutes to survive clock drift / sleep. */
export const MAX_TIMER_MS = 10 * 60_000;

/** Delay until `iso` (never negative), capped so long waits are re-armed periodically. */
export function timerDelay(iso: string, now = Date.now()): number {
  return Math.min(Math.max(0, new Date(iso).getTime() - now), MAX_TIMER_MS);
}

/** Key that identifies one ringing of an occurrence (a snooze re-ring is a new ringing). */
export function ringKey(o: Pick<Occurrence, 'id' | 'dueAt'>): string {
  return `${o.id}@${o.dueAt}`;
}

/** Older due occurrences are not rung on (re)open; they are listed as overdue instead. */
export const RING_WINDOW_MS = 15 * 60_000;

/**
 * Occurrences that should ring in-app now: due within RING_WINDOW_MS, still open, not yet shown in
 * this tab, and not acknowledged by any tab since they became due (server-side IN_APP ack).
 */
export function dueToRing(occurrences: Occurrence[], shown: ReadonlySet<string>, now = Date.now(), windowMs = RING_WINDOW_MS): Occurrence[] {
  return occurrences.filter((o) => {
    if (o.status === 'COMPLETED' || o.status === 'DISMISSED' || o.status === 'MISSED') return false;
    const due = new Date(o.dueAt).getTime();
    if (due > now || now - due > windowMs) return false;
    if (shown.has(ringKey(o))) return false;
    if (o.inAppShownAt && new Date(o.inAppShownAt).getTime() >= due) return false;
    return true;
  });
}

/** "in 2 h 05 min", "in 45 s", "now" */
export function formatCountdown(targetIso: string, now = Date.now()): string {
  const ms = new Date(targetIso).getTime() - now;
  if (ms <= 0) return 'now';
  const totalSec = Math.round(ms / 1000);
  const d = Math.floor(totalSec / 86_400);
  const h = Math.floor((totalSec % 86_400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (d > 0) return `in ${d} d ${h} h`;
  if (h > 0) return `in ${h} h ${String(m).padStart(2, '0')} min`;
  if (m > 0) return `in ${m} min`;
  return `in ${s} s`;
}

/** Converts a VAPID base64url public key to the Uint8Array that PushManager.subscribe expects. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Short device label from a user agent string. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown OS';
  return `${browser} on ${os}`;
}
