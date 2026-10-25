import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anon, createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { env } from '../../src/server/env';
import { storage } from '../../src/server/storage';
import { cleanupOrphanMedia, detectImageType, signedUrlForMedia } from '../../src/server/services/media.service';

// 1×1 transparent PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const WEBP_HEAD = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const KEY_RE = /^users\/[0-9a-f-]{36}\/progress_photo\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.png$/;

const realBucketConfigured = !!process.env.S3_BUCKET;

describe('detectImageType', () => {
  it('detects by magic bytes', () => {
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(JPEG_HEAD)).toBe('image/jpeg');
    expect(detectImageType(WEBP_HEAD)).toBe('image/webp');
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull();
  });
});

describe('media API (storage mocked)', () => {
  let put: ReturnType<typeof vi.fn>;
  let del: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.spyOn(storage, 'isConfigured').mockReturnValue(true);
    vi.spyOn(storage, 'assertConfigured').mockReturnValue(undefined);
    vi.spyOn(storage, 'bucketName').mockReturnValue('test-bucket');
    vi.spyOn(storage, 'getSignedGetUrl').mockImplementation(async (key: string) => `https://signed.example/${key}?X-Amz-Signature=abc`);
    vi.spyOn(storage, 'getBucketPolicyPublic').mockResolvedValue(true);
    vi.spyOn(storage, 'cachedBucketPolicyPublic').mockReturnValue(true);
    put = vi.spyOn(storage, 'putObject').mockResolvedValue(undefined) as unknown as ReturnType<typeof vi.fn>;
    del = vi.spyOn(storage, 'deleteObject').mockResolvedValue(undefined) as unknown as ReturnType<typeof vi.fn>;
  });
  afterEach(() => vi.restoreAllMocks());

  it('requires auth', async () => {
    expect((await anon().get('/api/media')).status).toBe(401);
    expect((await anon().get('/api/media/status')).status).toBe(401);
  });

  it('reports status including the public-read policy flag', async () => {
    const { api } = await createTestUser();
    const res = await api.get('/api/media/status');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ configured: true, bucket: 'test-bucket', publicReadPolicyDetected: true });
    expect(JSON.stringify(res.body)).not.toMatch(/secret|AWS_SECRET|accessKey/i);
    // The status endpoint never waits on the (slow) bucket-policy lookup.
    expect(storage.getBucketPolicyPublic).not.toHaveBeenCalled();
  });

  it('returns several assets in one batch request, skipping foreign/unknown ids', async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const upload = async (api: typeof a.api) =>
      (await api.post('/api/media').field('kind', 'PROGRESS_PHOTO').attach('file', PNG, { filename: 'x.png', contentType: 'image/png' })).body.data.id as string;
    const [m1, m2, foreign] = [await upload(a.api), await upload(a.api), await upload(b.api)];
    const unknown = '00000000-0000-4000-8000-000000000000';
    const res = await a.api.get(`/api/media/batch?ids=${m2},${foreign},${m1},${unknown},${m2}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((x: { id: string }) => x.id)).toEqual([m2, m1]);
    expect(res.body.data[0].url).toMatch(/^https:\/\/signed\.example\//);
    expect((await a.api.get('/api/media/batch?ids=not-a-uuid')).status).toBe(400);
  });

  it('uploads a valid image with an unguessable key and returns a signed url', async () => {
    const { api, user } = await createTestUser();
    const res = await api
      .post('/api/media')
      .field('kind', 'PROGRESS_PHOTO')
      .field('notes', 'front')
      .attach('file', PNG, { filename: 'my-private-name.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: 'PROGRESS_PHOTO', mimeType: 'image/png', sizeBytes: PNG.length, notes: 'front' });
    expect(res.body.data.url).toContain('X-Amz-Signature');
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.status).toBe('READY');
    expect(row.userId).toBe(user.id);
    expect(row.objectKey).toMatch(KEY_RE);
    expect(row.objectKey).not.toContain('my-private-name');
    expect(put).toHaveBeenCalledWith(row.objectKey, expect.any(Buffer), 'image/png');

    const list = await api.get('/api/media?kind=PROGRESS_PHOTO');
    expect(list.status).toBe(200);
    expect(list.body.data.map((m: { id: string }) => m.id)).toContain(row.id);
    expect(list.body.meta.total).toBe(1);
  });

  it('rejects files whose bytes are not an allowed image, even if declared as one', async () => {
    const { api, user } = await createTestUser();
    const res = await api
      .post('/api/media')
      .field('kind', 'OTHER')
      .attach('file', Buffer.from('#!/bin/sh\necho pwned'), { filename: 'x.png', contentType: 'image/png' });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(put).not.toHaveBeenCalled();
    expect(await prisma.mediaAsset.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects an invalid kind and a missing file', async () => {
    const { api } = await createTestUser();
    expect((await api.post('/api/media').field('kind', 'NOPE').attach('file', PNG, 'a.png')).status).toBe(400);
    const noFile = await api.post('/api/media').field('kind', 'OTHER');
    expect(noFile.status).toBe(400);
    expect(noFile.body.error.code).toBe('FILE_REQUIRED');
  });

  it('enforces the size limit with 413', async () => {
    const { api } = await createTestUser();
    const big = Buffer.concat([PNG, Buffer.alloc(env.MEDIA_MAX_BYTES)]);
    const res = await api.post('/api/media').field('kind', 'OTHER').attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(put).not.toHaveBeenCalled();
  });

  it('removes the pending row when the upload to storage fails', async () => {
    const { api, user } = await createTestUser();
    put.mockRejectedValueOnce(new Error('boom'));
    const res = await api.post('/api/media').field('kind', 'OTHER').attach('file', PNG, 'a.png');
    expect(res.status).toBe(502);
    expect(await prisma.mediaAsset.count({ where: { userId: user.id } })).toBe(0);
  });

  it('hides other users’ media (404) and supports patch + delete with reference cleanup', async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const up = await a.api.post('/api/media').field('kind', 'WORKOUT_REFERENCE').attach('file', PNG, 'a.png');
    const id = up.body.data.id as string;

    expect((await b.api.get(`/api/media/${id}`)).status).toBe(404);
    expect((await b.api.patch(`/api/media/${id}`).send({ notes: 'x' })).status).toBe(404);
    expect((await b.api.delete(`/api/media/${id}`)).status).toBe(404);
    expect(await signedUrlForMedia(id, b.user.id)).toBeNull();
    expect(await signedUrlForMedia(id, a.user.id)).toContain('X-Amz-Signature');

    // B cannot link A's media to their own records either.
    expect((await b.api.post('/api/workouts/exercises').send({ name: 'Squat', imageMediaId: id })).status).toBe(404);

    const patched = await a.api.patch(`/api/media/${id}`).send({ notes: 'grip', takenAt: '2026-10-01T08:00:00.000Z' });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ notes: 'grip', takenAt: '2026-10-01T08:00:00.000Z' });

    const ex = await a.api.post('/api/workouts/exercises').send({ name: 'Bench press', imageMediaId: id });
    expect(ex.status).toBe(201);
    const m = await a.api.post('/api/measurements').send({ date: '2026-10-01', weightKg: 80, photoMediaId: id });
    expect(m.status).toBe(201);

    const delRes = await a.api.delete(`/api/media/${id}`);
    expect(delRes.status).toBe(204);
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('DELETED');
    expect(row.deletedAt).not.toBeNull();
    expect(del).toHaveBeenCalledWith(row.objectKey);
    expect((await prisma.exercise.findUniqueOrThrow({ where: { id: ex.body.data.id } })).imageMediaId).toBeNull();
    expect((await prisma.bodyMeasurement.findUniqueOrThrow({ where: { id: m.body.data.id } })).photoMediaId).toBeNull();
    expect((await a.api.get(`/api/media/${id}`)).status).toBe(404);
  });

  it('cleans up stale pending uploads; the cleanup endpoint is owner-only', async () => {
    const { user, api } = await createTestUser();
    const stale = await prisma.mediaAsset.create({
      data: {
        userId: user.id,
        kind: 'OTHER',
        bucket: 'test-bucket',
        objectKey: `users/${user.id}/other/2020/01/${crypto.randomUUID()}.png`,
        mimeType: 'image/png',
        sizeBytes: 1,
        createdAt: new Date(Date.now() - 48 * 3600_000),
      },
    });
    const fresh = await prisma.mediaAsset.create({
      data: { userId: user.id, kind: 'OTHER', bucket: 'test-bucket', objectKey: `users/${user.id}/other/2020/01/${crypto.randomUUID()}.png`, mimeType: 'image/png', sizeBytes: 1 },
    });
    const result = await cleanupOrphanMedia(24);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    expect(await prisma.mediaAsset.findUnique({ where: { id: stale.id } })).toBeNull();
    expect(await prisma.mediaAsset.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(del).toHaveBeenCalledWith(stale.objectKey);

    const member = await createTestUser({ role: 'MEMBER' });
    expect((await member.api.post('/api/media/cleanup').send({})).status).toBe(403);
    expect((await api.post('/api/media/cleanup').send({})).status).toBe(200);
  });
});

describe.skipIf(realBucketConfigured)('media API without storage configured', () => {
  it('returns 503 STORAGE_NOT_CONFIGURED naming the env vars', async () => {
    const { api } = await createTestUser();
    const status = await api.get('/api/media/status');
    expect(status.body.data.configured).toBe(false);
    const res = await api.post('/api/media').field('kind', 'OTHER').attach('file', PNG, 'a.png');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('STORAGE_NOT_CONFIGURED');
    expect(res.body.error.message).toContain('S3_BUCKET');
  });
});

describe.skipIf(!realBucketConfigured)('media API against the real bucket (integration)', () => {
  const keys: string[] = [];
  afterAll(async () => {
    for (const k of keys) await storage.deleteObject(k).catch(() => undefined);
  });

  it('uploads, serves via a signed GET, and deletes', async () => {
    const { api, user } = await createTestUser();
    const status = await api.get('/api/media/status');
    expect(status.body.data.configured).toBe(true);
    console.info('[media integration] publicReadPolicyDetected =', status.body.data.publicReadPolicyDetected);

    const up = await api.post('/api/media').field('kind', 'PROGRESS_PHOTO').attach('file', PNG, { filename: 'p.png', contentType: 'image/png' });
    expect(up.status).toBe(201);
    const row = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: up.body.data.id } });
    keys.push(row.objectKey);
    expect(row.objectKey.startsWith(`users/${user.id}/progress_photo/`)).toBe(true);
    expect(await storage.headObject(row.objectKey)).toMatchObject({ contentLength: PNG.length });

    const got = await fetch(up.body.data.url);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(PNG)).toBe(true);

    const fresh = await api.get(`/api/media/${row.id}`);
    expect(fresh.status).toBe(200);
    expect((await fetch(fresh.body.data.url)).status).toBe(200);

    expect((await api.delete(`/api/media/${row.id}`)).status).toBe(204);
    expect(await storage.headObject(row.objectKey)).toBeNull();
    const after = await fetch(up.body.data.url);
    expect(after.status).toBeGreaterThanOrEqual(400);
  });
});
