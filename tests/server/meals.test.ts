import { describe, expect, it } from 'vitest';
import { createTestUser } from './helpers';

type Api = Awaited<ReturnType<typeof createTestUser>>['api'];

async function setup() {
  const ctx = await createTestUser({ gymWeekdays: [1, 2, 3, 4, 5, 6] });
  const { api } = ctx;
  const mk = async (body: object) => (await api.post('/api/foods').send(body)).body.data;
  const oats = await mk({
    name: 'Oats',
    servingSize: 40,
    servingUnit: 'G',
    calories: 150,
    protein: 5,
    carbs: 27,
    fat: 3,
    fiber: 4,
  });
  const milk = await mk({
    name: 'Milk',
    servingSize: 100,
    servingUnit: 'ML',
    calories: 60,
    protein: 3.2,
    carbs: 4.8,
    fat: 3.2,
    fiber: 0,
  });
  const egg = await mk({
    name: 'Egg',
    servingSize: 1,
    servingUnit: 'PIECE',
    calories: 72,
    protein: 6,
    carbs: 0.4,
    fat: 5,
    fiber: 0,
  });
  const tofu = await mk({
    name: 'Tofu',
    servingSize: 100,
    servingUnit: 'G',
    calories: 76,
    protein: 8,
    carbs: 1.9,
    fat: 4.8,
    fiber: 0.3,
  });
  const breakfast = (await api.post('/api/meals/slots').send({ name: 'Breakfast', defaultTime: '08:00' })).body.data;
  const lunch = (await api.post('/api/meals/slots').send({ name: 'Lunch', defaultTime: '13:00' })).body.data;
  return { ...ctx, foods: { oats, milk, egg, tofu }, breakfast, lunch };
}

async function createBreakfast(api: Api, slotId: string, f: Awaited<ReturnType<typeof setup>>['foods'], dayType = 'GYM') {
  const res = await api.post('/api/meals/templates').send({
    name: 'Gym breakfast',
    slotId,
    dayType,
    items: [
      { foodId: f.oats.id, quantity: 40, quantityMax: 60, unit: 'G' },
      {
        foodId: f.egg.id,
        quantity: 2,
        unit: 'PIECE',
        alternatives: [{ foodId: f.tofu.id, quantity: 100, unit: 'G' }],
      },
      { foodId: f.milk.id, quantity: 200, unit: 'ML', isOptional: true },
      { customName: 'Black coffee', quantity: 1, unit: 'SERVING' },
    ],
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

describe('meal slots', () => {
  it('creates, edits, reorders and archives-or-deletes slots', async () => {
    const { api, breakfast, lunch, foods } = await setup();
    const patched = await api.patch(`/api/meals/slots/${lunch.id}`).send({ name: 'Big lunch', defaultTime: '12:30' });
    expect(patched.body.data).toMatchObject({
      name: 'Big lunch',
      defaultTime: '12:30',
    });
    expect((await api.patch(`/api/meals/slots/${lunch.id}`).send({ defaultTime: '25:00' })).status).toBe(400);

    const reordered = await api.post('/api/meals/slots/reorder').send({ ids: [lunch.id, breakfast.id] });
    expect(reordered.body.data.map((s: { id: string }) => s.id)).toEqual([lunch.id, breakfast.id]);

    // Breakfast has history → archived instead of deleted.
    await api.post('/api/food-diary').send({
      date: '2026-03-02',
      slotId: breakfast.id,
      foodId: foods.egg.id,
      quantity: 1,
      unit: 'PIECE',
    });
    const del = await api.delete(`/api/meals/slots/${breakfast.id}`);
    expect(del.status).toBe(200);
    expect(del.body.data.archived).toBe(true);
    expect((await api.get('/api/meals/slots')).body.data.map((s: { id: string }) => s.id)).toEqual([lunch.id]);
    expect((await api.get('/api/meals/slots?includeArchived=true')).body.data).toHaveLength(2);
    // The archived slot still shows on the day it has entries.
    const day = await api.get('/api/food-diary?date=2026-03-02');
    expect(day.body.data.slots.map((s: { slot: { id: string } }) => s.slot.id)).toContain(breakfast.id);

    expect((await api.delete(`/api/meals/slots/${lunch.id}`)).status).toBe(204);
  });
});

describe('meal templates and plan', () => {
  it('stores items with ranges, alternatives and computed nutrition', async () => {
    const { api, breakfast, foods } = await setup();
    const t = await createBreakfast(api, breakfast.id, foods);
    expect(t.items).toHaveLength(4);
    const [oats, egg, milk, coffee] = t.items;
    expect(oats).toMatchObject({
      quantity: 40,
      quantityMax: 60,
      nutrition: { calories: 150 },
      nutritionMax: { calories: 225 },
    });
    expect(egg.alternatives).toHaveLength(1);
    expect(egg.alternatives[0]).toMatchObject({
      displayName: 'Tofu',
      nutrition: { calories: 76 },
    });
    expect(milk.isOptional).toBe(true);
    expect(coffee).toMatchObject({
      displayName: 'Black coffee',
      food: null,
      nutrition: null,
    });
    // Planned total = oats + 2 eggs (optional milk and coffee excluded).
    expect(t.planned.min.calories).toBe(294);
    expect(t.planned.max.calories).toBe(369);

    const got = await api.get(`/api/meals/templates/${t.id}`);
    expect(got.body.data.items[1].alternatives[0].food.name).toBe('Tofu');
  });

  it('validates template items (unit mismatch, missing food/name, ranges)', async () => {
    const { api, breakfast, foods } = await setup();
    const bad = async (item: object) => (await api.post('/api/meals/templates').send({ name: 'x', slotId: breakfast.id, items: [item] })).status;
    expect(await bad({ foodId: foods.egg.id, quantity: 50, unit: 'G' })).toBe(400);
    expect(await bad({ quantity: 1, unit: 'G' })).toBe(400);
    expect(
      await bad({
        foodId: foods.oats.id,
        quantity: 60,
        quantityMax: 40,
        unit: 'G',
      }),
    ).toBe(400);
  });

  it('editing a template replaces items and never alters logged entries', async () => {
    const { api, breakfast, foods } = await setup();
    const t = await createBreakfast(api, breakfast.id, foods);
    const applied = await api.post('/api/meals/apply-template').send({ date: '2026-03-02', slotId: breakfast.id, templateId: t.id });
    expect(applied.status).toBe(201);
    const before = applied.body.data.entries;

    const upd = await api.patch(`/api/meals/templates/${t.id}`).send({
      name: 'Lighter breakfast',
      items: [{ foodId: foods.oats.id, quantity: 20, unit: 'G' }],
    });
    expect(upd.status).toBe(200);
    expect(upd.body.data.items).toHaveLength(1);
    expect(upd.body.data.name).toBe('Lighter breakfast');

    const day = await api.get('/api/food-diary?date=2026-03-02');
    const entries = day.body.data.slots.find((s: { slot: { id: string } }) => s.slot.id === breakfast.id).entries;
    expect(entries.map((e: { calories: number }) => e.calories)).toEqual(before.map((e: { calories: number }) => e.calories));
    expect(entries.every((e: { templateItemId: string | null }) => e.templateItemId === null)).toBe(true);
  });

  it('resolves the plan by day type with ANY fallback and sets plans per slot', async () => {
    const { api, breakfast, lunch, foods } = await setup();
    const gym = await createBreakfast(api, breakfast.id, foods, 'GYM');
    const any = (
      await api.post('/api/meals/templates').send({
        name: 'Any breakfast',
        slotId: breakfast.id,
        dayType: 'ANY',
        items: [{ foodId: foods.egg.id, quantity: 3, unit: 'PIECE' }],
      })
    ).body.data;

    expect((await api.put(`/api/meals/plan/${breakfast.id}`).send({ templateId: gym.id, dayType: 'GYM' })).status).toBe(200);
    expect((await api.put(`/api/meals/plan/${breakfast.id}`).send({ templateId: any.id, dayType: 'ANY' })).status).toBe(200);

    // 2026-03-02 is a Monday (gym day), 2026-03-01 is a Sunday (rest day).
    const gymDay = (await api.get('/api/meals/plan?date=2026-03-02')).body.data;
    expect(gymDay.dayType).toBe('GYM');
    const gb = gymDay.slots.find((s: { slot: { id: string } }) => s.slot.id === breakfast.id);
    expect(gb.template.id).toBe(gym.id);
    expect(gb.status).toBe('PENDING');
    expect(gymDay.slots.find((s: { slot: { id: string } }) => s.slot.id === lunch.id).template).toBeNull();
    expect(gymDay.totals.min.calories).toBe(294);

    const restDay = (await api.get('/api/meals/plan?date=2026-03-01')).body.data;
    expect(restDay.dayType).toBe('REST');
    const rb = restDay.slots.find((s: { slot: { id: string } }) => s.slot.id === breakfast.id);
    expect(rb).toMatchObject({ inherited: true, template: { id: any.id } });

    // Setting a new GYM plan unsets the old one.
    const alt = (await api.post(`/api/meals/templates/${gym.id}/duplicate`).send({})).body.data;
    expect(alt.name).toBe('Gym breakfast (copy)');
    expect(alt.isPlan).toBe(false);
    expect(alt.items).toHaveLength(4);
    expect(alt.items[1].alternatives).toHaveLength(1);
    await api.put(`/api/meals/plan/${breakfast.id}`).send({ templateId: alt.id, dayType: 'GYM' });
    expect((await api.get(`/api/meals/templates/${gym.id}`)).body.data.isPlan).toBe(false);
    expect((await api.get('/api/meals/plan?dayType=GYM')).body.data.slots[0].template.id).toBe(alt.id);

    // Using the ANY plan template as the REST plan keeps the ANY plan by duplicating it.
    const rest = await api.put(`/api/meals/plan/${breakfast.id}`).send({ templateId: any.id, dayType: 'REST' });
    expect(rest.body.data).toMatchObject({ dayType: 'REST', isPlan: true });
    expect(rest.body.data.id).not.toBe(any.id);
    expect((await api.get(`/api/meals/templates/${any.id}`)).body.data.isPlan).toBe(true);

    // Clearing.
    await api.put(`/api/meals/plan/${breakfast.id}`).send({ templateId: null, dayType: 'GYM' });
    expect((await api.get('/api/meals/plan?dayType=GYM')).body.data.slots[0]).toMatchObject({ inherited: true, template: { id: any.id } });
  });

  it('archives and deletes templates', async () => {
    const { api, breakfast, foods } = await setup();
    const t = await createBreakfast(api, breakfast.id, foods);
    await api.put(`/api/meals/plan/${breakfast.id}`).send({ templateId: t.id, dayType: 'GYM' });
    const arch = await api.post(`/api/meals/templates/${t.id}/archive`);
    expect(arch.body.data).toMatchObject({ isPlan: false });
    expect((await api.get('/api/meals/templates')).body.data).toHaveLength(0);
    expect((await api.get('/api/meals/templates?includeArchived=true')).body.data).toHaveLength(1);
    expect((await api.delete(`/api/meals/templates/${t.id}`)).status).toBe(204);
    expect((await api.get(`/api/meals/templates/${t.id}`)).status).toBe(404);
  });
});

describe('meal logging', () => {
  it('apply-template creates snapshot entries and sets COMPLETED', async () => {
    const { api, breakfast, foods } = await setup();
    const t = await createBreakfast(api, breakfast.id, foods);
    const res = await api.post('/api/meals/apply-template').send({ date: '2026-03-02', slotId: breakfast.id, templateId: t.id });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toMatchObject({
      status: 'COMPLETED',
      templateId: t.id,
    });
    expect(res.body.data.status.completedAt).not.toBeNull();
    // Required items only: oats + egg (coffee is free text → no entry; milk optional).
    expect(res.body.data.entries.map((e: { foodName: string }) => e.foodName).sort()).toEqual(['Egg', 'Oats']);

    const day = (await api.get('/api/food-diary?date=2026-03-02')).body.data;
    expect(day.totals.calories).toBe(294);
    expect(day.slots.find((s: { slot: { id: string } }) => s.slot.id === breakfast.id).status).toBe('COMPLETED');
  });

  it('supports selected items, alternatives and overrides; marks PARTIAL when a required item is missing', async () => {
    const { api, breakfast, foods } = await setup();
    const t = await createBreakfast(api, breakfast.id, foods);
    const [oats, egg, milk] = t.items;
    const tofuAlt = egg.alternatives[0];

    const full = await api.post('/api/meals/apply-template').send({
      date: '2026-03-03',
      slotId: breakfast.id,
      templateId: t.id,
      itemIds: [oats.id, tofuAlt.id, milk.id, t.items[3].id],
      overrides: [{ itemId: oats.id, quantity: 60, unit: 'G' }],
    });
    expect(full.status).toBe(201);
    expect(full.body.data.status.status).toBe('COMPLETED');
    const byName = Object.fromEntries(full.body.data.entries.map((e: { foodName: string; calories: number }) => [e.foodName, e.calories]));
    expect(byName).toEqual({ Oats: 225, Tofu: 76, Milk: 120 });

    const partial = await api.post('/api/meals/apply-template').send({
      date: '2026-03-04',
      slotId: breakfast.id,
      templateId: t.id,
      itemIds: [egg.id],
      overrides: [{ itemId: egg.id, foodId: foods.tofu.id, quantity: 150, unit: 'G' }],
    });
    expect(partial.body.data.status.status).toBe('PARTIAL');
    expect(partial.body.data.entries[0]).toMatchObject({
      foodName: 'Tofu',
      calories: 114,
    });

    const mismatch = await api.post('/api/meals/apply-template').send({
      date: '2026-03-05',
      slotId: breakfast.id,
      templateId: t.id,
      overrides: [{ itemId: oats.id, quantity: 2, unit: 'PIECE' }],
    });
    expect(mismatch.status).toBe(400);
    expect((await api.get('/api/food-diary?date=2026-03-05')).body.data.logged).toBe(false);
  });

  it('sets meal status explicitly with completedAt only for COMPLETED/PARTIAL', async () => {
    const { api, lunch } = await setup();
    const done = await api.put('/api/meals/status').send({
      date: '2026-03-02',
      slotId: lunch.id,
      status: 'COMPLETED',
      notes: 'Ate out',
    });
    expect(done.body.data).toMatchObject({
      status: 'COMPLETED',
      notes: 'Ate out',
    });
    expect(done.body.data.completedAt).not.toBeNull();
    const skipped = await api.put('/api/meals/status').send({ date: '2026-03-02', slotId: lunch.id, status: 'SKIPPED' });
    expect(skipped.body.data).toMatchObject({
      status: 'SKIPPED',
      completedAt: null,
      notes: 'Ate out',
    });
    expect((await api.put('/api/meals/status').send({ date: '2026-03-02', slotId: lunch.id, status: 'EATEN' })).status).toBe(400);
  });

  it('copies a previous day', async () => {
    const { api, breakfast, lunch, foods } = await setup();
    const t = await createBreakfast(api, breakfast.id, foods);
    await api.post('/api/meals/apply-template').send({ date: '2026-03-02', slotId: breakfast.id, templateId: t.id });
    await api.post('/api/food-diary').send({
      date: '2026-03-02',
      slotId: lunch.id,
      foodId: foods.tofu.id,
      quantity: 200,
      unit: 'G',
    });

    const onlyBreakfast = await api.post('/api/meals/copy-day').send({
      fromDate: '2026-03-02',
      toDate: '2026-03-03',
      slotIds: [breakfast.id],
    });
    expect(onlyBreakfast.status).toBe(201);
    expect(onlyBreakfast.body.data).toEqual({ copied: 2, statuses: 1 });
    const d3 = (await api.get('/api/food-diary?date=2026-03-03')).body.data;
    expect(d3.totals.calories).toBe(294);
    const b3 = d3.slots.find((s: { slot: { id: string } }) => s.slot.id === breakfast.id);
    expect(b3.status).toBe('COMPLETED');
    expect(b3.entries.every((e: { consumedAt: string | null }) => e.consumedAt === null)).toBe(true);

    const all = await api.post('/api/meals/copy-day').send({ fromDate: '2026-03-02', toDate: '2026-03-04' });
    expect(all.body.data.copied).toBe(3);
    expect((await api.post('/api/meals/copy-day').send({ fromDate: '2026-02-01', toDate: '2026-03-04' })).status).toBe(409);
    expect((await api.post('/api/meals/copy-day').send({ fromDate: '2026-03-04', toDate: '2026-03-04' })).status).toBe(400);
  });

  it("cannot touch another user's slots, templates or plan", async () => {
    const a = await setup();
    const b = await setup();
    const t = await createBreakfast(a.api, a.breakfast.id, a.foods);
    expect((await b.api.get(`/api/meals/templates/${t.id}`)).status).toBe(404);
    expect((await b.api.patch(`/api/meals/templates/${t.id}`).send({ name: 'x' })).status).toBe(404);
    expect((await b.api.delete(`/api/meals/templates/${t.id}`)).status).toBe(404);
    expect((await b.api.post(`/api/meals/templates/${t.id}/duplicate`).send({})).status).toBe(404);
    expect((await b.api.patch(`/api/meals/slots/${a.breakfast.id}`).send({ name: 'x' })).status).toBe(404);
    expect((await b.api.put(`/api/meals/plan/${b.breakfast.id}`).send({ templateId: t.id, dayType: 'GYM' })).status).toBe(404);
    expect(
      (
        await b.api.post('/api/meals/apply-template').send({
          date: '2026-03-02',
          slotId: b.breakfast.id,
          templateId: t.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await b.api.put('/api/meals/status').send({
          date: '2026-03-02',
          slotId: a.breakfast.id,
          status: 'SKIPPED',
        })
      ).status,
    ).toBe(404);
    expect((await b.api.post('/api/meals/slots/reorder').send({ ids: [a.breakfast.id] })).status).toBe(400);
    // B's template cannot reference A's food.
    const res = await b.api.post('/api/meals/templates').send({
      name: 'x',
      items: [{ foodId: a.foods.oats.id, quantity: 40, unit: 'G' }],
    });
    expect(res.status).toBe(400);
  });
});

describe('meal status (single-statement upsert)', () => {
  it('keeps the first completion time, preserves notes and rejects foreign slots/templates', async () => {
    const { api, breakfast, foods } = await setup();
    const other = await setup();
    const done = (
      await api.put('/api/meals/status').send({
        date: '2026-03-02',
        slotId: breakfast.id,
        status: 'COMPLETED',
        notes: 'ate early',
      })
    ).body.data;
    expect(done).toMatchObject({
      status: 'COMPLETED',
      notes: 'ate early',
      date: '2026-03-02',
    });
    expect(done.completedAt).toBeTruthy();
    const partial = (await api.put('/api/meals/status').send({ date: '2026-03-02', slotId: breakfast.id, status: 'PARTIAL' })).body.data;
    expect(partial).toMatchObject({
      status: 'PARTIAL',
      notes: 'ate early',
      completedAt: done.completedAt,
    });
    const pending = (
      await api.put('/api/meals/status').send({
        date: '2026-03-02',
        slotId: breakfast.id,
        status: 'PENDING',
        notes: null,
      })
    ).body.data;
    expect(pending).toMatchObject({
      status: 'PENDING',
      notes: null,
      completedAt: null,
    });

    expect((await other.api.put('/api/meals/status').send({ date: '2026-03-02', slotId: breakfast.id, status: 'SKIPPED' })).status).toBe(404);
    const t = await createBreakfast(api, breakfast.id, foods);
    const foreignTpl = await other.api.put('/api/meals/status').send({
      date: '2026-03-02',
      slotId: other.breakfast.id,
      status: 'SKIPPED',
      templateId: t.id,
    });
    expect(foreignTpl.status).toBe(404);
    expect(foreignTpl.body.error.message).toMatch(/template/i);
  });
});
