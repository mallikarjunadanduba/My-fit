import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/server/db';
import { addDays, toDbDate, todayIn, zonedToUtc } from '../../src/server/lib/dates';
import { ensureDailyRoutineEntries, templateAppliesOn } from '../../src/server/services/routines.service';
import { createTestUser } from './helpers';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

async function setup() {
  const u = await createTestUser({ gymWeekdays: ALL_DAYS });
  const t = (await u.api.post('/api/routines/templates').send({ name: 'Every day', dayType: 'ANY' })).body.data;
  const withA = (await u.api.post(`/api/routines/templates/${t.id}/items`).send({ title: 'Wake up', category: 'WAKE_UP', time: '06:00' })).body.data;
  const withB = (await u.api.post(`/api/routines/templates/${t.id}/items`).send({ title: 'Lunch', category: 'LUNCH', time: '13:00', reminderEnabled: false })).body.data;
  return { ...u, template: withB, itemA: withA.items[0], itemB: withB.items[1] };
}

describe('templateAppliesOn', () => {
  it('uses weekdays when set, else day type', () => {
    // 2026-10-25 is a Sunday.
    expect(templateAppliesOn({ isActive: true, weekdays: [0], dayType: 'GYM' }, '2026-10-25', 'REST')).toBe(true);
    expect(templateAppliesOn({ isActive: true, weekdays: [1], dayType: 'ANY' }, '2026-10-25', 'REST')).toBe(false);
    expect(templateAppliesOn({ isActive: true, weekdays: [], dayType: 'GYM' }, '2026-10-25', 'REST')).toBe(false);
    expect(templateAppliesOn({ isActive: true, weekdays: [], dayType: 'REST' }, '2026-10-25', 'REST')).toBe(true);
    expect(templateAppliesOn({ isActive: true, weekdays: [], dayType: 'ANY' }, '2026-10-25', 'GYM')).toBe(true);
    expect(templateAppliesOn({ isActive: false, weekdays: [], dayType: 'ANY' }, '2026-10-25', 'GYM')).toBe(false);
  });
});

describe('routines API', () => {
  it('creates templates/items with linked reminders', async () => {
    const { template, itemA, itemB } = await setup();
    expect(template.items).toHaveLength(2);
    expect(itemA.reminder?.enabled).toBe(true);
    expect(itemA.reminder?.nextTriggerAt).toBeTruthy();
    expect(itemB.reminder).toBeNull();
  });

  it('materialises the day idempotently with progress', async () => {
    const { api, user } = await setup();
    const today = todayIn('Asia/Kolkata');
    const d1 = await api.get(`/api/routines/day?date=${today}`);
    expect(d1.status).toBe(200);
    expect(d1.body.data.entries).toHaveLength(2);
    expect(d1.body.data.progress).toMatchObject({ total: 2, completed: 0, percent: 0 });
    await api.get(`/api/routines/day?date=${today}`);
    expect(await ensureDailyRoutineEntries(user.id, today, { timezone: 'Asia/Kolkata', gymWeekdays: ALL_DAYS })).toBe(0);
    expect(await prisma.dailyRoutineEntry.count({ where: { userId: user.id, date: toDbDate(today) } })).toBe(2);

    // Past dates are not back-filled.
    const past = await api.get(`/api/routines/day?date=${addDays(today, -3)}`);
    expect(past.body.data.entries).toHaveLength(0);
    expect(past.body.data.progress.percent).toBeNull();
  });

  it('entry actions: complete, skip with reason, snooze, edit time', async () => {
    const { api } = await setup();
    const today = todayIn('Asia/Kolkata');
    const [a, b] = (await api.get(`/api/routines/day?date=${today}`)).body.data.entries;
    const done = await api.patch(`/api/routines/entries/${a.id}`).send({ status: 'COMPLETED', notes: 'Felt good' });
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', notes: 'Felt good' });
    expect(done.body.data.completedAt).toBeTruthy();
    const skipped = await api.patch(`/api/routines/entries/${b.id}`).send({ status: 'SKIPPED', skipReason: 'Meeting' });
    expect(skipped.body.data).toMatchObject({ status: 'SKIPPED', skipReason: 'Meeting' });
    await api.patch(`/api/routines/entries/${b.id}`).send({ status: 'PENDING' });
    const sn = await api.patch(`/api/routines/entries/${b.id}`).send({ snoozeMinutes: 10 });
    expect(sn.body.data.status).toBe('SNOOZED');
    const moved = await api.patch(`/api/routines/entries/${b.id}`).send({ scheduledTime: '14:15' });
    expect(moved.body.data.scheduledTime).toBe('14:15');
    const day = (await api.get(`/api/routines/day?date=${today}`)).body.data;
    expect(day.progress).toMatchObject({ total: 2, completed: 1, percent: 50 });
  });

  it('template edits refresh only today+ pending rows; history snapshots are preserved', async () => {
    const { api, user, itemA } = await setup();
    const today = todayIn('Asia/Kolkata');
    await api.get(`/api/routines/day?date=${today}`);
    const past = await prisma.dailyRoutineEntry.create({
      data: { userId: user.id, date: toDbDate(addDays(today, -1)), routineItemId: itemA.id, title: 'Wake up', category: 'WAKE_UP', scheduledTime: '06:00', scheduledAt: new Date(), status: 'COMPLETED' },
    });
    const res = await api.patch(`/api/routines/items/${itemA.id}`).send({ title: 'Rise and shine', time: '05:45' });
    expect(res.status).toBe(200);

    const pastAfter = await prisma.dailyRoutineEntry.findUniqueOrThrow({ where: { id: past.id } });
    expect(pastAfter.title).toBe('Wake up');
    expect(pastAfter.scheduledTime).toBe('06:00');
    const todayRow = await prisma.dailyRoutineEntry.findFirstOrThrow({ where: { userId: user.id, date: toDbDate(today), routineItemId: itemA.id } });
    expect(todayRow.title).toBe('Rise and shine');
    expect(todayRow.scheduledTime).toBe('05:45');

    const reminder = await prisma.reminder.findFirstOrThrow({ where: { routineItemId: itemA.id } });
    expect(reminder.title).toBe('Rise and shine');
    expect(reminder.time).toBe('05:45');

    // Deleting the item keeps the past snapshot (FK set null).
    expect((await api.delete(`/api/routines/items/${itemA.id}`)).status).toBe(204);
    const kept = await prisma.dailyRoutineEntry.findUniqueOrThrow({ where: { id: past.id } });
    expect(kept.routineItemId).toBeNull();
    expect(kept.title).toBe('Wake up');
    expect(await prisma.reminder.count({ where: { routineItemId: itemA.id } })).toBe(0);
  });

  it('toggling reminderEnabled creates / disables the linked reminder', async () => {
    const { api, itemA, itemB } = await setup();
    const t1 = (await api.patch(`/api/routines/items/${itemB.id}`).send({ reminderEnabled: true })).body.data;
    expect(t1.items.find((i: { id: string }) => i.id === itemB.id).reminder.enabled).toBe(true);
    const t2 = (await api.patch(`/api/routines/items/${itemA.id}`).send({ reminderEnabled: false })).body.data;
    const a = t2.items.find((i: { id: string }) => i.id === itemA.id);
    expect(a.reminder.enabled).toBe(false);
    expect(a.reminder.nextTriggerAt).toBeNull();
  });

  it('reorders items and copies a template to weekdays', async () => {
    const { api, template, itemA, itemB } = await setup();
    const re = await api.post(`/api/routines/templates/${template.id}/items/reorder`).send({ ids: [itemB.id, itemA.id] });
    expect(re.body.data.items.map((i: { id: string }) => i.id)).toEqual([itemB.id, itemA.id]);
    expect((await api.post(`/api/routines/templates/${template.id}/items/reorder`).send({ ids: [itemA.id] })).status).toBe(400);

    const copy = await api.post(`/api/routines/templates/${template.id}/copy`).send({ name: 'Weekend', weekdays: [6, 0] });
    expect(copy.status).toBe(201);
    expect(copy.body.data.weekdays).toEqual([0, 6]);
    expect(copy.body.data.items).toHaveLength(2);
    // Copying again under the same name updates that template instead of duplicating it.
    const again = await api.post(`/api/routines/templates/${template.id}/copy`).send({ name: 'Weekend', weekdays: [0] });
    expect(again.body.data.id).toBe(copy.body.data.id);
    expect(again.body.data.weekdays).toEqual([0]);
    const linked = await prisma.reminder.findMany({ where: { routineItemId: { in: again.body.data.items.map((i: { id: string }) => i.id) } } });
    expect(linked.every((r) => r.weekdays.join() === '0')).toBe(true);
  });

  it('completing a linked occurrence completes the routine entry', async () => {
    const { api, user, itemA } = await setup();
    const today = todayIn('Asia/Kolkata');
    await api.get(`/api/routines/day?date=${today}`);
    const reminder = await prisma.reminder.findFirstOrThrow({ where: { routineItemId: itemA.id } });
    const entry = await prisma.dailyRoutineEntry.findFirstOrThrow({ where: { userId: user.id, routineItemId: itemA.id, date: toDbDate(today) } });
    const occ = await prisma.reminderOccurrence.create({ data: { reminderId: reminder.id, userId: user.id, scheduledFor: entry.scheduledAt, status: 'SENT' } });
    expect((await api.post(`/api/reminders/occurrences/${occ.id}/complete`)).status).toBe(200);
    expect((await prisma.dailyRoutineEntry.findUniqueOrThrow({ where: { id: entry.id } })).status).toBe('COMPLETED');
  });

  it('snoozing a linked occurrence snoozes the entry; completing the entry settles the occurrence', async () => {
    const { api, user, itemA } = await setup();
    const today = todayIn('Asia/Kolkata');
    await api.get(`/api/routines/day?date=${today}`);
    const reminder = await prisma.reminder.findFirstOrThrow({ where: { routineItemId: itemA.id } });
    const entry = await prisma.dailyRoutineEntry.findFirstOrThrow({ where: { userId: user.id, routineItemId: itemA.id, date: toDbDate(today) } });
    const occ = await prisma.reminderOccurrence.create({ data: { reminderId: reminder.id, userId: user.id, scheduledFor: entry.scheduledAt, status: 'SENT' } });
    const sn = await api.post(`/api/reminders/occurrences/${occ.id}/snooze`).send({ minutes: 20 });
    expect(sn.status).toBe(200);
    const snoozedEntry = await prisma.dailyRoutineEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(snoozedEntry.status).toBe('SNOOZED');
    expect(snoozedEntry.snoozedUntil?.toISOString()).toBe(sn.body.data.snoozedUntil);

    const done = await api.patch(`/api/routines/entries/${entry.id}`).send({ status: 'COMPLETED' });
    expect(done.body.data).toMatchObject({ status: 'COMPLETED', snoozedUntil: null });
    expect((await prisma.reminderOccurrence.findUniqueOrThrow({ where: { id: occ.id } })).status).toBe('COMPLETED');
  });

  it('entry PATCH: time change keeps the entry date, snooze only when open, 404 for others', async () => {
    const { api, user } = await setup();
    const today = todayIn('Asia/Kolkata');
    const [a] = (await api.get(`/api/routines/day?date=${today}`)).body.data.entries;
    const moved = await api.patch(`/api/routines/entries/${a.id}`).send({ scheduledTime: '07:30' });
    expect(new Date(moved.body.data.scheduledAt).toISOString()).toBe(zonedToUtc(today, '07:30', 'Asia/Kolkata').toISOString());
    await api.patch(`/api/routines/entries/${a.id}`).send({ status: 'SKIPPED', skipReason: 'Sick' });
    expect((await api.patch(`/api/routines/entries/${a.id}`).send({ snoozeMinutes: 10 })).status).toBe(400);
    const reason = await api.patch(`/api/routines/entries/${a.id}`).send({ skipReason: 'Travel' });
    expect(reason.body.data).toMatchObject({ status: 'SKIPPED', skipReason: 'Travel' });
    const other = await createTestUser();
    expect((await other.api.patch(`/api/routines/entries/${a.id}`).send({ status: 'COMPLETED' })).status).toBe(404);
    expect((await prisma.dailyRoutineEntry.findUniqueOrThrow({ where: { id: a.id } })).userId).toBe(user.id);
  });

  it('items added after the day was viewed still appear (materialisation memo is invalidated)', async () => {
    const { api, template } = await setup();
    const today = todayIn('Asia/Kolkata');
    expect((await api.get(`/api/routines/day?date=${today}`)).body.data.entries).toHaveLength(2);
    await api.post(`/api/routines/templates/${template.id}/items`).send({ title: 'Dinner', category: 'DINNER', time: '20:00' });
    expect((await api.get(`/api/routines/day?date=${today}`)).body.data.entries).toHaveLength(3);
  });

  it('respects GYM/REST templates and the DailyLog day-type override', async () => {
    const u = await createTestUser({ gymWeekdays: ALL_DAYS });
    const gym = (await u.api.post('/api/routines/templates').send({ name: 'Gym', dayType: 'GYM' })).body.data;
    const rest = (await u.api.post('/api/routines/templates').send({ name: 'Rest', dayType: 'REST' })).body.data;
    await u.api.post(`/api/routines/templates/${gym.id}/items`).send({ title: 'Gym session', category: 'GYM', time: '18:00' });
    await u.api.post(`/api/routines/templates/${rest.id}/items`).send({ title: 'Walk', category: 'CUSTOM', time: '18:00' });
    const tomorrow = addDays(todayIn('Asia/Kolkata'), 1);
    await prisma.dailyLog.create({ data: { userId: u.user.id, date: toDbDate(tomorrow), timezone: 'Asia/Kolkata', dayType: 'REST' } });
    const day = (await u.api.get(`/api/routines/day?date=${tomorrow}`)).body.data;
    expect(day.dayType).toBe('REST');
    expect(day.entries.map((e: { title: string }) => e.title)).toEqual(['Walk']);
  });

  it('item time edit keeps per-day overrides; template on/off syncs reminders; copy replaces items', async () => {
    const { api, user, template, itemA, itemB } = await setup();
    const today = todayIn('Asia/Kolkata');
    const [a, b] = (await api.get(`/api/routines/day?date=${today}`)).body.data.entries;
    await api.patch(`/api/routines/entries/${b.id}`).send({ scheduledTime: '13:30' }); // per-day override
    await api.patch(`/api/routines/items/${itemB.id}`).send({ time: '12:30', title: 'Early lunch' });
    const bRow = await prisma.dailyRoutineEntry.findUniqueOrThrow({ where: { id: b.id } });
    expect(bRow).toMatchObject({ scheduledTime: '13:30', title: 'Early lunch' });
    const aRow = await prisma.dailyRoutineEntry.findUniqueOrThrow({ where: { id: a.id } });
    expect(aRow.scheduledTime).toBe('06:00');

    const off = (await api.patch(`/api/routines/templates/${template.id}`).send({ isActive: false })).body.data;
    expect(off.items.every((i: { reminder: { enabled: boolean } | null }) => !i.reminder || !i.reminder.enabled)).toBe(true);
    expect(await prisma.dailyRoutineEntry.count({ where: { userId: user.id, date: toDbDate(today), status: 'PENDING' } })).toBe(0);
    const on = (await api.patch(`/api/routines/templates/${template.id}`).send({ isActive: true })).body.data;
    const onA = on.items.find((i: { id: string }) => i.id === itemA.id);
    expect(onA.reminder).toMatchObject({ enabled: true });
    expect(onA.reminder.nextTriggerAt).toBeTruthy();
    expect((await prisma.reminder.findFirstOrThrow({ where: { routineItemId: itemA.id } })).enabled).toBe(true);

    const c1 = (await api.post(`/api/routines/templates/${template.id}/copy`).send({ name: 'Sundays', weekdays: [0] })).body.data;
    const oldIds = c1.items.map((i: { id: string }) => i.id);
    const c2 = (await api.post(`/api/routines/templates/${template.id}/copy`).send({ name: 'Sundays', weekdays: [0, 6] })).body.data;
    expect(c2.id).toBe(c1.id);
    expect(await prisma.routineItem.count({ where: { id: { in: oldIds } } })).toBe(0);
    expect(await prisma.reminder.count({ where: { routineItemId: { in: oldIds } } })).toBe(0);
    const fresh = (await api.get(`/api/routines/templates/${c2.id}`)).body.data;
    expect(fresh).toMatchObject({ weekdays: [0, 6], dayType: 'ANY' });
    expect(fresh.items.map((i: { title: string }) => i.title).sort()).toEqual(['Early lunch', 'Wake up']);

    expect((await api.delete(`/api/routines/templates/${c2.id}`)).status).toBe(204);
    expect((await api.delete(`/api/routines/templates/${c2.id}`)).status).toBe(404);
    expect((await api.delete(`/api/routines/items/${itemA.id}`)).status).toBe(204);
    expect((await api.delete(`/api/routines/items/${itemA.id}`)).status).toBe(404);
  });

  it('enforces ownership', async () => {
    const { template, itemA } = await setup();
    const other = await createTestUser();
    expect((await other.api.patch(`/api/routines/templates/${template.id}`).send({ name: 'x' })).status).toBe(404);
    expect((await other.api.patch(`/api/routines/items/${itemA.id}`).send({ title: 'x' })).status).toBe(404);
    expect((await other.api.post(`/api/routines/templates/${template.id}/items`).send({ title: 'x', time: '07:00' })).status).toBe(404);
    expect((await other.api.delete(`/api/routines/templates/${template.id}`)).status).toBe(404);
  });

  it('deactivating a template disables its reminders', async () => {
    const { api, template, itemA } = await setup();
    await api.patch(`/api/routines/templates/${template.id}`).send({ isActive: false });
    expect((await prisma.reminder.findFirstOrThrow({ where: { routineItemId: itemA.id } })).enabled).toBe(false);
  });
});
