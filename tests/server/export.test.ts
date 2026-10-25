import { describe, expect, it } from 'vitest';
import { anon, createTestUser } from './helpers';
import { prisma } from '../../src/server/db';
import { toDbDate } from '../../src/server/lib/dates';
import { csvCell, toCsv } from '../../src/server/services/export.service';

const entry = (userId: string, date: string, foodName: string, calories: number, notes: string | null = null) =>
  prisma.foodDiaryEntry.create({
    data: {
      userId,
      date: toDbDate(date),
      foodName,
      notes,
      quantity: 1,
      unit: 'SERVING',
      basisServingSize: 1,
      basisServingUnit: 'SERVING',
      basisCalories: calories,
      basisProtein: 10,
      basisCarbs: 10,
      basisFat: 5,
      basisFiber: 1,
      calories,
      protein: 10,
      carbs: 10,
      fat: 5,
      fiber: 1,
    },
  });

describe('csv helpers', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(true)).toBe('true');
  });

  it('neutralises formula injection', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+CMD')).toBe("'+CMD");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
  });

  it('builds a header + CRLF rows', () => {
    expect(toCsv(['a', 'b'], [{ a: 1, b: 'x' }, { a: null, b: 'y,z' }])).toBe('a,b\r\n1,x\r\n,"y,z"\r\n');
  });
});

describe('GET /api/export', () => {
  it('requires authentication', async () => {
    expect((await anon().get('/api/export?format=json&dataset=all')).status).toBe(401);
  });

  it('exports diary CSV as an attachment, escaped, and scoped to the user', async () => {
    const { user, api } = await createTestUser();
    const other = await createTestUser();
    await entry(user.id, '2025-04-02', '=HYPERLINK("http://evil","x")', 100);
    await entry(user.id, '2025-04-03', 'Eggs, boiled "large"', 155, 'two\nlines');
    await entry(user.id, '2025-04-04', '@risky', 50);
    await entry(user.id, '2025-05-01', 'Outside range', 70);
    await entry(other.user.id, '2025-04-02', 'OTHER USER SECRET', 999);

    const res = await api.get('/api/export?format=csv&dataset=diary&from=2025-04-01&to=2025-04-30');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="myfit-diary-2025-04-01-to-2025-04-30.csv"');
    const text = res.text;
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('date,meal,food,brand,quantity,unit,calories,protein_g,carbs_g,fat_g,fiber_g,estimate,consumed_at,notes');
    expect(text).toContain('"\'=HYPERLINK(""http://evil"",""x"")"');
    expect(text).toContain('"Eggs, boiled ""large"""');
    expect(text).toContain('"two\nlines"');
    expect(text).toContain("'@risky");
    expect(text).not.toContain('OTHER USER SECRET');
    expect(text).not.toContain('Outside range');
  });

  it('exports everything as one JSON object of arrays without secrets', async () => {
    const { user, api } = await createTestUser();
    await entry(user.id, '2025-04-02', 'Oats', 300);
    await prisma.waterEntry.create({ data: { userId: user.id, date: toDbDate('2025-04-02'), amountMl: 750 } });
    await prisma.nutritionTarget.create({
      data: { userId: user.id, effectiveFrom: toDbDate('2025-01-01'), calories: 2100, protein: 150, carbs: 220, fat: 60, fiber: 30, waterMl: 3000 },
    });
    await prisma.foodItem.create({ data: { userId: user.id, name: 'Paneer', servingSize: 100, servingUnit: 'G', calories: 265, protein: 18, carbs: 3, fat: 20 } });

    const res = await api.get('/api/export?format=json&dataset=all&from=2025-04-01&to=2025-04-30');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="myfit-all-2025-04-01-to-2025-04-30.json"');
    const body = JSON.parse(res.text);
    for (const k of ['diary', 'water', 'workouts', 'measurements', 'routine', 'reminders', 'targets', 'foods']) expect(Array.isArray(body[k])).toBe(true);
    expect(body.diary).toHaveLength(1);
    expect(body.water[0].amount_ml).toBe(750);
    expect(body.targets[0].calories).toBe(2100);
    expect(body.foods[0].name).toBe('Paneer');
    expect(res.text).not.toMatch(/passwordHash|tokenHash|not-a-real-hash|p256dh/);
    expect(res.text).not.toContain(user.id);
  });

  it('rejects CSV for all datasets and invalid parameters', async () => {
    const { api } = await createTestUser();
    const all = await api.get('/api/export?format=csv&dataset=all');
    expect(all.status).toBe(400);
    expect(all.body.error.message).toMatch(/choose a dataset/i);
    expect((await api.get('/api/export?format=xml&dataset=diary')).status).toBe(400);
    expect((await api.get('/api/export?format=csv&dataset=users')).status).toBe(400);
    expect((await api.get('/api/export?format=csv&dataset=diary&from=2025-05-01&to=2025-04-01')).status).toBe(400);
  });
});
