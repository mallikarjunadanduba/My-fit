export type ActivityCategory =
  | 'WAKE_UP'
  | 'MORNING_WATER'
  | 'BREAKFAST'
  | 'MID_MORNING'
  | 'LUNCH'
  | 'PRE_WORKOUT'
  | 'GYM'
  | 'POST_WORKOUT'
  | 'WATER'
  | 'DINNER'
  | 'BEFORE_BED'
  | 'BEDTIME'
  | 'CUSTOM';

export type DayType = 'ANY' | 'GYM' | 'REST';
export type OccurrenceStatus = 'PENDING' | 'SENT' | 'COMPLETED' | 'DISMISSED' | 'SNOOZED' | 'MISSED';
export type DeliveryStatus = 'SENT' | 'FAILED' | 'EXPIRED' | 'SKIPPED';
export type DeliveryChannel = 'WEB_PUSH' | 'IN_APP' | 'TEST';

export interface Reminder {
  id: string;
  title: string;
  description: string | null;
  category: ActivityCategory;
  time: string;
  weekdays: number[];
  oneTimeDate: string | null;
  dayType: DayType;
  enabled: boolean;
  snoozeMinutes: number;
  sound: boolean;
  lastTriggeredAt: string | null;
  nextTriggerAt: string | null;
  routineItemId: string | null;
  createdAt: string;
  updatedAt: string;
  lastOccurrence: { id: string; status: OccurrenceStatus; scheduledFor: string; actedAt: string | null } | null;
}

export interface Occurrence {
  id: string;
  reminderId: string;
  scheduledFor: string;
  status: OccurrenceStatus;
  firedAt: string | null;
  actedAt: string | null;
  snoozedUntil: string | null;
  dueAt: string;
  inAppShownAt: string | null;
  reminder: {
    id: string;
    title: string;
    description: string | null;
    category: ActivityCategory;
    time: string;
    sound: boolean;
    snoozeMinutes: number;
    routineItemId: string | null;
  };
}

export interface OverdueRoutineEntry {
  id: string;
  date: string;
  title: string;
  category: ActivityCategory;
  scheduledTime: string;
  scheduledAt: string;
  status: 'PENDING' | 'SNOOZED';
  snoozedUntil: string | null;
  routineItemId: string | null;
}

export interface Overdue {
  occurrences: Occurrence[];
  routineEntries: OverdueRoutineEntry[];
}

export interface DeliveryOutcome {
  subscriptionId: string | null;
  endpointHost: string | null;
  status: DeliveryStatus;
  statusCode: number | null;
  error: string | null;
}

export interface HistoryItem extends Occurrence {
  deliveries: {
    id: string;
    channel: DeliveryChannel;
    status: DeliveryStatus;
    statusCode: number | null;
    error: string | null;
    createdAt: string;
    subscriptionId: string | null;
    device: string | null;
  }[];
}

export interface PushSubscriptionRow {
  id: string;
  endpoint: string;
  endpointHost: string | null;
  userAgent: string | null;
  failureCount: number;
  lastSuccessAt: string | null;
  revokedAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PushConfig {
  pushConfigured: boolean;
  vapidPublicKey: string | null;
}

/** GET /reminders/summary — the AlarmProvider's single poll. */
export interface AlarmSummary extends PushConfig {
  next: Reminder | null;
  overdue: Overdue;
}
