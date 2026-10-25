import type { NutritionTarget } from '@prisma/client';
import { prisma } from '../../db';
import { toDbDate } from '../../lib/dates';

/**
 * Loads every nutrition target of the user in ONE query (a handful of rows) and returns a resolver
 * with the same rule as getTargetForDate(): latest effectiveFrom ≤ date, else the earliest target.
 */
export async function loadTargetResolver(userId: string): Promise<(date: string) => NutritionTarget | null> {
  const targets = await prisma.nutritionTarget.findMany({
    where: { userId },
    orderBy: { effectiveFrom: 'asc' },
  });
  return (date: string) => {
    const d = toDbDate(date).getTime();
    let found: NutritionTarget | null = null;
    for (const t of targets) if (t.effectiveFrom.getTime() <= d) found = t;
    return found ?? targets[0] ?? null;
  };
}
