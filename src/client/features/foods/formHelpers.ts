import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import type { UseFormRegisterReturn } from 'react-hook-form';
import type { ApiError } from '../../services/api';

/** Adapts react-hook-form `register()` to MUI TextField (ref goes to the <input>). */
export function muiField(r: UseFormRegisterReturn) {
  const { ref, ...rest } = r;
  return { ...rest, inputRef: ref };
}

/** Human message for an API error, including the first field error if present. */
export function errorMessage(e: unknown): string {
  const err = e as ApiError;
  const details = err?.details as { fieldErrors?: Record<string, string[] | string>; formErrors?: string[] } | undefined;
  const first = details?.fieldErrors && Object.values(details.fieldErrors)[0];
  const fieldMsg = (Array.isArray(first) ? first[0] : first) ?? details?.formErrors?.[0];
  const base = err?.message ?? 'Something went wrong';
  return fieldMsg ? `${base}: ${fieldMsg}` : base;
}

/** Current wall-clock "HH:mm" in a timezone. */
export const nowTimeIn = (tz: string) => formatInTimeZone(new Date(), tz, 'HH:mm');

/** Local date + "HH:mm" in tz → ISO instant string. */
export const localToIso = (date: string, time: string, tz: string) => fromZonedTime(`${date}T${time}:00`, tz).toISOString();

/** ISO instant → "HH:mm" in tz. */
export const isoToTime = (iso: string, tz: string) => formatInTimeZone(new Date(iso), tz, 'HH:mm');

/** Parses a numeric text input; '' → NaN so zod reports it as required. */
export const num = (v: unknown) => (v === '' || v == null ? NaN : Number(v));
