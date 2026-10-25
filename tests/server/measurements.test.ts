import { describe, expect, it } from 'vitest';
import { anon, createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { summarizeWeightTrend } from '../../src/server/services/measurements.service';

describe('summarizeWeightTrend (pure)', () => {
  it('keeps the last reading per day and computes change', () => {
    const t = summarizeWeightTrend([
      { date: '2026-10-01', weightKg: 82 },
      { date: '2026-10-01', weightKg: 81.6 },
      { date: '2026-10-08', weightKg: 80.9 },
      { date: '2026-10-15', weightKg: 80 },
    ]);
    expect(t.points).toEqual([
      { date: '2026-10-01', weightKg: 81.6 },
      { date: '2026-10-08', weightKg: 80.9 },
      { date: '2026-10-15', weightKg: 80 },
    ]);
    expect(t).toMatchObject({ change: -1.6, changePct: -2, min: 80, max: 81.6, average: 80.8 });
    expect(summarizeWeightTrend([])).toMatchObject({ points: [], change: null, first: null });
  });
});

describe('measurements API', () => {
  it('requires auth', async () => {
    expect((await anon().get('/api/measurements')).status).toBe(401);
  });

  it('validates input', async () => {
    const { api } = await createTestUser();
    const empty = await api.post('/api/measurements').send({ date: '2026-10-01' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.message).toMatch(/at least one/i);
    expect((await api.post('/api/measurements').send({ date: '2026-10-01', weightKg: 900 })).status).toBe(400);
    expect((await api.post('/api/measurements').send({ date: '2026-10-01', bodyFatPct: -1 })).status).toBe(400);
    expect((await api.post('/api/measurements').send({ date: '2026-13-01', weightKg: 80 })).status).toBe(400);
    expect((await api.post('/api/measurements').send({ date: '2026-10-01', weightKg: 80, extra: 1 })).status).toBe(400);
    expect((await api.post('/api/measurements').send({ date: '2026-10-01', photoMediaId: crypto.randomUUID() })).status).toBe(404);
  });

  it('CRUD, latest per metric, list range + pagination, and trend', async () => {
    const { api } = await createTestUser();
    const a = await api.post('/api/measurements').send({ date: '2026-09-01', weightKg: 82, waistCm: 90, notes: 'start' });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ date: '2026-09-01', weightKg: 82, waistCm: 90, chestCm: null });
    await api.post('/api/measurements').send({ date: '2026-09-15', weightKg: 81 });
    const c = await api.post('/api/measurements').send({ date: '2026-10-01', bodyFatPct: 18 });

    const latest = await api.get('/api/measurements/latest');
    expect(latest.body.data.entry.id).toBe(c.body.data.id);
    expect(latest.body.data.metrics.weightKg).toEqual({ value: 81, date: '2026-09-15' });
    expect(latest.body.data.metrics.waistCm).toEqual({ value: 90, date: '2026-09-01' });
    expect(latest.body.data.metrics.armCm).toBeNull();

    const list = await api.get('/api/measurements?from=2026-09-10&to=2026-10-31&pageSize=1');
    expect(list.body.meta).toMatchObject({ total: 2, totalPages: 2 });
    expect(list.body.data[0].date).toBe('2026-10-01');

    const trend = await api.get('/api/measurements/trend?from=2026-08-01&to=2026-10-31');
    expect(trend.status).toBe(200);
    expect(trend.body.data.points).toHaveLength(2);
    expect(trend.body.data).toMatchObject({ change: -1, first: { weightKg: 82 }, last: { weightKg: 81 } });
    expect((await api.get('/api/measurements/trend?from=2026-10-31&to=2026-01-01')).status).toBe(400);

    const patched = await api.patch(`/api/measurements/${a.body.data.id}`).send({ waistCm: null, notes: '' });
    expect(patched.status).toBe(200);
    expect(patched.body.data).toMatchObject({ waistCm: null, notes: null, weightKg: 82 });
    // Clearing the last value is rejected.
    expect((await api.patch(`/api/measurements/${c.body.data.id}`).send({ bodyFatPct: null })).status).toBe(400);

    expect((await api.delete(`/api/measurements/${a.body.data.id}`)).status).toBe(204);
    expect(await prisma.bodyMeasurement.findUnique({ where: { id: a.body.data.id } })).toBeNull();
  });

  it('accepts an owned READY progress photo and keeps it when the measurement is deleted', async () => {
    const { api, user } = await createTestUser();
    const media = await prisma.mediaAsset.create({
      data: { userId: user.id, kind: 'PROGRESS_PHOTO', bucket: 'b', objectKey: `users/${user.id}/progress_photo/2026/10/${crypto.randomUUID()}.png`, mimeType: 'image/png', sizeBytes: 1, status: 'READY' },
    });
    const m = await api.post('/api/measurements').send({ date: '2026-10-01', photoMediaId: media.id });
    expect(m.status).toBe(201);
    expect((await api.delete(`/api/measurements/${m.body.data.id}`)).status).toBe(204);
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: media.id } })).status).toBe('READY');
  });

  it('isolates users', async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const m = await a.api.post('/api/measurements').send({ date: '2026-10-01', weightKg: 70 });
    expect((await b.api.patch(`/api/measurements/${m.body.data.id}`).send({ weightKg: 71 })).status).toBe(404);
    expect((await b.api.delete(`/api/measurements/${m.body.data.id}`)).status).toBe(404);
    expect((await b.api.get('/api/measurements')).body.data).toHaveLength(0);
    expect((await b.api.get('/api/measurements/latest')).body.data.entry).toBeNull();
    const aMedia = await prisma.mediaAsset.create({
      data: { userId: a.user.id, kind: 'PROGRESS_PHOTO', bucket: 'b', objectKey: `users/${a.user.id}/x/${crypto.randomUUID()}.png`, mimeType: 'image/png', sizeBytes: 1, status: 'READY' },
    });
    expect((await b.api.post('/api/measurements').send({ date: '2026-10-01', photoMediaId: aMedia.id })).status).toBe(404);
  });
});
