import 'dotenv/config';
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(60),
  // Optional one-time token required by POST /api/auth/setup in production.
  SETUP_TOKEN: z.string().optional(),
  TRUST_PROXY: bool(false),
  DEFAULT_TIMEZONE: z.string().default('Asia/Kolkata'),

  AWS_ENDPOINT_URL_S3: z.string().url().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool(true),
  MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(8 * 1024 * 1024),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  SCHEDULER_ENABLED: bool(true),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Print variable names only, never values.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
