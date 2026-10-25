import { describe, expect, it } from 'vitest';
import { createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { toDbDate } from '../../src/server/lib/dates';

const chicken = {
  name: 'Chicken breast',
  servingSize: 100,
  servingUnit: 'G',
  calories: 165,
  protein: 31,
  carbs: 0,
  fat: 3.6,
  fiber: 0,
  isEstimate: false,
};

async function setup() {
  const ctx = await createTestUser();
  const food = (await ctx.api.post('/api/foods').send(chicken)).body.data;
  const slot = (await ctx.api.post('/api/meals/slots').send({ name: 'Lunch', defaultTime: '13:00' })).body.data;
  await prisma.nutritionTarget.create({
    data: {
      userId: ctx.user.id,
      effectiveFrom: toDbDate('2026-01-01'),
      calories: 2000,
      protein: 150,
      proteinMin: 140,
      proteinMax: 170,
      carbs: 200,
      fat: 60,
      fiber: 30,
      waterMl: 3000,
    },
  });
  return { ...ctx, food, slot };
}

describe('food diary API', () => {
  it('logs a food with a nutrition snapshot and returns day totals and progress', async () => {
    const { api, food, slot } = await setup();
    const res = await api.post('/api/food-diary').send({
      date: '2026-03-02',
      slotId: slot.id,
      foodId: food.id,
      quantity: 150,
      unit: 'G',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      foodName: 'Chicken breast',
      quantity: 150,
      calories: 247.5,
      protein: 46.5,
      isEstimate: false,
    });
    expect(res.body.data.basis).toMatchObject({
      servingSize: 100,
      servingUnit: 'G',
      calories: 165,
    });

    const day = await api.get('/api/food-diary?date=2026-03-02');
    expect(day.status).toBe(200);
    expect(day.body.data.logged).toBe(true);
    expect(day.body.data.dayType).toBe('GYM'); // Monday
    expect(day.body.data.totals).toMatchObject({
      calories: 247.5,
      protein: 46.5,
    });
    const lunch = day.body.data.slots.find((s: { slot: { id: string } }) => s.slot.id === slot.id);
    expect(lunch.status).toBe('PENDING');
    expect(lunch.entries).toHaveLength(1);
    expect(day.body.data.progress.protein).toMatchObject({
      target: 150,
      actual: 46.5,
      status: 'under',
    });
    expect(day.body.data.target.calories).toBe(2000);
  });

  it('editing the food later never changes past entries (snapshot integrity)', async () => {
    const { api, food } = await setup();
    const entry = (await api.post('/api/food-diary').send({ date: '2026-03-02', foodId: food.id, quantity: 200, unit: 'G' })).body.data;
    await api.patch(`/api/foods/${food.id}`).send({
      name: 'Chicken (new recipe)',
      calories: 300,
      protein: 10,
      servingSize: 50,
    });

    const day = await api.get('/api/food-diary?date=2026-03-02');
    const after = day.body.data.unslotted.entries[0];
    expect(after).toMatchObject({
      id: entry.id,
      foodName: 'Chicken breast',
      calories: 330,
      protein: 62,
    });

    // Editing the entry recomputes from its own basis, not the changed food.
    const patched = await api.patch(`/api/food-diary/${entry.id}`).send({ quantity: 100 });
    expect(patched.body.data).toMatchObject({
      calories: 165,
      protein: 31,
      foodName: 'Chicken breast',
    });

    // Deleting the food keeps the entry.
    await api.delete(`/api/foods/${food.id}`);
    const kept = await api.get('/api/food-diary?date=2026-03-02');
    expect(kept.body.data.unslotted.entries[0]).toMatchObject({
      id: entry.id,
      foodId: null,
      calories: 165,
    });
  });

  it('rejects unit mismatches and invalid input with 400', async () => {
    const { api, food } = await setup();
    const mismatch = await api.post('/api/food-diary').send({
      date: '2026-03-02',
      foodId: food.id,
      quantity: 2,
      unit: 'PIECE',
    });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.message).toMatch(/convert/i);
    const servings = await api.post('/api/food-diary').send({
      date: '2026-03-02',
      foodId: food.id,
      quantity: 2,
      unit: 'SERVING',
    });
    expect(servings.status).toBe(201);
    expect(servings.body.data.calories).toBe(330);
    expect((await api.patch(`/api/food-diary/${servings.body.data.id}`).send({ unit: 'ML' })).status).toBe(400);
    expect((await api.post('/api/food-diary').send({ date: '2026-02-30', foodId: food.id, quantity: 1, unit: 'G' })).status).toBe(400);
    expect((await api.post('/api/food-diary').send({ date: '2026-03-02', foodId: food.id, quantity: 0, unit: 'G' })).status).toBe(400);
  });

  it('logs manual label entries and edits time, notes and slot', async () => {
    const { api, slot } = await setup();
    const res = await api.post('/api/food-diary/manual').send({
      date: '2026-03-03',
      foodName: 'Protein bar',
      quantity: 60,
      unit: 'G',
      calories: 220,
      protein: 20,
      carbs: 22,
      fat: 7,
      fiber: 3,
      notes: 'From the label',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      foodId: null,
      calories: 220,
      basis: { servingSize: 60, servingUnit: 'G', calories: 220 },
      isEstimate: false,
    });

    const half = await api.patch(`/api/food-diary/${res.body.data.id}`).send({
      quantity: 30,
      slotId: slot.id,
      consumedAt: '2026-03-03T10:15:00+05:30',
      notes: null,
    });
    expect(half.status).toBe(200);
    expect(half.body.data).toMatchObject({
      calories: 110,
      protein: 10,
      slotId: slot.id,
      notes: null,
    });
    expect(new Date(half.body.data.consumedAt).toISOString()).toBe('2026-03-03T04:45:00.000Z');

    expect((await api.delete(`/api/food-diary/${res.body.data.id}`)).status).toBe(204);
    const day = await api.get('/api/food-diary?date=2026-03-03');
    expect(day.body.data).toMatchObject({
      logged: false,
      totals: null,
      progress: null,
    });
  });

  it('range endpoint distinguishes missing days from zero', async () => {
    const { api, food } = await setup();
    await api.post('/api/food-diary').send({ date: '2026-04-01', foodId: food.id, quantity: 100, unit: 'G' });
    await api.post('/api/food-diary/manual').send({
      date: '2026-04-03',
      foodName: 'Black coffee',
      quantity: 1,
      unit: 'SERVING',
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    const res = await api.get('/api/food-diary/range?from=2026-04-01&to=2026-04-03');
    expect(res.status).toBe(200);
    const [d1, d2, d3] = res.body.data.days;
    expect(d1).toMatchObject({
      date: '2026-04-01',
      logged: true,
      totals: { calories: 165 },
    });
    expect(d2).toMatchObject({
      date: '2026-04-02',
      logged: false,
      totals: null,
    });
    expect(d3).toMatchObject({
      date: '2026-04-03',
      logged: true,
      totals: { calories: 0 },
    });
    expect(d1.target.calories).toBe(2000);
    expect((await api.get('/api/food-diary/range?from=2026-04-03&to=2026-04-01')).status).toBe(400);
  });

  it("users cannot read or modify each other's entries", async () => {
    const a = await setup();
    const b = await createTestUser();
    const entry = (
      await a.api.post('/api/food-diary').send({
        date: '2026-03-02',
        foodId: a.food.id,
        quantity: 100,
        unit: 'G',
      })
    ).body.data;
    expect((await b.api.patch(`/api/food-diary/${entry.id}`).send({ quantity: 1 })).status).toBe(404);
    expect((await b.api.delete(`/api/food-diary/${entry.id}`)).status).toBe(404);
    expect((await b.api.get('/api/food-diary?date=2026-03-02')).body.data.logged).toBe(false);
    // B cannot log A's food or into A's slot.
    expect(
      (
        await b.api.post('/api/food-diary').send({
          date: '2026-03-02',
          foodId: a.food.id,
          quantity: 100,
          unit: 'G',
        })
      ).status,
    ).toBe(400);
    const bFood = (await b.api.post('/api/foods').send(chicken)).body.data;
    expect(
      (
        await b.api.post('/api/food-diary').send({
          date: '2026-03-02',
          slotId: a.slot.id,
          foodId: bFood.id,
          quantity: 100,
          unit: 'G',
        })
      ).status,
    ).toBe(400);
  });
});

describe('food diary API (single round-trip paths)', () => {
  it('returns the day plan with ?withPlan=true', async () => {
    const { api, food, slot } = await setup();
    await api
      .post('/api/meals/templates')
      .send({
        name: 'Lunch plan',
        slotId: slot.id,
        dayType: 'ANY',
        items: [{ foodId: food.id, quantity: 100, unit: 'G' }],
      })
      .then(async (r) => {
        await api.put(`/api/meals/plan/${slot.id}`).send({ templateId: r.body.data.id, dayType: 'ANY' });
      });
    const day = (await api.get('/api/food-diary?date=2026-03-02&withPlan=true')).body.data;
    expect(day.slots).toHaveLength(1);
    expect(day.plan).toMatchObject({ date: '2026-03-02', dayType: 'GYM' });
    expect(day.plan.slots[0].template).toMatchObject({ name: 'Lunch plan' });
    expect(day.plan.slots[0].planned.min.calories).toBe(165);
    expect((await api.get('/api/food-diary?date=2026-03-02')).body.data.plan).toBeUndefined();
  });

  it("edits entries with a recomputed snapshot and protects other users' entries", async () => {
    const a = await setup();
    const b = await setup();
    const entry = (
      await a.api.post('/api/food-diary').send({
        date: '2026-03-02',
        slotId: a.slot.id,
        foodId: a.food.id,
        quantity: 100,
        unit: 'G',
      })
    ).body.data;
    expect((await b.api.patch(`/api/food-diary/${entry.id}`).send({ quantity: 50 })).status).toBe(404);
    expect((await b.api.delete(`/api/food-diary/${entry.id}`)).status).toBe(404);
    const edited = (await a.api.patch(`/api/food-diary/${entry.id}`).send({ quantity: 200, slotId: null, notes: 'big' })).body.data;
    expect(edited).toMatchObject({
      quantity: 200,
      unit: 'G',
      calories: 330,
      slotId: null,
      notes: 'big',
      date: '2026-03-02',
    });
    const moved = (await a.api.patch(`/api/food-diary/${entry.id}`).send({ date: '2026-03-03', slotId: a.slot.id })).body.data;
    expect(moved).toMatchObject({
      date: '2026-03-03',
      slotId: a.slot.id,
      calories: 330,
    });
  });
});
