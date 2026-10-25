import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatCountdown, initialRestTimer, remainingMs, restTimerReducer, useRestTimer } from '../../src/client/features/workouts/useRestTimer';

describe('restTimerReducer (pure)', () => {
  it('computes remaining time from timestamps', () => {
    let s = restTimerReducer(initialRestTimer, { type: 'start', seconds: 90, now: 1_000 });
    expect(s.status).toBe('running');
    expect(remainingMs(s, 31_000)).toBe(60_000);
    s = restTimerReducer(s, { type: 'pause', now: 31_000 });
    expect(s.status).toBe('paused');
    expect(remainingMs(s, 999_999)).toBe(60_000); // frozen while paused
    s = restTimerReducer(s, { type: 'resume', now: 100_000 });
    expect(remainingMs(s, 110_000)).toBe(50_000);
    s = restTimerReducer(s, { type: 'add', seconds: 15, now: 110_000 });
    expect(remainingMs(s, 110_000)).toBe(65_000);
    expect(s.durationMs).toBe(105_000);
    s = restTimerReducer(s, { type: 'reset' });
    expect(s.status).toBe('idle');
    expect(remainingMs(s, 0)).toBe(105_000);
  });

  it('ignores invalid transitions', () => {
    const idle = initialRestTimer;
    expect(restTimerReducer(idle, { type: 'pause', now: 0 })).toBe(idle);
    expect(restTimerReducer(idle, { type: 'resume', now: 0 })).toBe(idle);
    expect(restTimerReducer(idle, { type: 'complete' })).toBe(idle);
    expect(restTimerReducer(idle, { type: 'start', seconds: 0, now: 0 }).status).toBe('idle');
  });

  it('formats countdowns', () => {
    expect(formatCountdown(95)).toBe('1:35');
    expect(formatCountdown(5)).toBe('0:05');
    expect(formatCountdown(3725)).toBe('1:02:05');
    expect(formatCountdown(-3)).toBe('0:00');
  });
});

describe('useRestTimer (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T10:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('counts down, pauses, resumes, adds time and completes once', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useRestTimer({ onComplete }));
    expect(result.current.status).toBe('idle');

    act(() => result.current.start(60));
    expect(result.current.status).toBe('running');
    expect(result.current.remainingSec).toBe(60);

    act(() => vi.advanceTimersByTime(20_000));
    expect(result.current.remainingSec).toBe(40);

    act(() => result.current.pause());
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current.status).toBe('paused');
    expect(result.current.remainingSec).toBe(40);

    act(() => result.current.resume());
    act(() => result.current.addSeconds(15));
    expect(result.current.remainingSec).toBe(55);

    act(() => vi.advanceTimersByTime(54_000));
    expect(result.current.remainingSec).toBe(1);
    expect(onComplete).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current.status).toBe('done');
    expect(result.current.remainingMs).toBe(0);
    expect(onComplete).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(10_000));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('stays accurate when ticks are throttled (background tab): elapsed wall time wins', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useRestTimer({ onComplete, tickMs: 250 }));
    act(() => result.current.start(90));
    // Simulate the browser not running timers for 30s: move the clock without firing timers.
    act(() => {
      vi.setSystemTime(new Date(Date.now() + 30_000));
    });
    // Next render (e.g. visibilitychange or the next tick) reflects real elapsed time.
    act(() => vi.advanceTimersByTime(250));
    expect(result.current.remainingSec).toBeLessThanOrEqual(60);
    expect(result.current.remainingSec).toBeGreaterThanOrEqual(59);

    // Clock jumps past the end while throttled: completes on the next check.
    act(() => {
      vi.setSystemTime(new Date(Date.now() + 120_000));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => vi.advanceTimersByTime(250));
    expect(result.current.status).toBe('done');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('reset returns to the full duration and restart runs it again', () => {
    const { result } = renderHook(() => useRestTimer());
    act(() => result.current.start(30));
    act(() => vi.advanceTimersByTime(10_000));
    act(() => result.current.reset());
    expect(result.current.status).toBe('idle');
    expect(result.current.remainingSec).toBe(30);
    act(() => result.current.restart());
    act(() => vi.advanceTimersByTime(5_000));
    expect(result.current.remainingSec).toBe(25);
  });
});

describe('session optimistic helpers', async () => {
  const { applySetPatch, mergeSetResponse, addTempSet, replaceSet, removeSet, computeStats } = await import('../../src/client/features/workouts/sessionState');
  const set = (id: string, n: number, extra = {}) => ({ id, setNumber: n, reps: 8, weightKg: 50, durationSec: null, completed: false, completedAt: null, ...extra });
  const base = () => ({
    id: 's1', date: '2026-10-25', name: 'Push', status: 'PLANNED' as const, notes: null, startedAt: null, finishedAt: null, createdAt: '', workoutDayId: null, workoutDay: null, durationSec: null,
    stats: computeStats([]),
    entries: [{ id: 'e1', exerciseId: null, exerciseName: 'Bench', exercise: null, sortOrder: 0, status: 'PENDING' as const, restSec: 90, notes: null, sets: [set('a', 1), set('b', 2)] }],
  });

  it('ticking sets starts the session, completes the exercise and updates stats', () => {
    let s = applySetPatch(base(), 'a', { completed: true });
    expect(s.status).toBe('IN_PROGRESS');
    expect(s.entries[0].status).toBe('PENDING');
    s = applySetPatch(s, 'b', { completed: true, reps: 10 });
    expect(s.entries[0].status).toBe('COMPLETED');
    expect(s.stats).toMatchObject({ completedSets: 2, volumeKg: 900 });
  });

  it('merges server answers and skips stale set values', () => {
    const s = applySetPatch(base(), 'a', { reps: 12 });
    const r = { set: set('a', 1, { reps: 9 }), entry: { id: 'e1', status: 'PENDING' as const }, session: { id: 's1', status: 'IN_PROGRESS' as const, startedAt: 'x' } };
    expect(mergeSetResponse(s, r, { includeSet: false }).entries[0].sets[0].reps).toBe(12);
    expect(mergeSetResponse(s, r).entries[0].sets[0].reps).toBe(9);
  });

  it('adds placeholder sets and renumbers after delete', () => {
    let s = addTempSet(base(), 'e1', 'tmp-1');
    expect(s.entries[0].sets[2]).toMatchObject({ id: 'tmp-1', setNumber: 3, reps: 8 });
    s = replaceSet(s, 'e1', 'tmp-1', set('c', 3));
    s = removeSet(s, 'a');
    expect(s.entries[0].sets.map((x) => [x.id, x.setNumber])).toEqual([['b', 1], ['c', 2]]);
  });
});
