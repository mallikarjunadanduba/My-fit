import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { todayIn } from '../../services/dates';
import { useAuth } from '../auth/AuthContext';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isValidDate = (s: string | null): s is string =>
  !!s && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/** Selected local date kept in the `?date=YYYY-MM-DD` query param (defaults to today in the user's timezone). */
export function useDateParam(): [string, (d: string) => void] {
  const { timezone } = useAuth();
  const [params, setParams] = useSearchParams();
  const raw = params.get('date');
  const date = isValidDate(raw) ? raw : todayIn(timezone);
  const setDate = useCallback(
    (d: string) =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.set('date', d);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [date, setDate];
}
