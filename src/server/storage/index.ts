import {
  DeleteObjectCommand,
  GetBucketPolicyCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env';
import { AppError } from '../lib/http';

/**
 * S3-compatible media storage adapter (Neon object storage in production).
 *
 * Security notes:
 *  - Credentials stay on the server; clients only ever receive time-limited presigned GET URLs.
 *  - Never build public object URLs: object keys are unguessable, but a bucket may have a public-read
 *    policy, so the URL itself is the only secret. `getBucketPolicyPublic()` lets the UI warn about that.
 */

const REQUIRED_VARS = ['AWS_ENDPOINT_URL_S3', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'S3_BUCKET'] as const;

function missingVars(): string[] {
  return REQUIRED_VARS.filter((name) => !env[name] || String(env[name]).trim() === '');
}

let client: S3Client | null = null;

function getClient(): S3Client {
  const missing = missingVars();
  if (missing.length) {
    throw new AppError(
      503,
      'STORAGE_NOT_CONFIGURED',
      `Media storage is not configured. Set these environment variables on the server: ${missing.join(', ')} (optionally AWS_REGION, S3_FORCE_PATH_STYLE).`,
    );
  }
  if (!client) {
    client = new S3Client({
      endpoint: env.AWS_ENDPOINT_URL_S3,
      region: env.AWS_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID!, secretAccessKey: env.AWS_SECRET_ACCESS_KEY! },
      // S3-compatible providers do not all support the newer default request checksums.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }
  return client;
}

function bucket(): string {
  return env.S3_BUCKET!.trim();
}

function storageError(action: string, err: unknown): AppError {
  const status = err instanceof S3ServiceException ? err.$metadata?.httpStatusCode : undefined;
  console.error(`[storage] ${action} failed`, err instanceof Error ? `${err.name}: ${err.message}` : err);
  return new AppError(502, 'STORAGE_ERROR', `Media storage ${action} failed${status ? ` (HTTP ${status})` : ''}. Please try again.`);
}

const POLICY_CACHE_MS = 10 * 60_000;
let policyCache: { at: number; value: boolean | null } | null = null;

let policyInflight: Promise<boolean | null> | null = null;

/** Fetches the bucket policy once (concurrent callers share the request) and caches the verdict. */
function refreshPolicy(): Promise<boolean | null> {
  if (policyInflight) return policyInflight;
  policyInflight = (async () => {
    let value: boolean | null;
    try {
      const r = await getClient().send(new GetBucketPolicyCommand({ Bucket: bucket() }), { abortSignal: AbortSignal.timeout(5000) });
      value = r.Policy ? policyAllowsPublicRead(r.Policy) : false;
    } catch (err) {
      value = err instanceof S3ServiceException && err.name === 'NoSuchBucketPolicy' ? false : null;
    }
    policyCache = { at: Date.now(), value };
    return value;
  })().finally(() => {
    policyInflight = null;
  });
  return policyInflight;
}

/** True when a bucket policy statement allows anonymous s3:GetObject. */
export function policyAllowsPublicRead(policyJson: string): boolean {
  let doc: unknown;
  try {
    doc = JSON.parse(policyJson);
  } catch {
    return false;
  }
  const statements = (doc as { Statement?: unknown }).Statement;
  const list = Array.isArray(statements) ? statements : statements ? [statements] : [];
  return list.some((raw) => {
    const s = raw as { Effect?: string; Principal?: unknown; Action?: unknown; Condition?: unknown };
    if (s.Effect !== 'Allow') return false;
    const p = s.Principal;
    const anyone =
      p === '*' ||
      (typeof p === 'object' &&
        p !== null &&
        [(p as { AWS?: unknown }).AWS].flat().some((v) => v === '*'));
    if (!anyone) return false;
    const actions = [s.Action].flat().filter((a): a is string => typeof a === 'string').map((a) => a.toLowerCase());
    return actions.some((a) => a === '*' || a === 's3:*' || a === 's3:getobject' || a === 's3:get*');
  });
}

export const storage = {
  isConfigured(): boolean {
    return missingVars().length === 0;
  },

  /** Throws 503 STORAGE_NOT_CONFIGURED (listing the missing env var names) when not configured. */
  assertConfigured(): void {
    getClient();
  },

  /** Bucket name when configured, else null. */
  bucketName(): string | null {
    return storage.isConfigured() ? bucket() : null;
  },

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const s3 = getClient();
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
          CacheControl: 'private, max-age=86400',
        }),
      );
    } catch (err) {
      throw storageError('upload', err);
    }
  },

  /** Time-limited presigned GET URL. Computed locally — no network call. */
  async getSignedGetUrl(key: string, ttlSeconds: number = env.SIGNED_URL_TTL_SECONDS): Promise<string> {
    const s3 = getClient();
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: ttlSeconds });
  },

  async deleteObject(key: string): Promise<void> {
    const s3 = getClient();
    try {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    } catch (err) {
      if (err instanceof S3ServiceException && (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404)) return;
      throw storageError('delete', err);
    }
  },

  /** Object metadata, or null when the object does not exist. */
  async headObject(key: string): Promise<{ contentLength: number | null; contentType: string | null } | null> {
    const s3 = getClient();
    try {
      const r = await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return { contentLength: r.ContentLength ?? null, contentType: r.ContentType ?? null };
    } catch (err) {
      if (err instanceof S3ServiceException && (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404)) return null;
      throw storageError('lookup', err);
    }
  },

  /**
   * Whether the bucket policy grants anonymous reads. Cached for ~10 minutes.
   * false = no policy / no public statement; null = could not be determined (or not configured).
   */
  async getBucketPolicyPublic(): Promise<boolean | null> {
    if (!storage.isConfigured()) return null;
    if (policyCache && Date.now() - policyCache.at < POLICY_CACHE_MS) return policyCache.value;
    return refreshPolicy();
  },

  /**
   * Non-blocking variant for request handlers: returns the last known value immediately (null when it
   * has never been checked) and refreshes it in the background when stale. Never waits on S3.
   */
  cachedBucketPolicyPublic(): boolean | null {
    if (!storage.isConfigured()) return null;
    if (!policyCache || Date.now() - policyCache.at >= POLICY_CACHE_MS) void refreshPolicy();
    return policyCache?.value ?? null;
  },
};

export type Storage = typeof storage;
