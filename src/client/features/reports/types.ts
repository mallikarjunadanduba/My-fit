import type { Nutrients, TargetProgress } from '../../../shared/nutrition';

export type DayKind = 'GYM' | 'REST';
export type MealDayStatus = 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'SKIPPED' | 'LOGGED' | 'NOT_LOGGED';
export type SessionStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
export type RoutineStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'MISSED' | 'SNOOZED';
export type WorkoutDayStatus = 'COMPLETED' | 'IN_PROGRESS' | 'PLANNED' | 'NONE';

export interface Target {
  id: string;
  effectiveFrom: string;
  calories: number;
  caloriesMin: number | null;
  caloriesMax: number | null;
  protein: number;
  proteinMin: number | null;
  proteinMax: number | null;
  carbs: number;
  fat: number;
  fiber: number;
  waterMl: number;
  waterMinMl: number | null;
  waterMaxMl: number | null;
}

export interface ScoreComponent {
  key: 'meals' | 'calories' | 'protein' | 'water' | 'workout' | 'routine';
  label: string;
  weight: number;
  value: number;
  points: number;
  maxPoints: number;
  detail: string;
}

export interface CompletionScore {
  score: number;
  components: ScoreComponent[];
}

export interface RoutineEntryLite {
  id: string;
  title: string;
  category: string;
  scheduledTime: string;
  scheduledAt: string;
  status: RoutineStatus;
  snoozedUntil: string | null;
}

export interface WeeklyPoint {
  date: string;
  future: boolean;
  dayType: DayKind;
  foodLogged: boolean;
  waterLogged: boolean;
  calories: number | null;
  protein: number | null;
  waterMl: number | null;
  calorieTarget: number | null;
  calorieMin: number | null;
  calorieMax: number | null;
  proteinTarget: number | null;
  waterTarget: number | null;
  workoutDone: boolean | null;
  workoutStatus: WorkoutDayStatus;
  score: number | null;
}

export interface ActivityItem {
  id: string;
  type: 'food' | 'water' | 'workout' | 'routine' | 'measurement';
  title: string;
  detail: string | null;
  date: string;
  at: string;
}

export interface Dashboard {
  greeting: {
    name: string;
    date: string;
    today: string;
    timezone: string;
    isToday: boolean;
    isFuture: boolean;
    isPast: boolean;
    dayType: DayKind;
    dayTypeOverride: DayKind | null;
    notes: string | null;
  };
  nutrition: {
    logged: boolean;
    totals: Nutrients | null;
    target: Target | null;
    progress: Record<keyof Nutrients, TargetProgress> | null;
    remainingCalories: number | null;
    entryCount: number;
  };
  water: {
    logged: boolean;
    totalMl: number | null;
    targetMl: number | null;
    progress: TargetProgress | null;
    entryCount: number;
  };
  meals: {
    slotId: string;
    name: string;
    defaultTime: string | null;
    status: MealDayStatus;
    plannedMeal: { id: string; name: string } | null;
    entryCount: number;
    calories: number | null;
  }[];
  workout: {
    dayType: DayKind;
    plan: { id: string; name: string } | null;
    plannedDay: {
      id: string;
      name: string;
      isRestDay: boolean;
      notes: string | null;
      exerciseCount: number;
    } | null;
    session: {
      id: string;
      name: string;
      status: SessionStatus;
      startedAt: string | null;
      finishedAt: string | null;
      totalExercises: number;
      completedExercises: number;
      totalSets: number;
      completedSets: number;
      volumeKg: number;
    } | null;
    sessionCount: number;
  };
  routine: {
    total: number;
    completed: number;
    skipped: number;
    pending: number;
    missed: number;
    completionPct: number | null;
    upcoming: RoutineEntryLite[];
    overdue: RoutineEntryLite[];
  };
  reminders: {
    next: {
      id: string;
      title: string;
      description: string | null;
      category: string;
      time: string;
      nextTriggerAt: string;
    } | null;
    overdue: {
      id: string;
      reminderId: string;
      title: string;
      category: string;
      status: string;
      scheduledFor: string;
      snoozedUntil: string | null;
    }[];
  };
  completionScore: (CompletionScore & { weights: Record<string, number> }) | null;
  weekly: { from: string; to: string; days: WeeklyPoint[] };
  recentActivity: ActivityItem[];
}

export interface DiaryEntryLite {
  id: string;
  slotId: string | null;
  foodName: string;
  brand: string | null;
  quantity: number;
  unit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  isEstimate: boolean;
  consumedAt: string | null;
  notes: string | null;
}

export interface DailyReport {
  date: string;
  today: string;
  isToday: boolean;
  isFuture: boolean;
  isPast: boolean;
  timezone: string;
  dayType: DayKind;
  dayTypeOverride: DayKind | null;
  notes: string | null;
  log: { id: string; createdAt: string; updatedAt: string } | null;
  nutrition: {
    logged: boolean;
    totals: Nutrients | null;
    target: Target | null;
    progress: Record<keyof Nutrients, TargetProgress> | null;
    remainingCalories: number | null;
    entryCount: number;
    entries: DiaryEntryLite[];
    unslotted: { entryCount: number; totals: Nutrients } | null;
  };
  water: {
    logged: boolean;
    totalMl: number | null;
    targetMl: number | null;
    progress: TargetProgress | null;
    entries: {
      id: string;
      amountMl: number;
      loggedAt: string;
      note: string | null;
    }[];
  };
  meals: {
    slotId: string;
    name: string;
    defaultTime: string | null;
    status: MealDayStatus;
    plannedMeal: { id: string; name: string } | null;
    entryCount: number;
    totals: Nutrients | null;
  }[];
  workouts: {
    id: string;
    name: string;
    status: SessionStatus;
    startedAt: string | null;
    finishedAt: string | null;
    notes: string | null;
    totalExercises: number;
    completedExercises: number;
    totalSets: number;
    completedSets: number;
    volumeKg: number;
    exercises: {
      id: string;
      name: string;
      status: string;
      notes: string | null;
      sets: {
        setNumber: number;
        reps: number | null;
        weightKg: number | null;
        durationSec: number | null;
        completed: boolean;
      }[];
    }[];
  }[];
  routine: {
    total: number;
    completed: number;
    skipped: number;
    pending: number;
    missed: number;
    completionPct: number | null;
  };
  routineEntries: RoutineEntryLite[];
  measurement: {
    id: string;
    weightKg: number | null;
    bodyFatPct: number | null;
    waistCm: number | null;
    chestCm: number | null;
    hipsCm: number | null;
    armCm: number | null;
    thighCm: number | null;
    notes: string | null;
    measuredAt: string;
  } | null;
  score: CompletionScore | null;
}

export interface CalendarDay {
  date: string;
  weekday: number;
  future: boolean;
  dayType: DayKind;
  logged: { food: boolean; water: boolean; workout: boolean; routine: boolean };
  calories: number | null;
  protein: number | null;
  waterMl: number | null;
  calorieTarget: number | null;
  workoutStatus: WorkoutDayStatus;
  routinePct: number | null;
  mealAdherence: number | null;
  score: number | null;
  hasNotes: boolean;
}

export interface CalendarMonth {
  month: string;
  from: string;
  to: string;
  today: string;
  days: CalendarDay[];
}

export interface SeriesPoint {
  date: string;
  weekday: number;
  future: boolean;
  dayType: DayKind;
  foodLogged: boolean;
  waterLogged: boolean;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  waterMl: number | null;
  calorieTarget: number | null;
  calorieMin: number | null;
  calorieMax: number | null;
  proteinTarget: number | null;
  waterTarget: number | null;
  workoutCompleted: boolean;
  workoutStatus: WorkoutDayStatus;
  mealAdherence: number | null;
  routinePct: number | null;
  weightKg: number | null;
  score: number | null;
}

export interface Averages {
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fiber: number | null;
  waterMl: number | null;
}

export interface PeriodReport {
  kind: 'weekly' | 'monthly';
  today: string;
  from: string;
  to: string;
  daysInPeriod: number;
  daysElapsed: number;
  daysWithFoodLogs: number;
  daysWithWaterLogs: number;
  missingLogDates: string[];
  loggedDays: { food: number; water: number };
  averages: Averages;
  averageTargets: Averages;
  vsTargetPct: Averages;
  daysWithinCalorieRange: number;
  workoutsCompleted: number;
  plannedGymDays: number;
  gymDaysWithWorkout: number;
  workoutConsistencyPct: number | null;
  mealAdherencePct: number | null;
  routineCompletionPct: number | null;
  averageScore: number | null;
  weight: {
    first: { date: string; weightKg: number } | null;
    last: { date: string; weightKg: number } | null;
    change: number | null;
    series: { date: string; weightKg: number }[];
  };
  mostConsistentWeekdays: {
    weekday: number;
    label: string;
    averageScore: number;
    days: number;
    rank: number;
  }[];
  series: SeriesPoint[];
}

export type HistoryKind = 'nutrition' | 'diary' | 'workouts' | 'water' | 'routine' | 'reminders' | 'measurements';

export const EXPORT_DATASETS = ['all', 'diary', 'water', 'workouts', 'measurements', 'routine', 'reminders', 'targets', 'foods'] as const;
export type ExportDataset = (typeof EXPORT_DATASETS)[number];
