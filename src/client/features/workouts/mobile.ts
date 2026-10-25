import { useEffect } from 'react';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  released?: boolean;
}

/** Keeps the screen awake while `active` (guarded: no-op where the Wake Lock API is missing). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    const wl = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (!active || !wl) return;
    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (document.visibilityState !== 'visible') return;
        const s = await wl.request('screen');
        if (cancelled) void s.release().catch(() => undefined);
        else sentinel = s;
      } catch {
        // Denied (battery saver, unsupported context) — the app works without it.
      }
    };
    // The lock is released automatically when the tab is hidden; re-acquire when visible again.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
