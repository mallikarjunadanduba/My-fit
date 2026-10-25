import { describe, expect, it } from 'vitest';
import { createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { toDbDate } from '../../src/server/lib/dates';

async function setup() {
  const ctx = await createTestUser();
  await prisma.nutritionTarget.create({
    data: {
      userId: ctx.user.id,
      effectiveFrom: toDbDate('2026-01-01'),
      calories: 2000,
      protein: 150,
      carbs: 200,
      fat: 60,
      fiber: 30,
      waterMl: 3000,
      waterMinMl: 2500,
      waterMaxMl: 4000,
    },
  });
  return ctx;
}

describe('water API', () => {
  it('logs water and reports totals, target and progress', async () => {
    const { api } = await setup();
    const empty = (await api.get('/api/water?date=2026-03-02')).body.data;
    expect(empty).toMatchObject({
      logged: false,
      totalMl: null,
      targetMl: 3000,
      minMl: 2500,
      maxMl: 4000,
      progress: null,
      overMax: false,
    });

    const first = await api.post('/api/water').send({ date: '2026-03-02', amountMl: 250 });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      date: '2026-03-02',
      amountMl: 250,
    });
    await api.post('/api/water').send({
      date: '2026-03-02',
      amountMl: 500,
      loggedAt: '2026-03-02T09:00:00+05:30',
      note: 'After run',
    });

    const day = (await api.get('/api/water?date=2026-03-02')).body.data;
    expect(day).toMatchObject({
      logged: true,
      totalMl: 750,
      remainingMl: 2250,
      overMax: false,
    });
    expect(day.progress).toMatchObject({
      target: 3000,
      actual: 750,
      percent: 25,
      status: 'under',
    });
    expect(day.entries).toHaveLength(2);
  });

  it('undo deletes the just-created entry', async () => {
    const { api } = await setup();
    await api.post('/api/water').send({ date: '2026-03-02', amountMl: 250 });
    const oops = (await api.post('/api/water').send({ date: '2026-03-02', amountMl: 500 })).body.data;
    expect((await api.delete(`/api/water/${oops.id}`)).status).toBe(204);
    expect((await api.get('/api/water?date=2026-03-02')).body.data.totalMl).toBe(250);
  });

  it('validates amounts and edits entries', async () => {
    const { api } = await setup();
    for (const amountMl of [0, -100, 2001, 12.5]) {
      expect((await api.post('/api/water').send({ date: '2026-03-02', amountMl })).status).toBe(400);
    }
    const e = (await api.post('/api/water').send({ date: '2026-03-02', amountMl: 300 })).body.data;
    const p = await api.patch(`/api/water/${e.id}`).send({ amountMl: 350, note: 'Bottle' });
    expect(p.body.data).toMatchObject({ amountMl: 350, note: 'Bottle' });
    expect((await api.patch(`/api/water/${e.id}`).send({ amountMl: 9000 })).status).toBe(400);
  });

  it('flags totals above the upper limit', async () => {
    const { api } = await setup();
    for (let i = 0; i < 3; i++) await api.post('/api/water').send({ date: '2026-03-02', amountMl: 1500 });
    const day = (await api.get('/api/water?date=2026-03-02')).body.data;
    expect(day).toMatchObject({ totalMl: 4500, overMax: true });
    expect(day.progress.status).toBe('over');
  });

  it('range distinguishes missing days from logged days', async () => {
    const { api } = await setup();
    await api.post('/api/water').send({ date: '2026-03-01', amountMl: 500 });
    await api.post('/api/water').send({ date: '2026-03-01', amountMl: 250 });
    await api.post('/api/water').send({ date: '2026-03-03', amountMl: 1000 });
    const res = await api.get('/api/water/range?from=2026-03-01&to=2026-03-03');
    expect(res.body.data.days).toEqual([
      {
        date: '2026-03-01',
        logged: true,
        entryCount: 2,
        totalMl: 750,
        targetMl: 3000,
        maxMl: 4000,
      },
      {
        date: '2026-03-02',
        logged: false,
        entryCount: 0,
        totalMl: null,
        targetMl: 3000,
        maxMl: 4000,
      },
      {
        date: '2026-03-03',
        logged: true,
        entryCount: 1,
        totalMl: 1000,
        targetMl: 3000,
        maxMl: 4000,
      },
    ]);
  });

  it("keeps users' water entries private", async () => {
    const a = await setup();
    const b = await createTestUser();
    const e = (await a.api.post('/api/water').send({ date: '2026-03-02', amountMl: 300 })).body.data;
    expect((await b.api.patch(`/api/water/${e.id}`).send({ amountMl: 1 })).status).toBe(404);
    expect((await b.api.delete(`/api/water/${e.id}`)).status).toBe(404);
    expect((await b.api.get('/api/water?date=2026-03-02')).body.data.logged).toBe(false);
  });
});

describe('water API (single round-trip paths)', () => {
  it('returns history with the day when historyDays is given', async () => {
    const { api } = await setup();
    await api.post('/api/water').send({ date: '2026-03-01', amountMl: 400 });
    await api.post('/api/water').send({ date: '2026-03-02', amountMl: 250 });
    const day = (await api.get('/api/water?date=2026-03-02&historyDays=3')).body.data;
    expect(day.totalMl).toBe(250);
    expect(day.history.from).toBe('2026-02-28');
    expect(day.history.days.map((d: { totalMl: number | null }) => d.totalMl)).toEqual([null, 400, 250]);
    expect(day.history.days[2]).toMatchObject({
      logged: true,
      targetMl: 3000,
      maxMl: 4000,
    });
    expect((await api.get('/api/water?date=2026-03-02')).body.data.history).toBeUndefined();
  });

  it("cannot edit or delete another user's entry", async () => {
    const a = await setup();
    const b = await setup();
    const entry = (await a.api.post('/api/water').send({ date: '2026-03-02', amountMl: 250 })).body.data;
    expect((await b.api.patch(`/api/water/${entry.id}`).send({ amountMl: 300 })).status).toBe(404);
    expect((await b.api.delete(`/api/water/${entry.id}`)).status).toBe(404);
    const edited = await a.api.patch(`/api/water/${entry.id}`).send({ amountMl: 300, date: '2026-03-03', note: 'moved' });
    expect(edited.body.data).toMatchObject({
      amountMl: 300,
      date: '2026-03-03',
      note: 'moved',
    });
  });
});
