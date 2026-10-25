import { useCallback, useEffect, useRef, useState } from 'react';
import { toApiError, type ApiError } from '../services/api';

/**
 * Stale-while-revalidate cache shared by every useAsync call: revisiting a screen shows the last
 * response immediately while a fresh request runs. Cleared on logout.
 */
const cache = new Map<string, unknown>();
const MAX_ENTRIES = 200;

export function clearAsyncCache() {
  cache.clear();
}

export interface UseAsyncOptions {
  /** Explicit cache key; defaults to the loader's source + deps. Pass `false` to disable caching. */
  cacheKey?: string | false;
}

/**
 * Runs `fn` on mount and whenever `deps` change. Exposes loading/error/data and `reload()`.
 * `loading` is only true when there is nothing to show yet; `refreshing` is true while a
 * background refresh runs over cached data. `setData` allows local updates after mutations.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = [], options: UseAsyncOptions = {}) {
  const depsKey = JSON.stringify(deps);
  const key = options.cacheKey === false ? null : (options.cacheKey ?? `${fn.toString()}|${depsKey}`);
  const cached = key != null && cache.has(key) ? (cache.get(key) as T) : undefined;

  const [data, setDataState] = useState<T | undefined>(cached);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(cached === undefined);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);
  // Always call the latest `fn`/key without making them dependencies (callers pass inline closures).
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const keyRef = useRef(key);
  keyRef.current = key;

  const remember = (value: T) => {
    const k = keyRef.current;
    if (k == null) return;
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(k, value);
  };

  const setData: typeof setDataState = useCallback((update) => {
    setDataState((prev) => {
      const next = typeof update === 'function' ? (update as (p: T | undefined) => T | undefined)(prev) : update;
      if (next !== undefined) remember(next);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    const k = keyRef.current;
    const hasCached = k != null && cache.has(k);
    if (hasCached) {
      setDataState(cache.get(k) as T);
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await fnRef.current();
      if (id === seq.current) {
        remember(result);
        setDataState(result);
      }
    } catch (e) {
      if (id === seq.current) setError(toApiError(e));
    } finally {
      if (id === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, depsKey]);

  return { data, setData, error, loading, refreshing, reload };
}
