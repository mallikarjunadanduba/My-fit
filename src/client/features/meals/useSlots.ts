import { api } from '../../services/api';
import { useAsync } from '../../hooks/useAsync';
import type { MealSlot } from './types';

/** Active meal slots in display order (GET /api/meals/slots). Pass enabled=false to skip fetching. */
export function useSlots(enabled = true) {
  return useAsync(() => (enabled ? api.get<MealSlot[]>('/meals/slots') : Promise.resolve([] as MealSlot[])), [enabled]);
}

/** Slot whose default time is the latest one at or before `time` (falls back to the first slot). */
export function slotForTime(slots: MealSlot[], time: string): MealSlot | undefined {
  const timed = slots.filter((s) => s.defaultTime).sort((a, b) => a.defaultTime!.localeCompare(b.defaultTime!));
  let pick: MealSlot | undefined;
  for (const s of timed) if (s.defaultTime! <= time) pick = s;
  return pick ?? slots[0];
}
