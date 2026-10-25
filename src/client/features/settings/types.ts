export type ThemeMode = 'LIGHT' | 'DARK' | 'SYSTEM';

export interface UserSettingsView {
  timezone: string;
  theme: ThemeMode;
  gymWeekdays: number[];
  defaultSnoozeMinutes: number;
  notificationsEnabled: boolean;
  profileMediaId: string | null;
  defaultsSeededAt: string | null;
}

export interface NutritionTarget {
  id: string;
  effectiveFrom: string;
  calories: number;
  caloriesMin: number | null;
  caloriesMax: number | null;
  protein: number;
  proteinMin: number | null;
  proteinMax: number | null;
  carbs: number;
  carbsMin: number | null;
  carbsMax: number | null;
  fat: number;
  fatMin: number | null;
  fatMax: number | null;
  fiber: number;
  fiberMin: number | null;
  fiberMax: number | null;
  waterMl: number;
  waterMinMl: number | null;
  waterMaxMl: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TargetsBundle {
  current: NutritionTarget | null;
  history: NutritionTarget[];
}

export interface SettingsBundle {
  settings: UserSettingsView;
  targets: TargetsBundle;
  account: { name: string; email: string; role: 'OWNER' | 'MEMBER' };
}

export interface ActiveSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  userAgent: string | null;
  ip: string | null;
  current: boolean;
}

export interface InvitationView {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  status: 'PENDING' | 'USED' | 'EXPIRED';
  path?: string;
}
