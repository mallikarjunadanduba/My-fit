import { useCallback, useEffect, useReducer, useRef } from 'react';

/**
 * Rest timer built on absolute timestamps rather than tick counting, so it stays accurate when the
 * tab is backgrounded or the device sleeps (browsers throttle intervals; Date.now() keeps moving).
 */

export type RestTimerStatus = 'idle' | 'running' | 'paused' | 'done';

export interface RestTimerState {
  status: RestTimerStatus;
  /** Total length of the current countdown in ms (grows with +15s). */
  durationMs: number;
  /** Epoch ms when a running timer reaches zero. */
  endsAt: number | null;
  /** Remaining ms while paused / idle. */
  pausedRemainingMs: number;
}

export type RestTimerAction =
  | { type: 'start'; seconds: number; now: number }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'reset' }
  | { type: 'add'; seconds: number; now: number }
  | { type: 'complete' };

export const initialRestTimer: RestTimerState = { status: 'idle', durationMs: 0, endsAt: null, pausedRemainingMs: 0 };

export function remainingMs(s: RestTimerState, now: number): number {
  if (s.status === 'running' && s.endsAt != null) return Math.max(0, s.endsAt - now);
  if (s.status === 'done') return 0;
  return s.pausedRemainingMs;
}

export function restTimerReducer(s: RestTimerState, a: RestTimerAction): RestTimerState {
  switch (a.type) {
    case 'start': {
      const ms = Math.max(0, Math.round(a.seconds * 1000));
      if (ms === 0) return initialRestTimer;
      return { status: 'running', durationMs: ms, endsAt: a.now + ms, pausedRemainingMs: 0 };
    }
    case 'pause':
      if (s.status !== 'running') return s;
      return { ...s, status: 'paused', endsAt: null, pausedRemainingMs: remainingMs(s, a.now) };
    case 'resume':
      if (s.status !== 'paused' || s.pausedRemainingMs <= 0) return s;
      return { ...s, status: 'running', endsAt: a.now + s.pausedRemainingMs, pausedRemainingMs: 0 };
    case 'reset':
      // Back to the full length, not running. start() without seconds restarts it.
      return { status: 'idle', durationMs: s.durationMs, endsAt: null, pausedRemainingMs: s.durationMs };
    case 'add': {
      const ms = Math.round(a.seconds * 1000);
      if (s.status === 'running' && s.endsAt != null) {
        const left = Math.max(0, s.endsAt - a.now) + ms;
        return { ...s, durationMs: s.durationMs + ms, endsAt: a.now + Math.max(0, left) };
      }
      if (s.status === 'paused' || s.status === 'idle') {
        const left = Math.max(0, s.pausedRemainingMs + ms);
        return { ...s, durationMs: Math.max(0, s.durationMs + ms), pausedRemainingMs: left };
      }
      // done → start a fresh short countdown
      return { status: 'running', durationMs: ms, endsAt: a.now + ms, pausedRemainingMs: 0 };
    }
    case 'complete':
      if (s.status !== 'running') return s;
      return { ...s, status: 'done', endsAt: null, pausedRemainingMs: 0 };
  }
}

export interface UseRestTimerOptions {
  /** Called once when a running countdown reaches zero. */
  onComplete?: () => void;
  /** Re-render interval while running (display only; accuracy comes from timestamps). */
  tickMs?: number;
}

export function useRestTimer({ onComplete, tickMs = 250 }: UseRestTimerOptions = {}) {
  const [state, dispatch] = useReducer(restTimerReducer, initialRestTimer);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  // While running: re-render periodically and detect completion via the timestamp.
  useEffect(() => {
    if (state.status !== 'running' || state.endsAt == null) return;
    const endsAt = state.endsAt;
    let fired = false;
    const check = () => {
      if (fired) return;
      if (Date.now() >= endsAt) {
        fired = true;
        dispatch({ type: 'complete' });
        onCompleteRef.current?.();
      } else {
        forceRender();
      }
    };
    const interval = setInterval(check, tickMs);
    // A timeout at the exact end fires even if intervals are throttled less aggressively.
    const timeout = setTimeout(check, Math.max(0, endsAt - Date.now()));
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [state.status, state.endsAt, tickMs]);

  const start = useCallback((seconds?: number) => {
    dispatch({ type: 'start', seconds: seconds ?? 0, now: Date.now() });
  }, []);
  const lastDuration = state.durationMs;
  const restart = useCallback(() => dispatch({ type: 'start', seconds: lastDuration / 1000, now: Date.now() }), [lastDuration]);
  const pause = useCallback(() => dispatch({ type: 'pause', now: Date.now() }), []);
  const resume = useCallback(() => dispatch({ type: 'resume', now: Date.now() }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);
  const addSeconds = useCallback((seconds: number) => dispatch({ type: 'add', seconds, now: Date.now() }), []);

  const remaining = remainingMs(state, Date.now());
  return {
    status: state.status,
    remainingMs: remaining,
    remainingSec: Math.ceil(remaining / 1000),
    durationMs: state.durationMs,
    progress: state.durationMs > 0 ? 1 - remaining / state.durationMs : 0,
    start,
    restart,
    pause,
    resume,
    reset,
    addSeconds,
  };
}

/** 95 → "1:35" */
export function formatCountdown(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
