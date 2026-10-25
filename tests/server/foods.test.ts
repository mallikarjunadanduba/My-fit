import { describe, expect, it } from 'vitest';
import { createTestUser } from './helpers';
import { prisma } from '../../src/server/db';

const egg = {
  name: 'Whole egg',
  servingSize: 1,
  servingUnit: 'PIECE',
  servingLabel: '1 large egg',
  calories: 72,
  protein: 6.3,
  carbs: 0.4,
  fat: 4.8,
  fiber: 0,
};

const oats = {
  name: 'Rolled oats',
  brand: 'Quaker',
  servingSize: 40,
  servingUnit: 'G',
  calories: 150,
  protein: 5,
  carbs: 27,
  fat: 3,
  fiber: 4,
};

describe('foods API', () => {
  it('creates, reads, updates and deletes a food with categories', async () => {
    const { api } = await createTestUser();
    const cat = await api.post('/api/foods/categories').send({ name: 'Breakfast staples' });
    expect(cat.status).toBe(201);
    expect(cat.body.data).toMatchObject({
      name: 'Breakfast staples',
      slug: 'breakfast-staples',
      isSystem: false,
    });

    const res = await api.post('/api/foods').send({
      ...egg,
      categoryIds: [cat.body.data.id],
      source: 'LABEL',
      isEstimate: false,
    });
    expect(res.status).toBe(201);
    const food = res.body.data;
    expect(food).toMatchObject({
      name: 'Whole egg',
      source: 'LABEL',
      isEstimate: false,
      isFavorite: false,
    });
    expect(food.categories.map((c: { id: string }) => c.id)).toEqual([cat.body.data.id]);

    const got = await api.get(`/api/foods/${food.id}`);
    expect(got.status).toBe(200);
    expect(got.body.data.servingLabel).toBe('1 large egg');

    const patched = await api.patch(`/api/foods/${food.id}`).send({ protein: 6.5, categoryIds: [] });
    expect(patched.status).toBe(200);
    expect(patched.body.data.protein).toBe(6.5);
    expect(patched.body.data.categories).toEqual([]);

    expect((await api.delete(`/api/foods/${food.id}`)).status).toBe(204);
    expect((await api.get(`/api/foods/${food.id}`)).status).toBe(404);
  });

  it('validates nutrients, serving size and units', async () => {
    const { api } = await createTestUser();
    for (const bad of [
      { ...egg, protein: -1 },
      { ...egg, servingSize: 0 },
      { ...egg, servingUnit: 'CUP' },
      { ...egg, name: '' },
    ]) {
      const res = await api.post('/api/foods').send(bad);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const badCat = await api.post('/api/foods').send({ ...egg, categoryIds: ['00000000-0000-4000-8000-000000000000'] });
    expect(badCat.status).toBe(400);
    const badImage = await api.post('/api/foods').send({ ...egg, imageMediaId: '00000000-0000-4000-8000-000000000000' });
    expect(badImage.status).toBe(400);
  });

  it('rejects media that belongs to another user', async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const media = await prisma.mediaAsset.create({
      data: {
        userId: b.user.id,
        kind: 'FOOD_REFERENCE',
        bucket: 'x',
        objectKey: `test/${b.user.id}/food.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 10,
      },
    });
    expect((await a.api.post('/api/foods').send({ ...egg, imageMediaId: media.id })).status).toBe(400);
    const own = await b.api.post('/api/foods').send({ ...egg, imageMediaId: media.id });
    expect(own.status).toBe(201);
    expect(own.body.data.imageMediaId).toBe(media.id);
  });

  it('searches, filters, sorts and paginates', async () => {
    const { api } = await createTestUser();
    const cat = (await api.post('/api/foods/categories').send({ name: 'Grains' })).body.data;
    await api.post('/api/foods').send({ ...oats, categoryIds: [cat.id] });
    await api.post('/api/foods').send(egg);
    await api.post('/api/foods').send({
      name: 'Whey protein',
      servingSize: 1,
      servingUnit: 'SCOOP',
      calories: 120,
      protein: 24,
      carbs: 3,
      fat: 1.5,
      fiber: 0,
    });
    await api.post('/api/foods').send({
      name: 'Chia seeds',
      servingSize: 15,
      servingUnit: 'G',
      calories: 73,
      protein: 2.5,
      carbs: 6,
      fat: 4.6,
      fiber: 5.2,
    });

    const byBrand = await api.get('/api/foods?search=quak');
    expect(byBrand.body.data.map((f: { name: string }) => f.name)).toEqual(['Rolled oats']);

    const byCat = await api.get(`/api/foods?categoryId=${cat.id}`);
    expect(byCat.body.data).toHaveLength(1);

    const highProtein = await api.get('/api/foods?minProtein=6&sort=protein');
    expect(highProtein.body.data.map((f: { name: string }) => f.name)).toEqual(['Whey protein', 'Whole egg']);

    const fiber = await api.get('/api/foods?minFiber=4&sort=fiber');
    expect(fiber.body.data.map((f: { name: string }) => f.name)).toEqual(['Chia seeds', 'Rolled oats']);

    const light = await api.get('/api/foods?maxCalories=100&sort=calories');
    expect(light.body.data.map((f: { name: string }) => f.name)).toEqual(['Whole egg', 'Chia seeds']);

    const page = await api.get('/api/foods?page=2&pageSize=3');
    expect(page.body.meta).toEqual({
      page: 2,
      pageSize: 3,
      total: 4,
      totalPages: 2,
    });
    expect(page.body.data).toHaveLength(1);
  });

  it('favourites come first and can be filtered; archived foods are hidden by default', async () => {
    const { api } = await createTestUser();
    const a = (await api.post('/api/foods').send(oats)).body.data;
    const b = (await api.post('/api/foods').send(egg)).body.data;
    const fav = await api.post(`/api/foods/${b.id}/favorite`).send({ isFavorite: true });
    expect(fav.body.data.isFavorite).toBe(true);

    const list = await api.get('/api/foods');
    expect(list.body.data[0].id).toBe(b.id);
    expect((await api.get('/api/foods?favorites=true')).body.data.map((f: { id: string }) => f.id)).toEqual([b.id]);

    expect((await api.post(`/api/foods/${a.id}/archive`)).body.data.archivedAt).not.toBeNull();
    expect((await api.get('/api/foods')).body.data.map((f: { id: string }) => f.id)).toEqual([b.id]);
    expect((await api.get('/api/foods?includeArchived=true')).body.data).toHaveLength(2);
    expect((await api.get('/api/foods?includeArchived=false')).body.data).toHaveLength(1);
    expect((await api.post(`/api/foods/${a.id}/unarchive`)).body.data.archivedAt).toBeNull();
  });

  it('prevents deleting system categories but allows renaming them', async () => {
    const { api, user } = await createTestUser();
    const sys = await prisma.foodCategory.create({
      data: {
        userId: user.id,
        name: 'Protein',
        slug: 'protein',
        isSystem: true,
      },
    });
    const renamed = await api.patch(`/api/foods/categories/${sys.id}`).send({ name: 'Protein sources' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({
      name: 'Protein sources',
      slug: 'protein',
    });
    expect((await api.delete(`/api/foods/categories/${sys.id}`)).status).toBe(400);

    const custom = (await api.post('/api/foods/categories').send({ name: 'Snacks' })).body.data;
    expect((await api.post('/api/foods/categories').send({ name: 'snacks' })).status).toBe(409);
    expect((await api.delete(`/api/foods/categories/${custom.id}`)).status).toBe(204);
    const cats = await api.get('/api/foods/categories');
    expect(cats.body.data.map((c: { name: string }) => c.name)).toEqual(['Protein sources']);
  });

  it("keeps users' foods private", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const food = (await a.api.post('/api/foods').send(egg)).body.data;
    const cat = (await a.api.post('/api/foods/categories').send({ name: 'Mine' })).body.data;
    expect((await b.api.get(`/api/foods/${food.id}`)).status).toBe(404);
    expect((await b.api.patch(`/api/foods/${food.id}`).send({ name: 'Hacked' })).status).toBe(404);
    expect((await b.api.post(`/api/foods/${food.id}/favorite`).send({ isFavorite: true })).status).toBe(404);
    expect((await b.api.post(`/api/foods/${food.id}/archive`)).status).toBe(404);
    expect((await b.api.delete(`/api/foods/${food.id}`)).status).toBe(404);
    expect((await b.api.patch(`/api/foods/categories/${cat.id}`).send({ name: 'x' })).status).toBe(404);
    expect((await b.api.delete(`/api/foods/categories/${cat.id}`)).status).toBe(404);
    expect((await b.api.get('/api/foods')).body.data).toEqual([]);
    // B cannot attach A's category to their own food.
    expect((await b.api.post('/api/foods').send({ ...egg, categoryIds: [cat.id] })).status).toBe(400);
  });
});

describe('foods API (single round-trip paths)', () => {
  it('favourite/archive keep categories and are owner-scoped', async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const cat = (await a.api.post('/api/foods/categories').send({ name: 'Eggs' })).body.data;
    const food = (await a.api.post('/api/foods').send({ ...egg, categoryIds: [cat.id] })).body.data;
    const fav = (await a.api.post(`/api/foods/${food.id}/favorite`).send({ isFavorite: true })).body.data;
    expect(fav).toMatchObject({
      isFavorite: true,
      servingUnit: 'PIECE',
      name: 'Whole egg',
    });
    expect(fav.categories.map((c: { id: string }) => c.id)).toEqual([cat.id]);
    expect((await b.api.post(`/api/foods/${food.id}/favorite`).send({ isFavorite: false })).status).toBe(404);
    expect((await b.api.post(`/api/foods/${food.id}/archive`)).status).toBe(404);
    expect((await b.api.delete(`/api/foods/${food.id}`)).status).toBe(404);
    const edited = (await a.api.patch(`/api/foods/${food.id}`).send({ servingUnit: 'G', servingSize: 50, source: 'LABEL' })).body.data;
    expect(edited).toMatchObject({
      servingUnit: 'G',
      servingSize: 50,
      source: 'LABEL',
    });
    expect(edited.categories).toHaveLength(1);
    const list = (await a.api.get('/api/foods?search=whole')).body;
    expect(list.meta.total).toBe(1);
    expect(list.data[0].categories[0].name).toBe('Eggs');
  });
});
