import { Prisma, type ExerciseType } from '@prisma/client';
import { prisma } from '../../db';
import { conflict, notFound } from '../../lib/http';
import { assertOwnedMedia } from '../media.service';

export interface ExerciseInput {
  name: string;
  type?: ExerciseType;
  muscleGroup?: string | null;
  equipment?: string | null;
  notes?: string | null;
  imageMediaId?: string | null;
}

const exerciseSelect = {
  id: true,
  name: true,
  type: true,
  muscleGroup: true,
  equipment: true,
  notes: true,
  imageMediaId: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.ExerciseSelect;

function uniqueName<T>(p: Promise<T>): Promise<T> {
  return p.catch((err) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw conflict('You already have an exercise with this name.');
    }
    throw err;
  });
}

export async function findOwnedExercise(userId: string, id: string) {
  const ex = await prisma.exercise.findFirst({ where: { id, userId }, select: exerciseSelect });
  if (!ex) throw notFound('Exercise');
  return ex;
}

export async function listExercises(userId: string, q: { search?: string; type?: ExerciseType; includeArchived?: boolean }) {
  const rows = await prisma.exercise.findMany({
    where: {
      userId,
      ...(q.includeArchived ? {} : { archivedAt: null }),
      ...(q.type ? { type: q.type } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { muscleGroup: { contains: q.search, mode: 'insensitive' } },
              { equipment: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    select: { ...exerciseSelect, _count: { select: { entries: true, dayItems: true } } },
    orderBy: { name: 'asc' },
  });
  return rows.map(({ _count, ...e }) => ({ ...e, historyCount: _count.entries, planUses: _count.dayItems }));
}

export async function createExercise(userId: string, input: ExerciseInput) {
  if (input.imageMediaId) await assertOwnedMedia(userId, input.imageMediaId);
  return uniqueName(prisma.exercise.create({ data: { ...input, userId }, select: exerciseSelect }));
}

/** Single UPDATE … WHERE id AND userId; P2025 (no row) → 404. */
function ownedUpdate(userId: string, id: string, data: Prisma.ExerciseUpdateInput) {
  return uniqueName(prisma.exercise.update({ where: { id, userId }, data, select: exerciseSelect })).catch((err: unknown) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw notFound('Exercise');
    throw err;
  });
}

export async function updateExercise(userId: string, id: string, patch: Partial<ExerciseInput>) {
  if (patch.imageMediaId) await assertOwnedMedia(userId, patch.imageMediaId);
  const { imageMediaId, ...rest } = patch;
  return ownedUpdate(userId, id, {
    ...rest,
    ...(imageMediaId !== undefined ? { imageMedia: imageMediaId ? { connect: { id: imageMediaId } } : { disconnect: true } } : {}),
  });
}

export async function setExerciseArchived(userId: string, id: string, archived: boolean) {
  return ownedUpdate(userId, id, { archivedAt: archived ? new Date() : null });
}

/**
 * Hard delete. Session history keeps the exerciseName snapshot (FK SetNull);
 * the exercise is removed from plan templates (cascade).
 */
export async function deleteExercise(userId: string, id: string) {
  const { count } = await prisma.exercise.deleteMany({ where: { id, userId } });
  if (!count) throw notFound('Exercise');
}
