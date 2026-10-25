import { describe, expect, it } from 'vitest';
import { MAX_TIMER_MS, dueToRing, formatCountdown, ringKey, timerDelay, urlBase64ToUint8Array, deviceLabel } from '../../src/client/features/alarms/schedule';
import { countOverdue, withoutOverdue } from '../../src/client/features/alarms/AlarmProvider';
import { applyEntryChange, computeProgress, timelineFlags, type RoutineEntry } from '../../src/client/features/routine/types';
import { clockParts } from '../../src/client/features/alarms/format';
import type { Occurrence } from '../../src/client/features/alarms/types';

const NOW = Date.parse('2026-10-25T10:00:00Z');
const occ = (over: Partial<Occurrence> = {}): Occurrence => ({
  id: 'o1',
  reminderId: 'r1',
  scheduledFor: '2026-10-25T09:59:00Z',
  status: 'SENT',
  firedAt: null,
  actedAt: null,
  snoozedUntil: null,
  dueAt: '2026-10-25T09:59:00Z',
  inAppShownAt: null,
  reminder: { id: 'r1', title: 'Water', description: null, category: 'WATER', time: '15:29', sound: true, snoozeMinutes: 10, routineItemId: null },
  ...over,
});

describe('alarm scheduling helpers', () => {
  it('timerDelay is non-negative and capped', () => {
    expect(timerDelay('2026-10-25T09:00:00Z', NOW)).toBe(0);
    expect(timerDelay('2026-10-25T10:00:30Z', NOW)).toBe(30_000);
    expect(timerDelay('2026-10-26T10:00:00Z', NOW)).toBe(MAX_TIMER_MS);
  });

  it('dueToRing filters future, closed, shown, acked and stale occurrences', () => {
    expect(dueToRing([occ()], new Set(), NOW)).toHaveLength(1);
    expect(dueToRing([occ({ dueAt: '2026-10-25T10:05:00Z' })], new Set(), NOW)).toHaveLength(0);
    expect(dueToRing([occ({ status: 'COMPLETED' })], new Set(), NOW)).toHaveLength(0);
    expect(dueToRing([occ()], new Set([ringKey(occ())]), NOW)).toHaveLength(0);
    expect(dueToRing([occ({ inAppShownAt: '2026-10-25T09:59:30Z' })], new Set(), NOW)).toHaveLength(0);
    // Snoozed after it was shown → rings again.
    expect(dueToRing([occ({ status: 'SNOOZED', dueAt: '2026-10-25T09:59:50Z', inAppShownAt: '2026-10-25T09:49:00Z' })], new Set(), NOW)).toHaveLength(1);
    // Older than the ring window → overdue list only.
    expect(dueToRing([occ({ dueAt: '2026-10-25T09:00:00Z' })], new Set(), NOW)).toHaveLength(0);
  });

  it('formats countdowns', () => {
    expect(formatCountdown('2026-10-25T09:00:00Z', NOW)).toBe('now');
    expect(formatCountdown('2026-10-25T10:00:45Z', NOW)).toBe('in 45 s');
    expect(formatCountdown('2026-10-25T10:12:00Z', NOW)).toBe('in 12 min');
    expect(formatCountdown('2026-10-25T12:05:00Z', NOW)).toBe('in 2 h 05 min');
    expect(formatCountdown('2026-10-27T13:00:00Z', NOW)).toBe('in 2 d 3 h');
  });

  it('decodes VAPID keys and labels devices', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID-_8'))).toEqual([1, 2, 3, 251, 255]);
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36')).toBe('Chrome on Android');
    expect(deviceLabel(null)).toBe('Unknown device');
  });

  it('countOverdue does not double count routine entries covered by a reminder', () => {
    const o = occ({ reminder: { ...occ().reminder, routineItemId: 'item1' } });
    const entry = { id: 'e1', date: '2026-10-25', title: 'Lunch', category: 'LUNCH' as const, scheduledTime: '13:00', scheduledAt: '', status: 'PENDING' as const, snoozedUntil: null };
    expect(countOverdue({ occurrences: [o], routineEntries: [{ ...entry, routineItemId: 'item1' }, { ...entry, id: 'e2', routineItemId: 'item2' }] })).toBe(2);
  });

  it('timelineFlags marks overdue and next only for today', () => {
    const base: RoutineEntry = {
      id: 'a',
      date: '2026-10-25',
      routineItemId: null,
      title: 'x',
      category: 'CUSTOM',
      scheduledTime: '09:00',
      scheduledAt: '2026-10-25T09:00:00Z',
      sortOrder: 0,
      status: 'PENDING',
      completedAt: null,
      snoozedUntil: null,
      skipReason: null,
      notes: null,
    };
    const entries = [base, { ...base, id: 'b', scheduledAt: '2026-10-25T11:00:00Z' }, { ...base, id: 'c', scheduledAt: '2026-10-25T12:00:00Z' }];
    const f = timelineFlags(entries, NOW, true);
    expect([...f.overdue]).toEqual(['a']);
    expect(f.nextId).toBe('b');
    expect(timelineFlags(entries, NOW, false)).toEqual({ overdue: new Set(), nextId: null });
  });
});

describe('optimistic helpers', () => {
  const entry = {
    id: 'e1', date: '2026-10-25', routineItemId: null, title: 'Lunch', category: 'LUNCH', scheduledTime: '13:00',
    scheduledAt: '2026-10-25T07:30:00.000Z', sortOrder: 0, status: 'PENDING', completedAt: null, snoozedUntil: null, skipReason: null, notes: null,
  } as RoutineEntry;

  it('applies entry changes like the server', () => {
    const now = Date.parse('2026-10-25T08:00:00Z');
    expect(applyEntryChange(entry, { status: 'COMPLETED' }, now)).toMatchObject({ status: 'COMPLETED', completedAt: '2026-10-25T08:00:00.000Z' });
    expect(applyEntryChange(entry, { status: 'SKIPPED', skipReason: 'Busy' }, now)).toMatchObject({ status: 'SKIPPED', skipReason: 'Busy' });
    expect(applyEntryChange(entry, { snoozeMinutes: 10 }, now)).toMatchObject({ status: 'SNOOZED', snoozedUntil: '2026-10-25T08:10:00.000Z' });
    expect(applyEntryChange(entry, { scheduledTime: '13:45' }, now)).toMatchObject({ scheduledTime: '13:45', scheduledAt: '2026-10-25T08:15:00.000Z' });
    expect(computeProgress([entry, { ...entry, status: 'COMPLETED' }])).toMatchObject({ total: 2, completed: 1, pending: 1, percent: 50 });
    expect(computeProgress([]).percent).toBeNull();
  });

  it('drops acted-on items from the overdue snapshot', () => {
    const od = { occurrences: [], routineEntries: [{ id: 'r1', date: '2026-10-25', title: 'x', category: 'LUNCH' as const, scheduledTime: '13:00', scheduledAt: '', status: 'PENDING' as const, snoozedUntil: null, routineItemId: null }] };
    expect(withoutOverdue(od, 'r1').routineEntries).toHaveLength(0);
    expect(withoutOverdue(od, 'other')).toBe(od);
  });

  it('splits clock times for big displays', () => {
    expect(clockParts('07:05')).toEqual({ time: '7:05', suffix: 'AM' });
    expect(clockParts('00:30')).toEqual({ time: '12:30', suffix: 'AM' });
    expect(clockParts('22:00')).toEqual({ time: '10:00', suffix: 'PM' });
  });
});
