import { formatDay } from '../../services/dates';
import { weekdaySummary } from './WeekdayChips';
import type { DeliveryStatus, OccurrenceStatus, Reminder } from './types';

export const DAY_TYPE_LABEL = { ANY: 'Any day', GYM: 'Gym days', REST: 'Rest days' } as const;

export function scheduleSummary(r: Pick<Reminder, 'weekdays' | 'oneTimeDate' | 'dayType'>): string {
  if (r.oneTimeDate) return `Once on ${formatDay(r.oneTimeDate, 'EEE, d MMM')}`;
  const days = weekdaySummary(r.weekdays);
  if (r.dayType === 'ANY') return days;
  return r.weekdays.length ? `${days} · ${DAY_TYPE_LABEL[r.dayType]} only` : DAY_TYPE_LABEL[r.dayType];
}

type ChipColor = 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary';

export const OCCURRENCE_STATUS: Record<OccurrenceStatus, { label: string; color: ChipColor }> = {
  PENDING: { label: 'Pending', color: 'default' },
  SENT: { label: 'Sent', color: 'info' },
  COMPLETED: { label: 'Done', color: 'success' },
  DISMISSED: { label: 'Dismissed', color: 'default' },
  SNOOZED: { label: 'Snoozed', color: 'warning' },
  MISSED: { label: 'Missed', color: 'error' },
};

export const DELIVERY_STATUS: Record<DeliveryStatus, { label: string; color: ChipColor }> = {
  SENT: { label: 'Delivered to push service', color: 'success' },
  FAILED: { label: 'Failed', color: 'error' },
  EXPIRED: { label: 'Expired', color: 'warning' },
  SKIPPED: { label: 'Skipped', color: 'default' },
};

export const CHANNEL_LABEL = { WEB_PUSH: 'Push', IN_APP: 'In-app', TEST: 'Test' } as const;

/** "07:30" → { time: '7:30', suffix: 'AM' } — for big time displays with a small AM/PM. */
export function clockParts(hhmm: string): { time: string; suffix: string } {
  const [h, m] = hhmm.split(':').map(Number);
  return { time: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, suffix: h >= 12 ? 'PM' : 'AM' };
}
