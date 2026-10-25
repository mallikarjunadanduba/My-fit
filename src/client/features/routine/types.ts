import type { ActivityCategory, DayType } from '../alarms/types';

export type RoutineStatus = 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'MISSED' | 'SNOOZED';

export interface RoutineEntry {
  id: string;
  date: string;
  routineItemId: string | null;
  title: string;
  category: ActivityCategory;
  scheduledTime: string;
  scheduledAt: string;
  sortOrder: number;
  status: RoutineStatus;
  completedAt: string | null;
  snoozedUntil: string | null;
  skipReason: string | null;
  notes: string | null;
}

export interface DayProgress {
  total: number;
  completed: number;
  skipped: number;
  missed: number;
  pending: number;
  percent: number | null;
}

export interface RoutineDay {
  date: string;
  dayType: 'GYM' | 'REST';
  entries: RoutineEntry[];
  progress: DayProgress;
}

export interface RoutineItem {
  id: string;
  templateId: string;
  title: string;
  category: ActivityCategory;
  time: string;
  sortOrder: number;
  notes: string | null;
  reminderEnabled: boolean;
  snoozeMinutes: number;
  reminder: { id: string; enabled: boolean; nextTriggerAt: string | null } | null;
}

export interface RoutineTemplate {
  id: string;
  name: string;
  dayType: DayType;
  weekdays: number[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  items: RoutineItem[];
}

export const ROUTINE_STATUS: Record<RoutineStatus, { label: string; color: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  PENDING: { label: 'Pending', color: 'default' },
  COMPLETED: { label: 'Done', color: 'success' },
  SKIPPED: { label: 'Skipped', color: 'info' },
  MISSED: { label: 'Missed', color: 'error' },
  SNOOZED: { label: 'Snoozed', color: 'warning' },
};

/** When a pending/snoozed entry is effectively due. */
export const effectiveDue = (e: Pick<RoutineEntry, 'status' | 'snoozedUntil' | 'scheduledAt'>) =>
  new Date(e.status === 'SNOOZED' && e.snoozedUntil ? e.snoozedUntil : e.scheduledAt).getTime();

/** Classifies an entry relative to `now`: overdue, next (first upcoming open item) or neither. */
export function timelineFlags(entries: RoutineEntry[], now: number, isToday: boolean) {
  const open = (e: RoutineEntry) => e.status === 'PENDING' || e.status === 'SNOOZED';
  const overdue = new Set(isToday ? entries.filter((e) => open(e) && effectiveDue(e) < now).map((e) => e.id) : []);
  const upcoming = isToday ? entries.filter((e) => open(e) && effectiveDue(e) >= now).sort((a, b) => effectiveDue(a) - effectiveDue(b)) : [];
  return { overdue, nextId: upcoming[0]?.id ?? null };
}

/** Client mirror of the server's dayProgress (for optimistic updates). */
export function computeProgress(entries: Pick<RoutineEntry, 'status'>[]): DayProgress {
  const count = (s: RoutineStatus) => entries.filter((e) => e.status === s).length;
  const total = entries.length;
  const completed = count('COMPLETED');
  return {
    total,
    completed,
    skipped: count('SKIPPED'),
    missed: count('MISSED'),
    pending: count('PENDING') + count('SNOOZED'),
    percent: total === 0 ? null : Math.round((completed / total) * 100),
  };
}

/** Same order as the server: scheduledAt, then sortOrder. */
export const sortEntries = (entries: RoutineEntry[]) =>
  [...entries].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime() || a.sortOrder - b.sortOrder);

/** Applies an entry PATCH locally, the way the server will (optimistic UI). */
export function applyEntryChange(
  e: RoutineEntry,
  change: { status?: 'PENDING' | 'COMPLETED' | 'SKIPPED' | 'MISSED'; snoozeMinutes?: number; skipReason?: string | null; notes?: string | null; scheduledTime?: string },
  now = Date.now(),
): RoutineEntry {
  const next: RoutineEntry = { ...e };
  if (change.notes !== undefined) next.notes = change.notes || null;
  if (change.scheduledTime) {
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    next.scheduledAt = new Date(new Date(e.scheduledAt).getTime() + (toMin(change.scheduledTime) - toMin(e.scheduledTime)) * 60_000).toISOString();
    next.scheduledTime = change.scheduledTime;
  }
  if (change.snoozeMinutes) {
    next.status = 'SNOOZED';
    next.snoozedUntil = new Date(now + change.snoozeMinutes * 60_000).toISOString();
  }
  if (change.status) {
    next.status = change.status;
    next.completedAt = change.status === 'COMPLETED' ? new Date(now).toISOString() : null;
    next.snoozedUntil = null;
    next.skipReason = change.status === 'SKIPPED' ? change.skipReason || null : null;
  }
  return next;
}
