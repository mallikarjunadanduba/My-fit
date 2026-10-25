import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/server/db';
import { computeNextTrigger, type SchedulableReminder } from '../../src/server/services/reminders.service';
import { createTestUser } from './helpers';

const base: SchedulableReminder = { enabled: true, time: '07:00', weekdays: [], oneTimeDate: null, dayType: 'ANY' };
const IST = { timezone: 'Asia/Kolkata', gymWeekdays: [1, 2, 3, 4, 5, 6] };
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('computeNextTrigger', () => {
  // 2026-10-24 is a Saturday.
  const satMorningIst = new Date('2026-10-24T00:00:00Z'); // 05:30 IST

  it('returns today when the time is still ahead (Asia/Kolkata)', () => {
    expect(iso(computeNextTrigger(base, { ...IST, now: satMorningIst }))).toBe('2026-10-24T01:30:00.000Z');
  });

  it('returns tomorrow when today has passed and is strictly after now', () => {
    const at = new Date('2026-10-24T01:30:00Z');
    expect(iso(computeNextTrigger(base, { ...IST, now: at }))).toBe('2026-10-25T01:30:00.000Z');
  });

  it('respects weekdays', () => {
    expect(iso(computeNextTrigger({ ...base, weekdays: [1] }, { ...IST, now: satMorningIst }))).toBe('2026-10-26T01:30:00.000Z');
    expect(iso(computeNextTrigger({ ...base, weekdays: [3, 5] }, { ...IST, now: satMorningIst }))).toBe('2026-10-28T01:30:00.000Z');
  });

  it('GYM fires only on gym weekdays, REST only on others', () => {
    // Saturday is a gym day; Sunday is rest.
    expect(iso(computeNextTrigger({ ...base, dayType: 'GYM' }, { ...IST, now: satMorningIst }))).toBe('2026-10-24T01:30:00.000Z');
    expect(iso(computeNextTrigger({ ...base, dayType: 'REST' }, { ...IST, now: satMorningIst }))).toBe('2026-10-25T01:30:00.000Z');
  });

  it('applies DailyLog day-type overrides', () => {
    const ctx = { ...IST, now: satMorningIst, dayTypeOverrides: { '2026-10-24': 'REST' as const, '2026-10-25': 'GYM' as const } };
    expect(iso(computeNextTrigger({ ...base, dayType: 'REST' }, ctx))).toBe('2026-10-24T01:30:00.000Z');
    expect(iso(computeNextTrigger({ ...base, dayType: 'GYM' }, ctx))).toBe('2026-10-25T01:30:00.000Z');
  });

  it('handles one-time reminders', () => {
    expect(iso(computeNextTrigger({ ...base, oneTimeDate: '2026-10-30' }, { ...IST, now: satMorningIst }))).toBe('2026-10-30T01:30:00.000Z');
    expect(computeNextTrigger({ ...base, oneTimeDate: '2026-10-20' }, { ...IST, now: satMorningIst })).toBeNull();
    expect(iso(computeNextTrigger({ ...base, oneTimeDate: new Date('2026-10-30T00:00:00Z') }, { ...IST, now: satMorningIst }))).toBe(
      '2026-10-30T01:30:00.000Z',
    );
  });

  it('returns null when disabled or nothing matches within 14 days', () => {
    expect(computeNextTrigger({ ...base, enabled: false }, { ...IST, now: satMorningIst })).toBeNull();
    expect(computeNextTrigger({ ...base, dayType: 'REST' }, { timezone: 'Asia/Kolkata', gymWeekdays: [0, 1, 2, 3, 4, 5, 6], now: satMorningIst })).toBeNull();
  });

  it('is DST-safe across the America/New_York fall-back transition (2026-11-01)', () => {
    const ny = { timezone: 'America/New_York', gymWeekdays: [] };
    // Sat 31 Oct 07:00 EDT = 11:00Z; Sun 1 Nov 07:00 EST = 12:00Z.
    expect(iso(computeNextTrigger(base, { ...ny, now: new Date('2026-10-31T10:00:00Z') }))).toBe('2026-10-31T11:00:00.000Z');
    expect(iso(computeNextTrigger(base, { ...ny, now: new Date('2026-10-31T11:00:00Z') }))).toBe('2026-11-01T12:00:00.000Z');
    expect(iso(computeNextTrigger(base, { ...ny, now: new Date('2026-11-01T12:00:00Z') }))).toBe('2026-11-02T12:00:00.000Z');
  });

  it('is DST-safe across the America/New_York spring-forward transition (2026-03-08)', () => {
    const ny = { timezone: 'America/New_York', gymWeekdays: [] };
    expect(iso(computeNextTrigger(base, { ...ny, now: new Date('2026-03-07T13:00:00Z') }))).toBe('2026-03-08T11:00:00.000Z');
    // 23:30 local on the night before the change.
    expect(iso(computeNextTrigger({ ...base, time: '23:30' }, { ...ny, now: new Date('2026-03-08T05:00:00Z') }))).toBe('2026-03-09T03:30:00.000Z');
  });

  it('works for zones behind UTC late in the local day', () => {
    // 2026-10-24 22:00 in Los Angeles is 2026-10-25T05:00Z.
    const la = { timezone: 'America/Los_Angeles', gymWeekdays: [] };
    expect(iso(computeNextTrigger({ ...base, time: '23:00' }, { ...la, now: new Date('2026-10-25T05:00:00Z') }))).toBe('2026-10-25T06:00:00.000Z');
  });
});

describe('reminders API', () => {
  it('creates, lists with nextTriggerAt, updates, pauses/resumes and deletes', async () => {
    const { api } = await createTestUser();
    const res = await api.post('/api/reminders').send({ title: 'Morning water', category: 'MORNING_WATER', time: '06:30', weekdays: [1, 3, 5] });
    expect(res.status).toBe(201);
    const r = res.body.data;
    expect(r.nextTriggerAt).toBeTruthy();
    expect(r.snoozeMinutes).toBe(10);

    const list = await api.get('/api/reminders');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(typeof list.body.meta.pushConfigured).toBe('boolean');

    const patched = await api.patch(`/api/reminders/${r.id}`).send({ time: '06:45' });
    expect(patched.status).toBe(200);
    expect(patched.body.data.time).toBe('06:45');
    expect(patched.body.data.nextTriggerAt).not.toBe(r.nextTriggerAt);

    const paused = await api.post(`/api/reminders/${r.id}/pause`);
    expect(paused.body.data.enabled).toBe(false);
    expect(paused.body.data.nextTriggerAt).toBeNull();
    const resumed = await api.post(`/api/reminders/${r.id}/resume`);
    expect(resumed.body.data.enabled).toBe(true);
    expect(resumed.body.data.nextTriggerAt).toBeTruthy();

    const next = await api.get('/api/reminders/next');
    expect(next.body.data.id).toBe(r.id);

    expect((await api.delete(`/api/reminders/${r.id}`)).status).toBe(204);
    expect((await api.get('/api/reminders')).body.data).toHaveLength(0);
  });

  it('validates input', async () => {
    const { api } = await createTestUser();
    expect((await api.post('/api/reminders').send({ title: '', time: '07:00' })).status).toBe(400);
    expect((await api.post('/api/reminders').send({ title: 'x', time: '7:00' })).status).toBe(400);
    expect((await api.post('/api/reminders').send({ title: 'x', time: '07:00', weekdays: [1, 1] })).status).toBe(400);
    expect((await api.post('/api/reminders').send({ title: 'x', time: '07:00', weekdays: [7] })).status).toBe(400);
    expect((await api.post('/api/reminders').send({ title: 'x', time: '07:00', snoozeMinutes: 0 })).status).toBe(400);
    expect((await api.post('/api/reminders').send({ title: 'x', time: '07:00', snoozeMinutes: 121 })).status).toBe(400);
    expect((await api.post('/api/reminders').send({ title: 'x', time: '07:00', oneTimeDate: '2020-01-01' })).status).toBe(400);
  });

  it('enforces ownership (cross-user 404)', async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const r = (await a.api.post('/api/reminders').send({ title: 'Mine', time: '08:00' })).body.data;
    expect((await b.api.patch(`/api/reminders/${r.id}`).send({ title: 'Hacked' })).status).toBe(404);
    expect((await b.api.delete(`/api/reminders/${r.id}`)).status).toBe(404);
    expect((await b.api.post(`/api/reminders/${r.id}/test`)).status).toBe(404);
    const occ = await prisma.reminderOccurrence.create({ data: { reminderId: r.id, userId: a.user.id, scheduledFor: new Date(), status: 'SENT' } });
    expect((await b.api.post(`/api/reminders/occurrences/${occ.id}/complete`)).status).toBe(404);
    expect((await b.api.post(`/api/reminders/occurrences/${occ.id}/snooze`).send({})).status).toBe(404);
    expect((await b.api.get('/api/reminders/overdue')).body.data.occurrences).toHaveLength(0);
  });

  it('occurrence actions: snooze, complete, dismiss, overdue and history', async () => {
    const { api, user } = await createTestUser();
    const r = (await api.post('/api/reminders').send({ title: 'Lunch', category: 'LUNCH', time: '13:00', snoozeMinutes: 15 })).body.data;
    const occ = await prisma.reminderOccurrence.create({
      data: { reminderId: r.id, userId: user.id, scheduledFor: new Date(Date.now() - 5 * 60_000), status: 'SENT', firedAt: new Date() },
    });

    const od = await api.get('/api/reminders/overdue');
    expect(od.body.data.occurrences.map((o: { id: string }) => o.id)).toEqual([occ.id]);

    const sn = await api.post(`/api/reminders/occurrences/${occ.id}/snooze`).send({});
    expect(sn.status).toBe(200);
    expect(sn.body.data.status).toBe('SNOOZED');
    const until = new Date(sn.body.data.snoozedUntil).getTime();
    expect(until - Date.now()).toBeGreaterThan(14 * 60_000);
    expect((await api.post(`/api/reminders/occurrences/${occ.id}/snooze`).send({ minutes: 500 })).status).toBe(400);
    // Snoozed into the future → not overdue right now.
    expect((await api.get('/api/reminders/overdue')).body.data.occurrences).toHaveLength(0);

    const done = await api.post(`/api/reminders/occurrences/${occ.id}/complete`);
    expect(done.body.data.status).toBe('COMPLETED');
    expect((await api.post(`/api/reminders/occurrences/${occ.id}/dismiss`)).status).toBe(409);

    const hist = await api.get('/api/reminders/history?page=1');
    expect(hist.status).toBe(200);
    expect(hist.body.data[0].id).toBe(occ.id);
    expect(hist.body.meta.total).toBe(1);
  });

  it('ring creates the due occurrence once and refuses arbitrary times', async () => {
    const { api } = await createTestUser();
    const r = (await api.post('/api/reminders').send({ title: 'Ring', time: '09:00' })).body.data;
    const due = new Date(Date.now() - 10_000);
    await prisma.reminder.update({ where: { id: r.id }, data: { nextTriggerAt: due } });
    const a = await api.post(`/api/reminders/${r.id}/ring`).send({ scheduledFor: due.toISOString() });
    expect(a.status).toBe(200);
    const b = await api.post(`/api/reminders/${r.id}/ring`).send({ scheduledFor: due.toISOString() });
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await prisma.reminderOccurrence.count({ where: { reminderId: r.id } })).toBe(1);
    const other = await api.post(`/api/reminders/${r.id}/ring`).send({ scheduledFor: new Date(Date.now() - 3600_000).toISOString() });
    expect(other.status).toBe(409);
  });

  it('summary aggregates next alarm, overdue items and push config in one call', async () => {
    const { api, user } = await createTestUser();
    const r = (await api.post('/api/reminders').send({ title: 'Water', category: 'WATER', time: '10:00' })).body.data;
    const occ = await prisma.reminderOccurrence.create({ data: { reminderId: r.id, userId: user.id, scheduledFor: new Date(Date.now() - 60_000), status: 'SENT' } });
    await api.post('/api/notifications/in-app-ack').send({ occurrenceId: occ.id, action: 'shown' });
    const res = await api.get('/api/reminders/summary');
    expect(res.status).toBe(200);
    expect(res.body.data.next.id).toBe(r.id);
    expect(res.body.data.overdue.occurrences.map((o: { id: string }) => o.id)).toEqual([occ.id]);
    expect(res.body.data.overdue.occurrences[0].inAppShownAt).toBeTruthy();
    expect(Array.isArray(res.body.data.overdue.routineEntries)).toBe(true);
    expect(typeof res.body.data.pushConfigured).toBe('boolean');
  });

  it('dismiss persists, keeps the in-app ack, and snooze after dismiss conflicts', async () => {
    const { api, user } = await createTestUser();
    const r = (await api.post('/api/reminders').send({ title: 'Stretch', time: '11:00' })).body.data;
    const occ = await prisma.reminderOccurrence.create({ data: { reminderId: r.id, userId: user.id, scheduledFor: new Date(Date.now() - 60_000), status: 'SENT' } });
    await api.post('/api/notifications/in-app-ack').send({ occurrenceId: occ.id, action: 'shown' });
    const d = await api.post(`/api/reminders/occurrences/${occ.id}/dismiss`);
    expect(d.status).toBe(200);
    expect(d.body.data).toMatchObject({ id: occ.id, status: 'DISMISSED', reminder: { id: r.id, title: 'Stretch' } });
    expect(d.body.data.inAppShownAt).toBeTruthy();
    expect((await prisma.reminderOccurrence.findUniqueOrThrow({ where: { id: occ.id } })).status).toBe('DISMISSED');
    expect((await api.post(`/api/reminders/occurrences/${occ.id}/dismiss`)).status).toBe(200);
    expect((await api.post(`/api/reminders/occurrences/${occ.id}/snooze`).send({ minutes: 5 })).status).toBe(409);
  });

  it('test endpoint reports push status without subscriptions', async () => {
    const { api } = await createTestUser();
    const r = (await api.post('/api/reminders').send({ title: 'Test me', time: '10:00' })).body.data;
    const t = await api.post(`/api/reminders/${r.id}/test`);
    expect(t.status).toBe(200);
    expect(t.body.data.payload.title).toContain('Test me');
    expect(t.body.data.deliveries[0].status).toBe('SKIPPED');
  });
});
