import { z } from 'zod';

/** Optional numeric text field: '' → null; otherwise must parse within [min, max]. */
export const optionalNumber = (min: number, max: number, opts: { integer?: boolean; label?: string } = {}) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || (!Number.isNaN(Number(v)) && Number.isFinite(Number(v))), 'Enter a number')
    .refine((v) => v === '' || (Number(v) >= min && Number(v) <= max), `Must be between ${min} and ${max}`)
    .refine((v) => v === '' || !opts.integer || Number.isInteger(Number(v)), 'Use a whole number');

export const toNumOrNull = (v: string | undefined | null): number | null => (v == null || v.trim() === '' ? null : Number(v));
export const toStrOrNull = (v: string | undefined | null): string | null => (v == null || v.trim() === '' ? null : v.trim());
export const numToField = (n: number | null | undefined) => (n == null ? '' : String(n));
