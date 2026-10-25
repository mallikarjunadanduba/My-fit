import { z } from 'zod';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

/**
 * Date conventions:
 *  - A "local date" is a 'YYYY-MM-DD' string in the user's timezone. In Postgres it is a DATE,
 *    which Prisma returns as a JS Date at 00:00 UTC. Always convert with toDbDate/fromDbDate.
 *  - A "local time" is an 'HH:mm' string in the user's timezone.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const dateString = z
  .string()
  .regex(DATE_RE, 'Expected YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && fromDbDate(toDbDate(s)) === s, 'Invalid date');

export const timeString = z.string().regex(TIME_RE, 'Expected HH:mm (24h)');

export const timezoneString = z.string().refine(isValidTimezone, 'Unknown IANA timezone');

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function toDbDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayIn(tz: string, now: Date = new Date()): string {
  return formatInTimeZone(now, tz, 'yyyy-MM-dd');
}

export function localTimeIn(tz: string, now: Date = new Date()): string {
  return formatInTimeZone(now, tz, 'HH:mm');
}

/** Converts a local date + HH:mm in `tz` to the UTC instant. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  return fromZonedTime(`${date}T${time}:00`, tz);
}

/** Local date ('YYYY-MM-DD') of an instant in `tz`. */
export function instantToLocalDate(instant: Date, tz: string): string {
  return formatInTimeZone(instant, tz, 'yyyy-MM-dd');
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(date: string): number {
  return toDbDate(date).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const d = toDbDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday-start week containing `date`. */
export function weekBounds(date: string): { from: string; to: string } {
  const wd = weekdayOf(date);
  const from = addDays(date, wd === 0 ? -6 : 1 - wd);
  return { from, to: addDays(from, 6) };
}

/** month = 'YYYY-MM' */
export function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

export const monthString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM');

/** Common ?from=&to= query with a max span guard. */
export const dateRangeQuery = z
  .object({ from: dateString, to: dateString })
  .refine((q) => q.from <= q.to, 'from must be on or before to')
  .refine((q) => dateRange(q.from, q.to).length <= 400, 'Range too large (max 400 days)');
