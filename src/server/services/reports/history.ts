import { prisma } from '../../db';
import { addDays, dateRange, fromDbDate, todayIn, toDbDate, zonedToUtc } from '../../lib/dates';
import { round1, sumNutrients } from '../../../shared/nutrition';
import { loadTargetResolver } from './targets';
import { isWithinCalorieRange } from './aggregate';
import type { UserCtx } from './daySnapshot';

export const HISTORY_KINDS = ['nutrition', 'diary', 'workouts', 'water', 'routine', 'reminders', 'measurements'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export interface HistoryQuery {
  from: string;
  to: string;
  page: number;
  pageSize: number;
}

export interface HistoryPage<T = unknown> {
  rows: T[];
  total: number;
}

const paginate = <T>(all: T[], q: HistoryQuery): HistoryPage<T> => ({
  rows: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
  total: all.length,
});

/** Day-level rows include every elapsed date in range (newest first); missing days are `logged: false`. */
function elapsedDatesDesc(ctx: UserCtx, q: HistoryQuery, now: Date) {
  const today = todayIn(ctx.timezone, now);
  const to = q.to < today ? q.to : today;
  return q.from > to ? [] : dateRange(q.from, to).reverse();
}

export async function getHistory(ctx: UserCtx, kind: HistoryKind, q: HistoryQuery, now: Date = new Date()): Promise<HistoryPage> {
  const { userId } = ctx;
  const range = { gte: toDbDate(q.from), lte: toDbDate(q.to) };
  const skip = (q.page - 1) * q.pageSize;
  const take = q.pageSize;

  switch (kind) {
    case 'nutrition': {
      const [entries, targetFor] = await Promise.all([
        prisma.foodDiaryEntry.findMany({
          where: { userId, date: range },
          select: {
            date: true,
            calories: true,
            protein: true,
            carbs: true,
            fat: true,
            fiber: true,
          },
        }),
        loadTargetResolver(userId),
      ]);
      const byDate = new Map<string, typeof entries>();
      for (const e of entries) {
        const k = fromDbDate(e.date);
        byDate.set(k, [...(byDate.get(k) ?? []), e]);
      }
      const dates = elapsedDatesDesc(ctx, q, now);
      const page = paginate(dates, q);
      return {
        total: page.total,
        rows: page.rows.map((date) => {
          const list = byDate.get(date);
          const t = targetFor(date);
          const totals = list?.length ? sumNutrients(list) : null;
          return {
            date,
            logged: !!totals,
            entryCount: list?.length ?? 0,
            ...(totals ?? {
              calories: null,
              protein: null,
              carbs: null,
              fat: null,
              fiber: null,
            }),
            calorieTarget: t?.calories ?? null,
            proteinTarget: t?.protein ?? null,
            withinCalorieRange: totals && t ? isWithinCalorieRange(totals.calories, t) : null,
          };
        }),
      };
    }

    case 'diary': {
      const where = { userId, date: range };
      const [total, rows] = await Promise.all([
        prisma.foodDiaryEntry.count({ where }),
        prisma.foodDiaryEntry.findMany({
          where,
          orderBy: [{ date: 'desc' }, { consumedAt: 'desc' }, { createdAt: 'desc' }],
          skip,
          take,
          select: {
            id: true,
            date: true,
            foodName: true,
            brand: true,
            quantity: true,
            unit: true,
            calories: true,
            protein: true,
            carbs: true,
            fat: true,
            fiber: true,
            isEstimate: true,
            consumedAt: true,
            notes: true,
            slot: { select: { name: true } },
          },
        }),
      ]);
      return {
        total,
        rows: rows.map(({ slot, date, ...r }) => ({
          ...r,
          date: fromDbDate(date),
          slotName: slot?.name ?? null,
        })),
      };
    }

    case 'workouts': {
      const where = { userId, date: range };
      // Flat queries in one wave (nested includes would cost a round trip per level).
      const [total, rows, entries, allSets] = await Promise.all([
        prisma.workoutSession.count({ where }),
        prisma.workoutSession.findMany({
          where,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip,
          take,
        }),
        prisma.workoutExerciseEntry.findMany({
          where: { session: where },
          select: { id: true, sessionId: true, status: true },
        }),
        prisma.workoutSet.findMany({
          where: { entry: { session: where } },
          select: {
            entryId: true,
            completed: true,
            reps: true,
            weightKg: true,
          },
        }),
      ]);
      const setsByEntry = new Map<string, typeof allSets>();
      for (const x of allSets) setsByEntry.set(x.entryId, [...(setsByEntry.get(x.entryId) ?? []), x]);
      return {
        total,
        rows: rows.map((session) => {
          const s = {
            ...session,
            entries: entries.filter((e) => e.sessionId === session.id).map((e) => ({ ...e, sets: setsByEntry.get(e.id) ?? [] })),
          };
          const sets = s.entries.flatMap((e) => e.sets);
          const done = sets.filter((x) => x.completed);
          return {
            id: s.id,
            date: fromDbDate(s.date),
            name: s.name,
            status: s.status,
            startedAt: s.startedAt,
            finishedAt: s.finishedAt,
            durationMin: s.startedAt && s.finishedAt ? Math.round((s.finishedAt.getTime() - s.startedAt.getTime()) / 60000) : null,
            totalExercises: s.entries.length,
            completedExercises: s.entries.filter((e) => e.status === 'COMPLETED').length,
            totalSets: sets.length,
            completedSets: done.length,
            volumeKg: round1(done.reduce((sum, x) => sum + (x.reps ?? 0) * (x.weightKg ?? 0), 0)),
            notes: s.notes,
          };
        }),
      };
    }

    case 'water': {
      const [groups, targetFor] = await Promise.all([
        prisma.waterEntry.groupBy({
          by: ['date'],
          where: { userId, date: range },
          _sum: { amountMl: true },
          _count: { _all: true },
        }),
        loadTargetResolver(userId),
      ]);
      const byDate = new Map(groups.map((g) => [fromDbDate(g.date), g]));
      const page = paginate(elapsedDatesDesc(ctx, q, now), q);
      return {
        total: page.total,
        rows: page.rows.map((date) => {
          const g = byDate.get(date);
          const target = targetFor(date)?.waterMl ?? null;
          const totalMl = g ? (g._sum.amountMl ?? 0) : null;
          return {
            date,
            logged: !!g,
            entryCount: g?._count._all ?? 0,
            totalMl,
            targetMl: target,
            percent: totalMl != null && target ? Math.round((totalMl / target) * 100) : null,
          };
        }),
      };
    }

    case 'routine': {
      const groups = await prisma.dailyRoutineEntry.groupBy({
        by: ['date', 'status'],
        where: { userId, date: range },
        _count: { _all: true },
      });
      const byDate = new Map<string, Record<string, number>>();
      for (const g of groups) {
        const k = fromDbDate(g.date);
        const m = byDate.get(k) ?? {};
        m[g.status] = (m[g.status] ?? 0) + g._count._all;
        byDate.set(k, m);
      }
      const dates = [...byDate.keys()].sort().reverse();
      const page = paginate(dates, q);
      return {
        total: page.total,
        rows: page.rows.map((date) => {
          const m = byDate.get(date)!;
          const total = Object.values(m).reduce((s, n) => s + n, 0);
          const completed = m.COMPLETED ?? 0;
          return {
            date,
            total,
            completed,
            skipped: m.SKIPPED ?? 0,
            missed: m.MISSED ?? 0,
            pending: (m.PENDING ?? 0) + (m.SNOOZED ?? 0),
            completionPct: total ? Math.round((completed / total) * 100) : null,
          };
        }),
      };
    }

    case 'reminders': {
      const where = {
        userId,
        scheduledFor: {
          gte: zonedToUtc(q.from, '00:00', ctx.timezone),
          lt: zonedToUtc(addDays(q.to, 1), '00:00', ctx.timezone),
        },
      };
      const [total, rows] = await Promise.all([
        prisma.reminderOccurrence.count({ where }),
        prisma.reminderOccurrence.findMany({
          where,
          orderBy: { scheduledFor: 'desc' },
          skip,
          take,
          select: {
            id: true,
            scheduledFor: true,
            status: true,
            firedAt: true,
            actedAt: true,
            snoozedUntil: true,
            reminder: { select: { id: true, title: true, category: true } },
          },
        }),
      ]);
      return {
        total,
        rows: rows.map(({ reminder, ...r }) => ({
          ...r,
          reminderId: reminder.id,
          title: reminder.title,
          category: reminder.category,
        })),
      };
    }

    case 'measurements': {
      const where = { userId, date: range };
      const [total, rows] = await Promise.all([
        prisma.bodyMeasurement.count({ where }),
        prisma.bodyMeasurement.findMany({
          where,
          orderBy: [{ date: 'desc' }, { measuredAt: 'desc' }],
          skip,
          take,
          select: {
            id: true,
            date: true,
            measuredAt: true,
            weightKg: true,
            bodyFatPct: true,
            waistCm: true,
            chestCm: true,
            hipsCm: true,
            armCm: true,
            thighCm: true,
            notes: true,
            photoMediaId: true,
          },
        }),
      ]);
      return {
        total,
        rows: rows.map((r) => ({ ...r, date: fromDbDate(r.date) })),
      };
    }
  }
}
