import type { ItemStatus, Session, SessionEntry, SessionStats, SessionStatus, WorkoutSet } from './types';

/**
 * Pure helpers for the workout session screen's optimistic updates. Set/entry writes return only what
 * changed (see workouts.routes.ts); these functions apply local edits immediately and merge the server's
 * answer when it arrives. Stats mirror `sessionStats` on the server.
 */

export interface SetPatchResponse {
  set: WorkoutSet;
  entry: { id: string; status: ItemStatus };
  session: { id: string; status: SessionStatus; startedAt: string | null };
}

export interface EntryPatchResponse {
  id: string;
  sessionId: string;
  status: ItemStatus;
  notes: string | null;
  restSec: number | null;
}

export interface SetValuesPatch {
  reps?: number | null;
  weightKg?: number | null;
  durationSec?: number | null;
  completed?: boolean;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeStats(entries: SessionEntry[]): SessionStats {
  let totalSets = 0;
  let completedSets = 0;
  let volume = 0;
  let workSec = 0;
  for (const e of entries) {
    for (const s of e.sets) {
      totalSets++;
      if (!s.completed) continue;
      completedSets++;
      if (s.weightKg != null && s.reps != null && s.weightKg > 0 && s.reps > 0) volume += s.weightKg * s.reps;
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

function withEntries(s: Session, entries: SessionEntry[]): Session {
  return { ...s, entries, stats: computeStats(entries) };
}

function mapEntry(s: Session, entryId: string, fn: (e: SessionEntry) => SessionEntry): Session {
  return withEntries(
    s,
    s.entries.map((e) => (e.id === entryId ? fn(e) : e)),
  );
}

/** Local (optimistic) set edit, including the server's side effects of completing a set. */
export function applySetPatch(s: Session, setId: string, patch: SetValuesPatch, now = new Date()): Session {
  let session = s;
  const entries = s.entries.map((e) => {
    if (!e.sets.some((x) => x.id === setId)) return e;
    const sets = e.sets.map((x) => {
      if (x.id !== setId) return x;
      const next: WorkoutSet = { ...x, ...patch, completed: patch.completed ?? x.completed };
      if (patch.completed !== undefined) next.completedAt = patch.completed ? (x.completedAt ?? now.toISOString()) : null;
      return next;
    });
    const allDone = sets.every((x) => x.completed);
    return { ...e, sets, status: patch.completed && allDone && e.status === 'PENDING' ? ('COMPLETED' as const) : e.status };
  });
  if (patch.completed && s.status === 'PLANNED') session = { ...s, status: 'IN_PROGRESS', startedAt: s.startedAt ?? now.toISOString() };
  return withEntries(session, entries);
}

/** Merges the PATCH /sets/:id response (authoritative for that set, its entry status and the session status). */
export function mergeSetResponse(s: Session, r: SetPatchResponse, { includeSet = true } = {}): Session {
  const base = r.session.id === s.id ? { ...s, status: r.session.status, startedAt: r.session.startedAt } : s;
  return mapEntry(base, r.entry.id, (e) => ({
    ...e,
    status: r.entry.status,
    sets: includeSet ? e.sets.map((x) => (x.id === r.set.id ? r.set : x)) : e.sets,
  }));
}

export const TEMP_PREFIX = 'tmp-';
export const isTempId = (id: string) => id.startsWith(TEMP_PREFIX);

/** Appends a placeholder set copying the previous one (same rule as the server). */
export function addTempSet(s: Session, entryId: string, tempId: string): Session {
  return mapEntry(s, entryId, (e) => {
    const last = e.sets[e.sets.length - 1];
    const set: WorkoutSet = {
      id: tempId,
      setNumber: (last?.setNumber ?? 0) + 1,
      reps: last?.reps ?? null,
      weightKg: last?.weightKg ?? null,
      durationSec: last?.durationSec ?? null,
      completed: false,
      completedAt: null,
    };
    return { ...e, sets: [...e.sets, set] };
  });
}

export function replaceSet(s: Session, entryId: string, oldId: string, set: WorkoutSet): Session {
  return mapEntry(s, entryId, (e) => ({ ...e, sets: e.sets.map((x) => (x.id === oldId ? set : x)) }));
}

/** Removes a set and renumbers the rest 1..n (mirrors the server). */
export function removeSet(s: Session, setId: string): Session {
  return withEntries(
    s,
    s.entries.map((e) =>
      e.sets.some((x) => x.id === setId) ? { ...e, sets: e.sets.filter((x) => x.id !== setId).map((x, i) => ({ ...x, setNumber: i + 1 })) } : e,
    ),
  );
}

export function patchEntryLocal(s: Session, entryId: string, patch: Partial<Pick<SessionEntry, 'status' | 'notes' | 'restSec'>>): Session {
  return mapEntry(s, entryId, (e) => ({ ...e, ...patch }));
}

export function mergeEntryResponse(s: Session, r: EntryPatchResponse): Session {
  return patchEntryLocal(s, r.id, { status: r.status, notes: r.notes, restSec: r.restSec });
}

export function appendEntry(s: Session, entry: SessionEntry): Session {
  return withEntries(s, [...s.entries, entry]);
}

export function removeEntry(s: Session, entryId: string): Session {
  return withEntries(
    s,
    s.entries.filter((e) => e.id !== entryId),
  );
}
