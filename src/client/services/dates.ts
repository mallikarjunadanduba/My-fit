import { format, parseISO } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

/** 'YYYY-MM-DD' for "today" in the user's timezone. */
export const todayIn = (tz: string) => formatInTimeZone(new Date(), tz, 'yyyy-MM-dd');

export const shiftDate = (date: string, days: number) => {
  const d = parseISO(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Human label for a local date string, e.g. "Sat, 25 Oct 2026". */
export const formatDay = (date: string, pattern = 'EEE, d MMM yyyy') => format(parseISO(date), pattern);

/** Format an ISO instant in the user's timezone. */
export const formatInstant = (iso: string | null | undefined, tz: string, pattern = 'HH:mm') =>
  iso ? formatInTimeZone(new Date(iso), tz, pattern) : '—';

/** "07:30" → "7:30 AM" */
export const formatClock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
};

export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
