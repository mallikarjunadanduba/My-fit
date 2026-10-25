/**
 * Pure workout math (no I/O): rep parsing, 1RM, volume, personal records and consistency.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "8-10" → 8, "12" → 12, "8–12 reps" → 8, "AMRAP" → null. */
export function parseRepsLowerBound(targetReps: string | null | undefined): number | null {
  if (!targetReps) return null;
  const m = targetReps.match(/\d+/);
  if (!m) return null;
  const n = Number.parseInt(m[0], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Epley estimated one-rep max: weight × (1 + reps / 30). 1 rep → the weight itself. */
export function estimateOneRepMax(weightKg: number | null | undefined, reps: number | null | undefined): number | null {
  if (weightKg == null || reps == null || weightKg <= 0 || reps <= 0) return null;
  if (reps === 1) return round1(weightKg);
  return round1(weightKg * (1 + reps / 30));
}

/** Volume of one set (weight × reps); 0 when either is missing. */
export function setVolume(s: { weightKg?: number | null; reps?: number | null }): number {
  if (s.weightKg == null || s.reps == null || s.weightKg <= 0 || s.reps <= 0) return 0;
  return s.weightKg * s.reps;
}

export interface StatSet {
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
  completed: boolean;
}
export interface StatEntry {
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  sets: StatSet[];
}

export interface SessionStats {
  totalEntries: number;
  completedEntries: number;
  skippedEntries: number;
  totalSets: number;
  completedSets: number;
  /** Sum of weight × reps over completed sets (kg). */
  volumeKg: number;
  /** Sum of durationSec over completed sets. */
  workSec: number;
}

export function sessionStats(entries: StatEntry[]): SessionStats {
  let totalSets = 0;
  let completedSets = 0;
  let volume = 0;
  let workSec = 0;
  for (const e of entries) {
    for (const s of e.sets) {
      totalSets++;
      if (!s.completed) continue;
      completedSets++;
      volume += setVolume(s);
      workSec += s.durationSec ?? 0;
    }
  }
  return {
    totalEntries: entries.length,
    completedEntries: entries.filter((e) => e.status === 'COMPLETED').length,
    skippedEntries: entries.filter((e) => e.status === 'SKIPPED').length,
    totalSets,
    completedSets,
    volumeKg: round1(volume),
    workSec,
  };
}

/** Elapsed seconds between start and finish (or `now` while in progress); null if never started. */
export function sessionDurationSec(startedAt: Date | null, finishedAt: Date | null, now = new Date()): number | null {
  if (!startedAt) return null;
  const end = finishedAt ?? now;
  return Math.max(0, Math.round((end.getTime() - startedAt.getTime()) / 1000));
}

// ───────────────────────────── Personal records ─────────────────────────────

export interface RecordSetRow {
  exerciseId: string | null;
  exerciseName: string;
  sessionId: string;
  date: string; // YYYY-MM-DD
  reps: number | null;
  weightKg: number | null;
  durationSec: number | null;
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

/** Strictly better value wins; ties keep the earliest date (the day the record was first achieved). */
function better(current: RecordValue | null, candidate: RecordValue): RecordValue {
  if (!current) return candidate;
  if (candidate.value > current.value) return candidate;
  if (candidate.value === current.value && candidate.date < current.date) return candidate;
  return current;
}

/**
 * Personal records per exercise from completed sets.
 * Exercises are grouped by id; sets whose exercise was deleted fall back to their name snapshot.
 */
export function computePersonalRecords(rows: RecordSetRow[]): ExerciseRecords[] {
  const byKey = new Map<string, ExerciseRecords & { volumes: Map<string, { v: number; date: string }>; sessions: Set<string> }>();
  for (const r of rows) {
    const key = r.exerciseId ?? `name:${r.exerciseName.trim().toLowerCase()}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = {
        key,
        exerciseId: r.exerciseId,
        exerciseName: r.exerciseName,
        maxWeight: null,
        bestOneRepMax: null,
        maxReps: null,
        maxSessionVolume: null,
        longestDurationSec: null,
        totalSets: 0,
        sessionsCount: 0,
        lastPerformed: r.date,
        volumes: new Map(),
        sessions: new Set(),
      };
      byKey.set(key, rec);
    }
    rec.totalSets++;
    rec.sessions.add(r.sessionId);
    if (r.date > rec.lastPerformed) rec.lastPerformed = r.date;
    const base = { date: r.date, sessionId: r.sessionId, weightKg: r.weightKg, reps: r.reps };
    if (r.weightKg != null && r.weightKg > 0) rec.maxWeight = better(rec.maxWeight, { ...base, value: r.weightKg });
    const orm = estimateOneRepMax(r.weightKg, r.reps);
    if (orm != null) rec.bestOneRepMax = better(rec.bestOneRepMax, { ...base, value: orm });
    if (r.reps != null && r.reps > 0) rec.maxReps = better(rec.maxReps, { ...base, value: r.reps });
    if (r.durationSec != null && r.durationSec > 0) rec.longestDurationSec = better(rec.longestDurationSec, { ...base, value: r.durationSec });
    const v = setVolume(r);
    if (v > 0) {
      const cur = rec.volumes.get(r.sessionId);
      rec.volumes.set(r.sessionId, { v: (cur?.v ?? 0) + v, date: r.date });
    }
  }
  const out: ExerciseRecords[] = [];
  for (const rec of byKey.values()) {
    for (const [sessionId, { v, date }] of rec.volumes) {
      rec.maxSessionVolume = better(rec.maxSessionVolume, { value: round1(v), date, sessionId });
    }
    const { volumes: _v, sessions, ...rest } = rec;
    out.push({ ...rest, sessionsCount: sessions.size });
  }
  return out.sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

// ───────────────────────────── Consistency ─────────────────────────────

export interface ConsistencyDay {
  date: string;
  /** Planned gym day (GYM day type and not a plan rest day). */
  planned: boolean;
  /** At least one COMPLETED session that day. */
  completed: boolean;
}

export interface ConsistencyWeek {
  weekStart: string;
  planned: number;
  completed: number;
  extra: number;
  percent: number | null;
}

export interface ConsistencySummary {
  plannedDays: number;
  completedPlannedDays: number;
  extraSessionDays: number;
  percent: number | null;
  currentStreak: number;
  longestStreak: number;
  weeks: ConsistencyWeek[];
}

/**
 * Consistency over consecutive days (sorted ascending).
 * - percent = completed planned days / planned days (null when nothing was planned).
 * - Streak counts completed workout days; rest days neither add nor break it; a planned day
 *   without a workout breaks it — except `today` (still time to train).
 */
export function computeConsistency(days: ConsistencyDay[], weekStartOf: (date: string) => string, today: string): ConsistencySummary {
  const pct = (c: number, p: number) => (p > 0 ? Math.round((c / p) * 100) : null);
  const weeks = new Map<string, ConsistencyWeek>();
  let planned = 0;
  let completedPlanned = 0;
  let extra = 0;
  let streak = 0;
  let longest = 0;
  for (const d of days) {
    const ws = weekStartOf(d.date);
    const w = weeks.get(ws) ?? { weekStart: ws, planned: 0, completed: 0, extra: 0, percent: null };
    weeks.set(ws, w);
    if (d.date > today) continue; // future days don't count yet
    if (d.planned) {
      planned++;
      w.planned++;
      if (d.completed) {
        completedPlanned++;
        w.completed++;
      }
    } else if (d.completed) {
      extra++;
      w.extra++;
    }
    if (d.completed) {
      streak++;
      longest = Math.max(longest, streak);
    } else if (d.planned && d.date !== today) {
      streak = 0;
    }
  }
  for (const w of weeks.values()) w.percent = pct(w.completed, w.planned);
  return {
    plannedDays: planned,
    completedPlannedDays: completedPlanned,
    extraSessionDays: extra,
    percent: pct(completedPlanned, planned),
    currentStreak: streak,
    longestStreak: longest,
    weeks: [...weeks.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart)),
  };
}
