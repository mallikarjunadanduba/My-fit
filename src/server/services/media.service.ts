import crypto from 'node:crypto';
import { Prisma, type MediaAsset, type MediaKind } from '@prisma/client';
import { prisma, type Db } from '../db';
import { env } from '../env';
import { AppError, notFound, pageMeta } from '../lib/http';
import { storage } from '../storage';

/** Allowed upload types, verified by magic bytes (the declared mimetype is not trusted). */
export const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

const EXT: Record<AllowedMediaType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** Detects JPEG / PNG / WebP from the file signature. Returns null for anything else. */
export function detectImageType(buf: Buffer): AllowedMediaType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** users/<userId>/<kind>/<yyyy>/<mm>/<uuid>.<ext> — never contains the original filename. */
export function buildObjectKey(userId: string, kind: MediaKind, mime: AllowedMediaType, now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `users/${userId}/${kind.toLowerCase()}/${yyyy}/${mm}/${crypto.randomUUID()}.${EXT[mime]}`;
}

export interface MediaDto {
  id: string;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  originalName: string | null;
  notes: string | null;
  takenAt: string | null;
  createdAt: string;
  url: string;
  urlExpiresAt: string;
}

async function toDto(a: MediaAsset): Promise<MediaDto> {
  const ttl = env.SIGNED_URL_TTL_SECONDS;
  const url = await storage.getSignedGetUrl(a.objectKey, ttl);
  return {
    id: a.id,
    kind: a.kind,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    originalName: a.originalName,
    notes: a.notes,
    takenAt: a.takenAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    url,
    urlExpiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  };
}

export function getMediaStatus() {
  const configured = storage.isConfigured();
  return {
    configured,
    bucket: storage.bucketName(),
    // Never blocks on S3: last known verdict, refreshed in the background (null until the first check finishes).
    publicReadPolicyDetected: configured ? storage.cachedBucketPolicyPublic() : null,
    maxBytes: env.MEDIA_MAX_BYTES,
    allowedTypes: [...ALLOWED_MEDIA_TYPES],
    signedUrlTtlSeconds: env.SIGNED_URL_TTL_SECONDS,
  };
}

export interface UploadInput {
  userId: string;
  kind: MediaKind;
  buffer: Buffer;
  declaredMime: string;
  originalName?: string | null;
  notes?: string | null;
  takenAt?: Date | null;
}

export async function uploadMedia(input: UploadInput): Promise<MediaDto> {
  if (!storage.isConfigured()) storage.assertConfigured();
  if (input.buffer.length === 0) throw new AppError(400, 'EMPTY_FILE', 'The uploaded file is empty.');
  if (input.buffer.length > env.MEDIA_MAX_BYTES) {
    throw new AppError(413, 'FILE_TOO_LARGE', `File is larger than ${Math.round(env.MEDIA_MAX_BYTES / 1024 / 1024)} MB.`);
  }
  const detected = detectImageType(input.buffer);
  if (!detected) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only JPEG, PNG or WebP images are allowed (file contents did not match an allowed image type).');
  }

  const bucketName = storage.bucketName()!;
  const asset = await prisma.mediaAsset.create({
    data: {
      userId: input.userId,
      kind: input.kind,
      bucket: bucketName,
      objectKey: buildObjectKey(input.userId, input.kind, detected),
      mimeType: detected,
      sizeBytes: input.buffer.length,
      originalName: input.originalName ? input.originalName.slice(0, 200) : null,
      notes: input.notes ?? null,
      takenAt: input.takenAt ?? null,
      status: 'PENDING',
    },
  });

  try {
    await storage.putObject(asset.objectKey, input.buffer, detected);
  } catch (err) {
    await prisma.mediaAsset.delete({ where: { id: asset.id } }).catch(() => undefined);
    if (err instanceof AppError) throw err;
    throw new AppError(502, 'STORAGE_ERROR', 'Could not store the file. Please try again.');
  }

  const ready = await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: 'READY' } });
  return toDto(ready);
}

async function findReady(userId: string, id: string, db: Db = prisma) {
  const a = await db.mediaAsset.findFirst({ where: { id, userId, status: 'READY' } });
  if (!a) throw notFound('Media');
  return a;
}

/** Throws 404 unless `mediaId` is a READY asset owned by `userId`. Use before linking media to a record. */
export async function assertOwnedMedia(userId: string, mediaId: string, db: Db = prisma): Promise<void> {
  await findReady(userId, mediaId, db);
}

export async function getMedia(userId: string, id: string) {
  return toDto(await findReady(userId, id));
}

export async function listMedia(userId: string, q: { kind?: MediaKind; page: number; pageSize: number }) {
  const where = { userId, status: 'READY' as const, ...(q.kind ? { kind: q.kind } : {}) };
  const [rows, total] = await Promise.all([
    prisma.mediaAsset.findMany({
      where,
      orderBy: [{ takenAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    prisma.mediaAsset.count({ where }),
  ]);
  return { data: await Promise.all(rows.map(toDto)), meta: pageMeta(q.page, q.pageSize, total) };
}

/** Several assets at once (for galleries/lists): READY assets owned by the user, in the requested order; missing ids are skipped. */
export async function getMediaBatch(userId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await prisma.mediaAsset.findMany({ where: { id: { in: ids }, userId, status: 'READY' } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return Promise.all(ids.flatMap((id) => (byId.has(id) ? [toDto(byId.get(id)!)] : [])));
}

export async function updateMedia(userId: string, id: string, patch: { notes?: string | null; takenAt?: Date | null }) {
  try {
    // Single UPDATE … WHERE id AND userId AND READY.
    const a = await prisma.mediaAsset.update({ where: { id, userId, status: 'READY' }, data: patch });
    return toDto(a);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw notFound('Media');
    throw err;
  }
}

/** Deletes the object, soft-deletes the row, and clears every reference to it (one SQL statement). */
export async function deleteMedia(userId: string, id: string): Promise<void> {
  const a = await findReady(userId, id);
  await storage.deleteObject(a.objectKey);
  await prisma.$executeRaw`
    WITH m AS (
      UPDATE "MediaAsset" SET status = 'DELETED', "deletedAt" = now(), "updatedAt" = now() WHERE id = ${id}::uuid AND "userId" = ${userId}::uuid RETURNING id
    ), f AS (
      UPDATE "FoodItem" SET "imageMediaId" = NULL, "updatedAt" = now() WHERE "userId" = ${userId}::uuid AND "imageMediaId" = ${id}::uuid RETURNING id
    ), x AS (
      UPDATE "Exercise" SET "imageMediaId" = NULL, "updatedAt" = now() WHERE "userId" = ${userId}::uuid AND "imageMediaId" = ${id}::uuid RETURNING id
    ), b AS (
      UPDATE "BodyMeasurement" SET "photoMediaId" = NULL, "updatedAt" = now() WHERE "userId" = ${userId}::uuid AND "photoMediaId" = ${id}::uuid RETURNING id
    )
    UPDATE "UserSettings" SET "profileMediaId" = NULL, "updatedAt" = now() WHERE "userId" = ${userId}::uuid AND "profileMediaId" = ${id}::uuid`;
}

/**
 * Contract for other modules: fresh signed URL for a READY asset owned by `userId`,
 * or null when the asset is missing/not ready/foreign or storage is not configured.
 */
export async function signedUrlForMedia(mediaId: string | null | undefined, userId: string): Promise<string | null> {
  if (!mediaId || !storage.isConfigured()) return null;
  const a = await prisma.mediaAsset.findFirst({ where: { id: mediaId, userId, status: 'READY' }, select: { objectKey: true } });
  if (!a) return null;
  return storage.getSignedGetUrl(a.objectKey);
}

/**
 * Removes uploads that never completed (PENDING older than the threshold): object (if any) + row.
 * Safe to call from the scheduler. Does nothing when storage is not configured.
 */
export async function cleanupOrphanMedia(olderThanHours = 24): Promise<{ deleted: number; failed: number; skipped: boolean }> {
  if (!storage.isConfigured()) return { deleted: 0, failed: 0, skipped: true };
  const cutoff = new Date(Date.now() - olderThanHours * 3600_000);
  const stale = await prisma.mediaAsset.findMany({ where: { status: 'PENDING', createdAt: { lt: cutoff } }, take: 500 });
  let deleted = 0;
  let failed = 0;
  for (const a of stale) {
    try {
      await storage.deleteObject(a.objectKey);
      await prisma.mediaAsset.delete({ where: { id: a.id } });
      deleted++;
    } catch (err) {
      failed++;
      console.error('[media] orphan cleanup failed for', a.id, err instanceof Error ? err.message : err);
    }
  }
  return { deleted, failed, skipped: false };
}
