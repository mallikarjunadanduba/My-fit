import { describe, expect, it } from 'vitest';
import { createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { createSession } from '../../src/server/services/session';
import { getTargetForDate } from '../../src/server/services/dayContext';
import { toDbDate, todayIn } from '../../src/server/lib/dates';
import { reminderRecomputeSettled, targetRangeErrors } from '../../src/server/services/settings.service';

const coach = {
  calories: 1900, caloriesMin: 1850, caloriesMax: 1950,
  protein: 160, proteinMin: 160, proteinMax: 160,
  carbs: 160, carbsMin: 150, carbsMax: 170,
  fat: 60, fatMin: 55, fatMax: 65,
  fiber: 32.5, fiberMin: 30, fiberMax: 35,
  waterMl: 3000, waterMinMl: 2500, waterMaxMl: 3500,
};

describe('GET/PATCH /api/settings', () => {
  it('returns settings, targets and account', async () => {
    const { api, user } = await createTestUser();
    const res = await api.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.data.settings).toMatchObject({ timezone: 'Asia/Kolkata', theme: 'SYSTEM', gymWeekdays: [1, 2, 3, 4, 5, 6] });
    expect(res.body.data.account).toEqual({ name: user.name, email: user.email, role: 'OWNER' });
    expect(res.body.data.targets).toEqual({ current: null, history: [] });
  });

  it('applies partial updates', async () => {
    const { api } = await createTestUser();
    const res = await api.patch('/api/settings').send({ theme: 'DARK', gymWeekdays: [5, 1, 3], defaultSnoozeMinutes: 15, timezone: 'America/New_York' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ theme: 'DARK', gymWeekdays: [1, 3, 5], defaultSnoozeMinutes: 15, timezone: 'America/New_York' });
    const again = await api.patch('/api/settings').send({ notificationsEnabled: false });
    expect(again.body.data).toMatchObject({ theme: 'DARK', notificationsEnabled: false });
  });

  it('recomputes alarm times in the background after a timezone change', async () => {
    const { api, user } = await createTestUser();
    const created = await api.post('/api/reminders').send({ title: 'Wake up', time: '06:00' });
    expect(created.status).toBe(201);
    const before = created.body.data.nextTriggerAt;
    expect((await api.patch('/api/settings').send({ timezone: 'America/New_York' })).status).toBe(200);
    await reminderRecomputeSettled(user.id);
    const row = await prisma.reminder.findUniqueOrThrow({ where: { id: created.body.data.id } });
    expect(row.nextTriggerAt?.toISOString()).not.toBe(before);
  });

  it('returns the target in force today with the bundle', async () => {
    const { api } = await createTestUser();
    await api.post('/api/settings/targets').send({ ...coach, effectiveFrom: '2026-01-01' });
    await api.post('/api/settings/targets').send({ ...coach, calories: 2000, caloriesMin: 1950, caloriesMax: 2050, effectiveFrom: '2099-01-01' });
    const res = await api.get('/api/settings');
    expect(res.body.data.targets.history.map((t: { effectiveFrom: string }) => t.effectiveFrom)).toEqual(['2099-01-01', '2026-01-01']);
    expect(res.body.data.targets.current.effectiveFrom).toBe('2026-01-01');
  });

  it('validates the patch', async () => {
    const { api } = await createTestUser();
    const bad = [
      { timezone: 'Mars/Olympus' },
      { gymWeekdays: [1, 1] },
      { gymWeekdays: [7] },
      { gymWeekdays: [1.5] },
      { theme: 'PURPLE' },
      { defaultSnoozeMinutes: 0 },
      { unknownField: true },
      {},
    ];
    for (const body of bad) {
      const res = await api.patch('/api/settings').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('rejects a profile photo the user does not own', async () => {
    const { api } = await createTestUser();
    const res = await api.patch('/api/settings').send({ profileMediaId: '00000000-0000-4000-8000-000000000000' });
    expect(res.status).toBe(404);
  });

  it('updates the profile name', async () => {
    const { api } = await createTestUser();
    const res = await api.patch('/api/settings/profile').send({ name: '  Arjun  ' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Arjun');
    expect((await api.patch('/api/settings/profile').send({ name: '' })).status).toBe(400);
  });
});

describe('nutrition targets', () => {
  it('versions targets by effective date and keeps history', async () => {
    const { api, user } = await createTestUser();
    const old = await api.post('/api/settings/targets').send({ ...coach, effectiveFrom: '2026-01-01' });
    expect(old.status).toBe(201);
    expect(old.body.data.effectiveFrom).toBe('2026-01-01');

    const newer = await api.post('/api/settings/targets').send({ ...coach, calories: 2000, caloriesMin: 1950, caloriesMax: 2050, effectiveFrom: '2026-03-01' });
    expect(newer.status).toBe(201);

    // Re-posting the same date replaces that version only.
    const edit = await api.post('/api/settings/targets').send({ ...coach, calories: 2100, caloriesMin: 2000, caloriesMax: 2200, effectiveFrom: '2026-03-01' });
    expect(edit.body.data.id).toBe(newer.body.data.id);

    const list = await api.get('/api/settings/targets');
    expect(list.body.data.history.map((t: { effectiveFrom: string }) => t.effectiveFrom)).toEqual(['2026-03-01', '2026-01-01']);
    expect(list.body.data.history[1].calories).toBe(1900);

    expect((await getTargetForDate(user.id, '2026-02-15'))?.calories).toBe(1900);
    expect((await getTargetForDate(user.id, '2026-03-01'))?.calories).toBe(2100);
    expect((await getTargetForDate(user.id, '2026-06-01'))?.calories).toBe(2100);
    // Before the first version → earliest target.
    expect((await getTargetForDate(user.id, '2025-12-01'))?.calories).toBe(1900);
  });

  it('defaults effectiveFrom to today in the user timezone', async () => {
    const { api, user } = await createTestUser({ timezone: 'Pacific/Kiritimati' });
    const res = await api.post('/api/settings/targets').send(coach);
    expect(res.status).toBe(201);
    expect(res.body.data.effectiveFrom).toBe(todayIn('Pacific/Kiritimati'));
    const row = await prisma.nutritionTarget.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.effectiveFrom).toEqual(toDbDate(todayIn('Pacific/Kiritimati')));
  });

  it('validates min ≤ target ≤ max', async () => {
    const { api } = await createTestUser();
    const res = await api.post('/api/settings/targets').send({ ...coach, proteinMin: 170 });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.proteinMin).toBeTruthy();
    expect((await api.post('/api/settings/targets').send({ ...coach, waterMaxMl: 2000 })).status).toBe(400);
    expect((await api.post('/api/settings/targets').send({ ...coach, calories: -1 })).status).toBe(400);
    expect(targetRangeErrors({ ...coach })).toEqual({});
  });

  it('refuses to delete the last target and scopes deletes by user', async () => {
    const { api } = await createTestUser();
    const a = await api.post('/api/settings/targets').send({ ...coach, effectiveFrom: '2026-01-01' });
    const b = await api.post('/api/settings/targets').send({ ...coach, effectiveFrom: '2026-02-01' });
    const other = await createTestUser();
    expect((await other.api.delete(`/api/settings/targets/${a.body.data.id}`)).status).toBe(404);
    expect((await api.delete(`/api/settings/targets/${b.body.data.id}`)).status).toBe(204);
    const last = await api.delete(`/api/settings/targets/${a.body.data.id}`);
    expect(last.status).toBe(409);
  });
});

describe('sessions', () => {
  it('lists active sessions and revokes others', async () => {
    const { api, user } = await createTestUser();
    const { session: second } = await createSession(user.id, { userAgent: 'Phone browser' });
    const list = await api.get('/api/settings/sessions');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    const current = list.body.data.find((s: { current: boolean }) => s.current);
    expect(current).toBeTruthy();
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash/);

    expect((await api.delete(`/api/settings/sessions/${current.id}`)).status).toBe(400);
    expect((await api.delete(`/api/settings/sessions/${second.id}`)).status).toBe(204);
    expect(await prisma.session.findUnique({ where: { id: second.id } })).toBeNull();

    const other = await createTestUser();
    expect((await other.api.delete(`/api/settings/sessions/${current.id}`)).status).toBe(404);
  });
});
