import type { FoodUnit } from '@prisma/client';

/**
 * Starter food library. Values are per serving and are ESTIMATES from standard food-composition
 * references (USDA FoodData Central / Indian Food Composition Tables). Users can edit everything.
 */

export const SEED_CATEGORIES = [
  { slug: 'protein-rich', name: 'Protein-rich' },
  { slug: 'high-fiber', name: 'High-fiber' },
  { slug: 'carbohydrates', name: 'Carbohydrates' },
  { slug: 'fats', name: 'Fats' },
  { slug: 'vegetables', name: 'Vegetables' },
  { slug: 'fruits', name: 'Fruits' },
  { slug: 'dairy', name: 'Dairy' },
  { slug: 'snacks', name: 'Snacks' },
  { slug: 'beverages', name: 'Beverages' },
  { slug: 'supplements', name: 'Supplements' },
] as const;

export type CategorySlug = (typeof SEED_CATEGORIES)[number]['slug'];

export interface SeedFood {
  key: string;
  name: string;
  preparation?: string;
  servingSize: number;
  servingUnit: FoodUnit;
  servingLabel: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  categories: CategorySlug[];
  notes?: string;
}

export const ESTIMATE_NOTE = 'Estimated values from standard food-composition references. Check labels and adjust for your brand/recipe.';

export const SEED_FOODS: SeedFood[] = [
  // Protein
  { key: 'egg', name: 'Whole egg', preparation: 'Boiled / poached', servingSize: 1, servingUnit: 'PIECE', servingLabel: '1 large egg (≈50 g)', calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8, fiber: 0, categories: ['protein-rich', 'fats'] },
  { key: 'eggWhite', name: 'Egg white', preparation: 'Boiled / cooked', servingSize: 1, servingUnit: 'PIECE', servingLabel: '1 large egg white (≈33 g)', calories: 17, protein: 3.6, carbs: 0.2, fat: 0.1, fiber: 0, categories: ['protein-rich'] },
  { key: 'chicken', name: 'Chicken breast', preparation: 'Cooked, skinless', servingSize: 100, servingUnit: 'G', servingLabel: '100 g cooked', calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, categories: ['protein-rich'], notes: 'Weigh after cooking. Raw weight is roughly 1.3× cooked weight.' },
  { key: 'fish', name: 'Fish (rohu / basa)', preparation: 'Cooked, minimal oil', servingSize: 100, servingUnit: 'G', servingLabel: '100 g cooked', calories: 120, protein: 20, carbs: 0, fat: 4.4, fiber: 0, categories: ['protein-rich'] },
  { key: 'paneer', name: 'Low-fat paneer', servingSize: 100, servingUnit: 'G', servingLabel: '100 g', calories: 186, protein: 20, carbs: 4, fat: 10, fiber: 0, categories: ['protein-rich', 'dairy'], notes: 'Low-fat paneer varies a lot by brand — use the label if available.' },
  { key: 'tofu', name: 'Tofu (firm)', servingSize: 100, servingUnit: 'G', servingLabel: '100 g', calories: 144, protein: 17.3, carbs: 2.8, fat: 8.7, fiber: 2.3, categories: ['protein-rich'] },
  { key: 'soya', name: 'Soya chunks', preparation: 'Dry weight', servingSize: 25, servingUnit: 'G', servingLabel: '25 g dry', calories: 86, protein: 13, carbs: 8.3, fat: 0.1, fiber: 3.3, categories: ['protein-rich', 'high-fiber'] },
  { key: 'whey', name: 'Whey protein', servingSize: 1, servingUnit: 'SCOOP', servingLabel: '1 scoop (≈30 g)', calories: 120, protein: 24, carbs: 3, fat: 1.5, fiber: 0, categories: ['protein-rich', 'supplements'], notes: 'Generic whey estimate — replace with the values on your tub.' },

  // Dairy
  { key: 'curd', name: 'Low-fat curd', servingSize: 100, servingUnit: 'G', servingLabel: '100 g', calories: 55, protein: 3.5, carbs: 4.7, fat: 2.4, fiber: 0, categories: ['dairy'] },
  { key: 'greekYogurt', name: 'Low-fat Greek yogurt', preparation: 'Plain, unsweetened', servingSize: 100, servingUnit: 'G', servingLabel: '100 g', calories: 73, protein: 10, carbs: 3.6, fat: 2, fiber: 0, categories: ['dairy', 'protein-rich'] },
  { key: 'tonedMilk', name: 'Toned milk', servingSize: 200, servingUnit: 'ML', servingLabel: '1 glass (200 ml)', calories: 116, protein: 6.2, carbs: 9.4, fat: 6, fiber: 0, categories: ['dairy', 'beverages'] },
  { key: 'skimMilk', name: 'Skimmed milk', servingSize: 200, servingUnit: 'ML', servingLabel: '1 glass (200 ml)', calories: 70, protein: 7, carbs: 10, fat: 0.2, fiber: 0, categories: ['dairy', 'beverages', 'protein-rich'] },
  { key: 'buttermilk', name: 'Buttermilk (chaas)', preparation: 'Unsweetened', servingSize: 200, servingUnit: 'ML', servingLabel: '1 glass (200 ml)', calories: 40, protein: 2.4, carbs: 3.6, fat: 1.6, fiber: 0, categories: ['dairy', 'beverages'] },

  // Legumes
  { key: 'dal', name: 'Dal', preparation: 'Cooked (toor / moong), light tempering', servingSize: 1, servingUnit: 'SERVING', servingLabel: '1 bowl (≈150 g)', calories: 168, protein: 9, carbs: 24, fat: 4, fiber: 6, categories: ['protein-rich', 'high-fiber', 'carbohydrates'] },
  { key: 'lentils', name: 'Lentils (masoor)', preparation: 'Boiled', servingSize: 100, servingUnit: 'G', servingLabel: '100 g cooked', calories: 116, protein: 9, carbs: 20, fat: 0.4, fiber: 7.9, categories: ['protein-rich', 'high-fiber', 'carbohydrates'] },
  { key: 'rajma', name: 'Rajma (kidney beans)', preparation: 'Boiled', servingSize: 100, servingUnit: 'G', servingLabel: '100 g cooked', calories: 127, protein: 8.7, carbs: 22.8, fat: 0.5, fiber: 6.4, categories: ['protein-rich', 'high-fiber', 'carbohydrates'] },
  { key: 'chickpeas', name: 'Chickpeas (chana)', preparation: 'Boiled', servingSize: 100, servingUnit: 'G', servingLabel: '100 g cooked', calories: 164, protein: 8.9, carbs: 27.4, fat: 2.6, fiber: 7.6, categories: ['protein-rich', 'high-fiber', 'carbohydrates'] },
  { key: 'sprouts', name: 'Moong sprouts', preparation: 'Raw / lightly steamed', servingSize: 100, servingUnit: 'G', servingLabel: '100 g', calories: 30, protein: 3, carbs: 6, fat: 0.2, fiber: 1.8, categories: ['protein-rich', 'high-fiber', 'vegetables'] },

  // Carbohydrates
  { key: 'oats', name: 'Rolled oats', preparation: 'Dry weight', servingSize: 40, servingUnit: 'G', servingLabel: '40 g dry', calories: 152, protein: 5.3, carbs: 26.5, fat: 2.6, fiber: 4, categories: ['high-fiber', 'carbohydrates'] },
  { key: 'rice', name: 'White rice', preparation: 'Cooked', servingSize: 100, servingUnit: 'G', servingLabel: '100 g cooked', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, categories: ['carbohydrates'] },
  { key: 'brownRice', name: 'Brown rice', preparation: 'Cooked', servingSize: 100, servingUnit: 'G', servingLabel: '100 g cooked', calories: 112, protein: 2.3, carbs: 23.5, fat: 0.8, fiber: 1.8, categories: ['carbohydrates', 'high-fiber'] },
  { key: 'roti', name: 'Roti / phulka', preparation: 'No ghee', servingSize: 1, servingUnit: 'PIECE', servingLabel: '1 roti (≈30 g flour)', calories: 85, protein: 3, carbs: 18, fat: 0.4, fiber: 2.7, categories: ['carbohydrates'] },
  { key: 'chapati', name: 'Whole-wheat chapati', preparation: 'With a little oil', servingSize: 1, servingUnit: 'PIECE', servingLabel: '1 chapati (≈40 g)', calories: 120, protein: 3.5, carbs: 18, fat: 3.7, fiber: 3, categories: ['carbohydrates', 'high-fiber'] },
  { key: 'poha', name: 'Poha', preparation: 'Cooked with vegetables', servingSize: 1, servingUnit: 'SERVING', servingLabel: '1 bowl (≈150 g)', calories: 180, protein: 3.5, carbs: 33, fat: 4, fiber: 2, categories: ['carbohydrates'] },
  { key: 'idli', name: 'Idli', servingSize: 1, servingUnit: 'PIECE', servingLabel: '1 idli (≈40 g)', calories: 58, protein: 2, carbs: 12, fat: 0.2, fiber: 0.6, categories: ['carbohydrates'] },
  { key: 'potato', name: 'Potato', preparation: 'Boiled', servingSize: 100, servingUnit: 'G', servingLabel: '100 g', calories: 87, protein: 1.9, carbs: 20, fat: 0.1, fiber: 1.8, categories: ['carbohydrates', 'vegetables'] },
  { key: 'sweetPotato', name: 'Sweet potato', preparation: 'Boiled / baked', servingSize: 100, servingUnit: 'G', servingLabel: '100 g', calories: 90, protein: 2, carbs: 20.7, fat: 0.2, fiber: 3.3, categories: ['carbohydrates', 'vegetables', 'high-fiber'] },

  // Fruits
  { key: 'apple', name: 'Apple', servingSize: 1, servingUnit: 'PIECE', servingLabel: '1 medium (≈180 g)', calories: 95, protein: 0.5, carbs: 25, fat: 0.3, fiber: 4.4, categories: ['fruits', 'high-fiber'] },
  { key: 'banana', name: 'Banana', servingSize: 1, servingUnit: 'PIECE', servingLabel: '1 medium (≈118 g)', calories: 105, protein: 1.3, carbs: 27, fat: 0.4, fiber: 3.1, categories: ['fruits', 'carbohydrates'] },
  { key: 'berries', name: 'Mixed berries', servingSize: 100, servingUnit: 'G', servingLabel: '100 g', calories: 50, protein: 1, carbs: 12, fat: 0.4, fiber: 3.5, categories: ['fruits', 'high-fiber'] },
  { key: 'smallFruit', name: 'Small fruit (orange / guava / pear)', servingSize: 1, servingUnit: 'PIECE', servingLabel: '1 small fruit (≈100 g)', calories: 50, protein: 0.9, carbs: 12, fat: 0.2, fiber: 2.5, categories: ['fruits'] },
  { key: 'papaya', name: 'Papaya', servingSize: 100, servingUnit: 'G', servingLabel: '100 g', calories: 43, protein: 0.5, carbs: 11, fat: 0.3, fiber: 1.7, categories: ['fruits'] },

  // Vegetables
  { key: 'leafy', name: 'Leafy vegetables (spinach / methi)', preparation: 'Cooked', servingSize: 100, servingUnit: 'G', servingLabel: '100 g cooked', calories: 23, protein: 3, carbs: 3.8, fat: 0.3, fiber: 2.4, categories: ['vegetables', 'high-fiber'] },
  { key: 'mixedVeg', name: 'Mixed vegetables', preparation: 'Cooked with ≈1 tsp oil per 200 g', servingSize: 100, servingUnit: 'G', servingLabel: '100 g cooked', calories: 60, protein: 2.6, carbs: 9, fat: 1.5, fiber: 3.5, categories: ['vegetables', 'high-fiber'] },
  { key: 'salad', name: 'Salad vegetables (cucumber / tomato / onion)', preparation: 'Raw', servingSize: 100, servingUnit: 'G', servingLabel: '100 g', calories: 22, protein: 1, carbs: 4.5, fat: 0.2, fiber: 1.5, categories: ['vegetables'] },

  // Fats, nuts & seeds
  { key: 'almond', name: 'Almond', servingSize: 1, servingUnit: 'PIECE', servingLabel: '1 whole almond (≈1.2 g)', calories: 7, protein: 0.25, carbs: 0.26, fat: 0.6, fiber: 0.15, categories: ['fats', 'snacks'] },
  { key: 'walnut', name: 'Walnut', servingSize: 1, servingUnit: 'PIECE', servingLabel: '1 whole walnut kernel = 2 halves (≈4 g)', calories: 26, protein: 0.6, carbs: 0.55, fat: 2.6, fiber: 0.27, categories: ['fats', 'snacks'], notes: 'One piece = one whole kernel (two halves), not one half.' },
  { key: 'chia', name: 'Chia seeds', servingSize: 10, servingUnit: 'G', servingLabel: '1 tbsp (≈10 g)', calories: 49, protein: 1.7, carbs: 4.2, fat: 3.1, fiber: 3.4, categories: ['high-fiber', 'fats'] },
  { key: 'flax', name: 'Flax seeds (ground)', servingSize: 10, servingUnit: 'G', servingLabel: '1 tbsp (≈10 g)', calories: 53, protein: 1.8, carbs: 2.9, fat: 4.2, fiber: 2.7, categories: ['high-fiber', 'fats'] },
  { key: 'peanutButter', name: 'Peanut butter (unsweetened)', servingSize: 16, servingUnit: 'G', servingLabel: '1 tbsp (≈16 g)', calories: 94, protein: 4, carbs: 3.2, fat: 8, fiber: 1, categories: ['fats', 'protein-rich'] },
  { key: 'oliveOil', name: 'Olive oil', servingSize: 5, servingUnit: 'ML', servingLabel: '1 tsp (5 ml ≈ 4.5 g)', calories: 40, protein: 0, carbs: 0, fat: 4.5, fiber: 0, categories: ['fats'] },
  { key: 'ghee', name: 'Ghee', servingSize: 5, servingUnit: 'G', servingLabel: '1 tsp (5 g)', calories: 45, protein: 0, carbs: 0, fat: 5, fiber: 0, categories: ['fats', 'dairy'] },

  // Snacks
  { key: 'roastedChana', name: 'Roasted chana', servingSize: 30, servingUnit: 'G', servingLabel: '30 g', calories: 110, protein: 6.5, carbs: 17, fat: 1.6, fiber: 5, categories: ['snacks', 'protein-rich', 'high-fiber'] },
  { key: 'makhana', name: 'Makhana (fox nuts), roasted', servingSize: 20, servingUnit: 'G', servingLabel: '20 g', calories: 70, protein: 1.9, carbs: 15.4, fat: 0.1, fiber: 2.9, categories: ['snacks', 'carbohydrates'] },
  { key: 'darkChocolate', name: 'Dark chocolate (70%+)', servingSize: 10, servingUnit: 'G', servingLabel: '10 g', calories: 60, protein: 0.8, carbs: 4.6, fat: 4.3, fiber: 1.1, categories: ['snacks'] },

  // Beverages
  { key: 'blackCoffee', name: 'Black coffee', preparation: 'No sugar', servingSize: 240, servingUnit: 'ML', servingLabel: '1 cup (240 ml)', calories: 2, protein: 0.3, carbs: 0, fat: 0, fiber: 0, categories: ['beverages'] },
  { key: 'tea', name: 'Unsweetened tea', preparation: 'Black / green, no milk, no sugar', servingSize: 240, servingUnit: 'ML', servingLabel: '1 cup (240 ml)', calories: 2, protein: 0, carbs: 0.5, fat: 0, fiber: 0, categories: ['beverages'] },
  { key: 'coconutWater', name: 'Coconut water', servingSize: 200, servingUnit: 'ML', servingLabel: '1 glass (200 ml)', calories: 38, protein: 1.4, carbs: 7.4, fat: 0.4, fiber: 2.2, categories: ['beverages'] },

  // Supplements
  { key: 'psyllium', name: 'Psyllium husk (isabgol)', servingSize: 5, servingUnit: 'G', servingLabel: '1 tsp (≈5 g)', calories: 18, protein: 0.1, carbs: 4.3, fat: 0, fiber: 4, categories: ['supplements', 'high-fiber'] },
  { key: 'creatine', name: 'Creatine monohydrate', servingSize: 5, servingUnit: 'G', servingLabel: '1 scoop (5 g)', calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, categories: ['supplements'] },
];

export type FoodKey = (typeof SEED_FOODS)[number]['key'];
