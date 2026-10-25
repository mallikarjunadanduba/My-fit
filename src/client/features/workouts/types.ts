export type ExerciseType = 'STRENGTH' | 'CARDIO' | 'MOBILITY' | 'OTHER';
export type SessionStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED';
export type ItemStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED';

export const EXERCISE_TYPES: { value: ExerciseType; label: string }[] = [
  { value: 'STRENGTH', label: 'Strength' },
  { value: 'CARDIO', label: 'Cardio' },
  { value: 'MOBILITY', label: 'Mobility' },
  { value: 'OTHER', label: 'Other' },
];

export interface Exercise {
  id: string;
  name: string;
  type: ExerciseType;
  muscleGroup: string | null;
  equipment: string | null;
  notes: string | null;
  imageMediaId: string | null;
  archivedAt: string | null;
  historyCount?: number;
  planUses?: number;
}

export interface DayExercise {
  id: string;
  exerciseId: string;
  sortOrder: number;
  targetSets: number | null;
  targetReps: string | null;
  targetWeightKg: number | null;
  targetDurationSec: number | null;
  restSec: number | null;
  notes: string | null;
  exercise: { id: string; name: string; type: ExerciseType; imageMediaId: string | null; archivedAt: string | null; muscleGroup: string | null };
}

export interface WorkoutDay {
  id: string;
  planId: string;
  weekday: number | null;
  name: string;
  isRestDay: boolean;
  sortOrder: number;
  notes: string | null;
  exercises: DayExercise[];
}

export interface PlanSummary {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  dayCount: number;
  trainingDays: number;
  scheduledWeekdays: number[];
  exerciseCount: number;
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  days: WorkoutDay[];
}

export interface SessionStats {
  totalEntries: number;
  completedEntries: number;
  skippedEntries: number;
  totalSets: number;
  completedSets: number;
  volumeKg: number;
  workSec: number;
}

export interface WorkoutSet {
  id: string;
  setNumber: number;
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  completed: boolean;
  completedAt: string | null;
}

export interface SessionEntry {
  id: string;
  exerciseId: string | null;
  exerciseName: string;
  exercise: { id: string; name: string; type: ExerciseType; imageMediaId: string | null } | null;
  sortOrder: number;
  status: ItemStatus;
  restSec: number | null;
  notes: string | null;
  sets: WorkoutSet[];
}

interface SessionBase {
  id: string;
  date: string;
  name: string;
  status: SessionStatus;
  notes: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  workoutDayId: string | null;
  workoutDay: { id: string; name: string; plan: { id: string; name: string } } | null;
  durationSec: number | null;
  stats: SessionStats;
}

export interface Session extends SessionBase {
  entries: SessionEntry[];
}

export interface SessionSummary extends SessionBase {
  exercises: { id: string; exerciseName: string; status: ItemStatus; completedSets: number; totalSets: number }[];
}

export interface Schedule {
  date: string;
  weekday: number;
  dayType: 'GYM' | 'REST';
  plan: { id: string; name: string } | null;
  day: WorkoutDay | null;
  session: SessionSummary | null;
  sessions: SessionSummary[];
}

export type WeekDayStatus = 'COMPLETED' | 'IN_PROGRESS' | 'SKIPPED' | 'MISSED' | 'PLANNED' | 'REST' | 'UPCOMING';

export interface WeekView {
  from: string;
  to: string;
  plan: { id: string; name: string } | null;
  days: {
    date: string;
    weekday: number;
    dayType: 'GYM' | 'REST';
    isToday: boolean;
    plannedDay: { id: string; name: string; isRestDay: boolean; exerciseCount: number; notes: string | null } | null;
    sessions: { id: string; name: string; status: SessionStatus }[];
    status: WeekDayStatus;
  }[];
}

export interface RecordValue {
  value: number;
  date: string;
  sessionId: string;
  weightKg?: number | null;
  reps?: number | null;
}

export interface ExerciseRecords {
  key: string;
  exerciseId: string | null;
  exerciseName: string;
  maxWeight: RecordValue | null;
  bestOneRepMax: RecordValue | null;
  maxReps: RecordValue | null;
  maxSessionVolume: RecordValue | null;
  longestDurationSec: RecordValue | null;
  totalSets: number;
  sessionsCount: number;
  lastPerformed: string;
}

export interface Consistency {
  from: string;
  to: string;
  plannedDays: number;
  completedPlannedDays: number;
  extraSessionDays: number;
  percent: number | null;
  currentStreak: number;
  longestStreak: number;
  weeks: { weekStart: string; weekEnd: string; planned: number; completed: number; extra: number; percent: number | null }[];
}

export const STATUS_LABEL: Record<SessionStatus, string> = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  SKIPPED: 'Skipped',
};

export const STATUS_COLOR: Record<SessionStatus, 'default' | 'info' | 'success' | 'warning'> = {
  PLANNED: 'default',
  IN_PROGRESS: 'info',
  COMPLETED: 'success',
  SKIPPED: 'warning',
};

export const formatKg = (n: number | null | undefined) => (n == null ? '—' : `${Number.isInteger(n) ? n : n.toFixed(1)} kg`);

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m${s && m < 10 ? ` ${s}s` : ''}`;
  return `${s}s`;
}

/** Human summary of a planned exercise's targets, e.g. "3 × 8-10 @ 60 kg · rest 90s". */
export function targetSummary(t: Pick<DayExercise, 'targetSets' | 'targetReps' | 'targetWeightKg' | 'targetDurationSec' | 'restSec'>): string {
  const parts: string[] = [];
  const reps = t.targetReps ? ` × ${t.targetReps}` : '';
  if (t.targetSets) parts.push(`${t.targetSets} set${t.targetSets === 1 ? '' : 's'}${reps}`);
  else if (t.targetReps) parts.push(`${t.targetReps} reps`);
  if (t.targetWeightKg != null) parts.push(`@ ${formatKg(t.targetWeightKg)}`);
  if (t.targetDurationSec) parts.push(formatDuration(t.targetDurationSec));
  const main = parts.join(' ');
  return [main || 'No targets', t.restSec != null ? `rest ${t.restSec}s` : null].filter(Boolean).join(' · ');
}

/** Starts a session for a date (optionally from a plan day) and returns it. Shared with the dashboard contract. */
export const WORKOUT_SESSION_PATH = (id: string) => `/workouts/session/${id}`;
