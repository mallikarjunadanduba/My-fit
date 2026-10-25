import type { ActivityCategory, ExerciseType, FoodUnit } from '@prisma/client';

/** Coach's nutrition targets used for the very first target version. */
export const DEFAULT_TARGET = {
  calories: 1900,
  caloriesMin: 1850,
  caloriesMax: 1950,
  protein: 160,
  proteinMin: 160,
  proteinMax: 160,
  carbs: 160,
  carbsMin: 150,
  carbsMax: 170,
  fat: 60,
  fatMin: 55,
  fatMax: 65,
  fiber: 32.5,
  fiberMin: 30,
  fiberMax: 35,
  waterMl: 3000,
  waterMinMl: 2500,
  waterMaxMl: 3500,
  notes: 'Targets from coach. Change them manually when the coach updates the plan.',
};

export const SEED_SLOTS: { key: ActivityCategory; name: string; defaultTime: string }[] = [
  { key: 'BREAKFAST', name: 'Breakfast', defaultTime: '08:00' },
  { key: 'MID_MORNING', name: 'Mid-morning', defaultTime: '11:00' },
  { key: 'LUNCH', name: 'Lunch', defaultTime: '13:30' },
  { key: 'PRE_WORKOUT', name: 'Pre-workout', defaultTime: '17:00' },
  { key: 'POST_WORKOUT', name: 'Post-workout', defaultTime: '19:00' },
  { key: 'DINNER', name: 'Dinner', defaultTime: '20:30' },
  { key: 'BEFORE_BED', name: 'Before bed', defaultTime: '22:30' },
];

export interface SeedPlanItem {
  food?: string; // SeedFood key
  customName?: string;
  quantity: number;
  quantityMax?: number;
  unit: FoodUnit;
  isOptional?: boolean;
  notes?: string;
  alternatives?: Omit<SeedPlanItem, 'alternatives'>[];
}

/** The coach's plan, one plan template per slot. */
export const SEED_PLAN: Record<string, { notes?: string; items: SeedPlanItem[] }> = {
  BREAKFAST: {
    items: [
      { food: 'eggWhite', quantity: 3, unit: 'PIECE' },
      { food: 'egg', quantity: 3, unit: 'PIECE' },
      { food: 'oats', quantity: 40, unit: 'G' },
      { food: 'smallFruit', quantity: 1, unit: 'PIECE' },
      { food: 'mixedVeg', quantity: 100, unit: 'G', notes: 'Vegetables' },
    ],
  },
  MID_MORNING: {
    items: [
      { food: 'greekYogurt', quantity: 200, unit: 'G', alternatives: [{ food: 'curd', quantity: 200, unit: 'G' }] },
      { food: 'almond', quantity: 10, unit: 'PIECE' },
      { food: 'walnut', quantity: 3, unit: 'PIECE', notes: '3 whole kernels' },
      { food: 'smallFruit', quantity: 1, unit: 'PIECE', notes: '1 fruit' },
    ],
  },
  LUNCH: {
    items: [
      { food: 'chicken', quantity: 150, quantityMax: 180, unit: 'G', alternatives: [{ food: 'fish', quantity: 150, quantityMax: 180, unit: 'G' }] },
      { food: 'rice', quantity: 100, quantityMax: 120, unit: 'G' },
      { food: 'mixedVeg', quantity: 200, unit: 'G', notes: 'Large serving of vegetables' },
      { food: 'salad', quantity: 100, unit: 'G', notes: 'Salad' },
      { food: 'dal', quantity: 1, unit: 'SERVING', notes: '1 bowl' },
    ],
  },
  PRE_WORKOUT: {
    items: [
      { food: 'banana', quantity: 1, unit: 'PIECE' },
      {
        food: 'blackCoffee',
        quantity: 240,
        unit: 'ML',
        isOptional: true,
        alternatives: [{ food: 'tea', quantity: 240, unit: 'ML', isOptional: true }],
      },
    ],
  },
  POST_WORKOUT: {
    items: [
      { food: 'whey', quantity: 1, unit: 'SCOOP' },
      { customName: 'Water', quantity: 300, unit: 'ML', notes: 'Mix the whey with water' },
    ],
  },
  DINNER: {
    items: [
      {
        food: 'chicken',
        quantity: 150,
        quantityMax: 180,
        unit: 'G',
        alternatives: [
          { food: 'fish', quantity: 150, quantityMax: 180, unit: 'G' },
          { food: 'paneer', quantity: 150, quantityMax: 180, unit: 'G' },
        ],
      },
      { food: 'mixedVeg', quantity: 200, unit: 'G', notes: 'Large portion of vegetables' },
      {
        food: 'rice',
        quantity: 75,
        unit: 'G',
        isOptional: true,
        notes: 'Small serving, if needed',
        alternatives: [{ food: 'roti', quantity: 1, unit: 'PIECE', isOptional: true, notes: 'Small serving, if needed' }],
      },
    ],
  },
  BEFORE_BED: {
    items: [{ food: 'curd', quantity: 150, quantityMax: 200, unit: 'G', alternatives: [{ food: 'greekYogurt', quantity: 150, quantityMax: 200, unit: 'G' }] }],
  },
};

export const EXAMPLE_NOTE = 'Example only — edit or replace. This is not a training prescription.';

export const SEED_EXERCISES: { name: string; type: ExerciseType; muscleGroup: string; equipment: string }[] = [
  { name: 'Barbell bench press', type: 'STRENGTH', muscleGroup: 'Chest', equipment: 'Barbell' },
  { name: 'Incline dumbbell press', type: 'STRENGTH', muscleGroup: 'Chest', equipment: 'Dumbbells' },
  { name: 'Seated dumbbell shoulder press', type: 'STRENGTH', muscleGroup: 'Shoulders', equipment: 'Dumbbells' },
  { name: 'Lateral raise', type: 'STRENGTH', muscleGroup: 'Shoulders', equipment: 'Dumbbells' },
  { name: 'Triceps rope pushdown', type: 'STRENGTH', muscleGroup: 'Triceps', equipment: 'Cable' },
  { name: 'Lat pulldown', type: 'STRENGTH', muscleGroup: 'Back', equipment: 'Cable' },
  { name: 'Seated cable row', type: 'STRENGTH', muscleGroup: 'Back', equipment: 'Cable' },
  { name: 'Assisted pull-up', type: 'STRENGTH', muscleGroup: 'Back', equipment: 'Machine' },
  { name: 'Dumbbell biceps curl', type: 'STRENGTH', muscleGroup: 'Biceps', equipment: 'Dumbbells' },
  { name: 'Barbell back squat', type: 'STRENGTH', muscleGroup: 'Legs', equipment: 'Barbell' },
  { name: 'Romanian deadlift', type: 'STRENGTH', muscleGroup: 'Hamstrings', equipment: 'Barbell' },
  { name: 'Leg press', type: 'STRENGTH', muscleGroup: 'Legs', equipment: 'Machine' },
  { name: 'Lying leg curl', type: 'STRENGTH', muscleGroup: 'Hamstrings', equipment: 'Machine' },
  { name: 'Plank', type: 'OTHER', muscleGroup: 'Core', equipment: 'Bodyweight' },
  { name: 'Treadmill brisk walk', type: 'CARDIO', muscleGroup: 'Cardio', equipment: 'Treadmill' },
  { name: 'Hip and thoracic mobility flow', type: 'MOBILITY', muscleGroup: 'Full body', equipment: 'Bodyweight' },
];

type DayEx = { exercise: string; sets?: number; reps?: string; durationSec?: number; restSec?: number };

const push: DayEx[] = [
  { exercise: 'Barbell bench press', sets: 3, reps: '8-10' },
  { exercise: 'Incline dumbbell press', sets: 3, reps: '10-12' },
  { exercise: 'Seated dumbbell shoulder press', sets: 3, reps: '10-12' },
  { exercise: 'Lateral raise', sets: 3, reps: '12-15', restSec: 60 },
  { exercise: 'Triceps rope pushdown', sets: 3, reps: '12-15', restSec: 60 },
];
const pull: DayEx[] = [
  { exercise: 'Lat pulldown', sets: 3, reps: '8-12' },
  { exercise: 'Seated cable row', sets: 3, reps: '10-12' },
  { exercise: 'Assisted pull-up', sets: 3, reps: '6-10' },
  { exercise: 'Dumbbell biceps curl', sets: 3, reps: '10-12', restSec: 60 },
  { exercise: 'Plank', sets: 3, durationSec: 45, restSec: 45 },
];
const legs: DayEx[] = [
  { exercise: 'Barbell back squat', sets: 3, reps: '6-10', restSec: 120 },
  { exercise: 'Romanian deadlift', sets: 3, reps: '8-10', restSec: 120 },
  { exercise: 'Leg press', sets: 3, reps: '10-12' },
  { exercise: 'Lying leg curl', sets: 3, reps: '10-12', restSec: 60 },
  { exercise: 'Treadmill brisk walk', sets: 1, durationSec: 15 * 60, restSec: 0 },
];

export const SEED_WORKOUT_PLAN = {
  name: 'Sample split (edit me)',
  description: 'Example push / pull / legs split to show how plans work. These are examples, not a prescription — replace with your coach’s programme.',
  days: [
    { weekday: 1, name: 'Push (example)', exercises: push },
    { weekday: 2, name: 'Pull (example)', exercises: pull },
    { weekday: 3, name: 'Legs (example)', exercises: legs },
    { weekday: 4, name: 'Push (example)', exercises: push },
    { weekday: 5, name: 'Pull (example)', exercises: pull },
    { weekday: 6, name: 'Legs + cardio (example)', exercises: legs },
    { weekday: 0, name: 'Rest day', isRestDay: true, exercises: [{ exercise: 'Hip and thoracic mobility flow', sets: 1, durationSec: 10 * 60, restSec: 0 }] },
  ] as { weekday: number; name: string; isRestDay?: boolean; exercises: DayEx[] }[],
};

export interface SeedRoutineItem {
  title: string;
  category: ActivityCategory;
  time: string;
  notes?: string;
  reminderEnabled?: boolean;
}

const morning: SeedRoutineItem[] = [
  { title: 'Wake up', category: 'WAKE_UP', time: '06:30' },
  { title: 'Morning water', category: 'MORNING_WATER', time: '06:35', notes: 'A glass or two of water after waking.' },
  { title: 'Breakfast', category: 'BREAKFAST', time: '08:00' },
  { title: 'Mid-morning meal', category: 'MID_MORNING', time: '11:00' },
  { title: 'Lunch', category: 'LUNCH', time: '13:30' },
];
const evening: SeedRoutineItem[] = [
  { title: 'Dinner', category: 'DINNER', time: '20:30' },
  { title: 'Before-bed snack', category: 'BEFORE_BED', time: '22:30' },
  { title: 'Bedtime', category: 'BEDTIME', time: '23:00', notes: 'Screens off, lights out.' },
];

export const SEED_ROUTINES: { name: string; dayType: 'GYM' | 'REST'; items: SeedRoutineItem[] }[] = [
  {
    name: 'Gym day',
    dayType: 'GYM',
    items: [
      ...morning,
      { title: 'Pre-workout snack', category: 'PRE_WORKOUT', time: '17:00' },
      { title: 'Gym', category: 'GYM', time: '18:00' },
      { title: 'Post-workout shake', category: 'POST_WORKOUT', time: '19:00' },
      ...evening,
    ],
  },
  { name: 'Rest day', dayType: 'REST', items: [...morning, ...evening] },
];

export const SEED_HYDRATION = ['10:00', '15:00', '17:30'];
