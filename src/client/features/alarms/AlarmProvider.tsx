import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, toApiError } from '../../services/api';
import { useAuth } from '../auth/AuthContext';
import { useFeedback } from '../../components/common/Feedback';
import { AlarmDialog } from './AlarmDialog';
import { dueToRing, ringKey, timerDelay } from './schedule';
import { playAlarm, unlockAudio } from './sound';
import {
  currentPermission,
  deviceOptedOut,
  ensureBrowserSubscription,
  getBrowserSubscription,
  isPushSupported,
  registerServiceWorker,
  setDeviceOptOut,
  subscriptionBody,
} from './pushClient';
import type { AlarmSummary, DeliveryOutcome, Occurrence, Overdue, PushConfig, Reminder } from './types';

const POLL_MS = 60_000;
/** Follow-up refresh after an in-page ring, so same-minute reminders created by the scheduler appear. */
const FOLLOW_UP_MS = 35_000;

export interface AlarmsContextValue {
  permission: NotificationPermission | 'unsupported';
  requestPermission: () => Promise<NotificationPermission | 'unsupported'>;
  pushSupported: boolean;
  pushConfigured: boolean;
  /** This browser holds a push subscription that the server knows about. */
  subscribed: boolean;
  subscribe: () => Promise<boolean>;
  unsubscribe: () => Promise<void>;
  sendTest: () => Promise<DeliveryOutcome[]>;
  nextReminder: Reminder | null;
  overdue: Overdue;
  /** Overdue reminders + routine items (routine items covered by an overdue reminder are not double-counted). */
  overdueCount: number;
  refresh: () => Promise<void>;
  /**
   * Called when an occurrence (or overdue routine entry) was acted on elsewhere (e.g. AlarmsPage): drops it
   * from the ring queue and from the overdue list immediately (optimistic), before the server confirms.
   */
  forget: (id: string) => void;
}

const EMPTY_OVERDUE: Overdue = { occurrences: [], routineEntries: [] };
const Ctx = createContext<AlarmsContextValue | null>(null);

/** Removes an occurrence or routine entry (by id) from an overdue snapshot. */
export function withoutOverdue(o: Overdue, id: string): Overdue {
  if (!o.occurrences.some((x) => x.id === id) && !o.routineEntries.some((x) => x.id === id)) return o;
  return { occurrences: o.occurrences.filter((x) => x.id !== id), routineEntries: o.routineEntries.filter((x) => x.id !== id) };
}

export function countOverdue(o: Overdue): number {
  const covered = new Set(o.occurrences.map((x) => x.reminder.routineItemId).filter(Boolean));
  return o.occurrences.length + o.routineEntries.filter((e) => !e.routineItemId || !covered.has(e.routineItemId)).length;
}

export function AlarmProvider({ children }: { children: ReactNode }) {
  const { timezone } = useAuth();
  const { notify } = useFeedback();
  const navigate = useNavigate();
  const location = useLocation();

  const pushSupported = isPushSupported();
  const [permission, setPermission] = useState(currentPermission());
  const [config, setConfig] = useState<PushConfig>({ pushConfigured: false, vapidPublicKey: null });
  const [subscribed, setSubscribed] = useState(false);
  const [nextReminder, setNextReminder] = useState<Reminder | null>(null);
  const [overdue, setOverdue] = useState<Overdue>(EMPTY_OVERDUE);
  const [queue, setQueue] = useState<Occurrence[]>([]);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [rearm, setRearm] = useState(0);
  const [configLoaded, setConfigLoaded] = useState(false);
  const shown = useRef(new Set<string>());
  const followUp = useRef<number | null>(null);

  const enqueue = useCallback((items: Occurrence[]) => {
    if (items.length === 0) return;
    setQueue((q) => {
      const keys = new Set(q.map(ringKey));
      const fresh = dueToRing(items, shown.current).filter((o) => !keys.has(ringKey(o)));
      return fresh.length ? [...q, ...fresh] : q;
    });
  }, []);

  // Ids acted on optimistically: hidden from overdue until a later summary no longer lists them.
  const handled = useRef(new Set<string>());

  /** One aggregated request (next alarm + overdue + push config) instead of three. */
  const refresh = useCallback(async () => {
    try {
      const s = await api.get<AlarmSummary>('/reminders/summary');
      if (!s) return;
      setNextReminder(s.next);
      let od = s.overdue;
      for (const id of handled.current) {
        const next = withoutOverdue(od, id);
        if (next === od) handled.current.delete(id);
        od = next;
      }
      setOverdue(od);
      setConfig((c) =>
        c.pushConfigured === s.pushConfigured && c.vapidPublicKey === s.vapidPublicKey ? c : { pushConfigured: s.pushConfigured, vapidPublicKey: s.vapidPublicKey },
      );
      setConfigLoaded(true);
      enqueue(od.occurrences);
    } catch {
      /* transient (offline / server asleep): next poll retries */
    }
  }, [enqueue]);

  // ── Push subscription sync ────────────────────────────────────────────
  const syncSubscription = useCallback(
    async (cfg: PushConfig) => {
      if (!pushSupported) return;
      await registerServiceWorker();
      if (!cfg.pushConfigured || !cfg.vapidPublicKey || currentPermission() !== 'granted' || deviceOptedOut()) {
        setSubscribed(false);
        return;
      }
      try {
        const sub = await ensureBrowserSubscription(cfg.vapidPublicKey);
        await api.post('/notifications/subscribe', subscriptionBody(sub));
        setSubscribed(true);
      } catch (err) {
        console.warn('[alarms] push subscription sync failed', err);
        setSubscribed(false);
      }
    },
    [pushSupported],
  );

  // Push config arrives with the first summary; sync the browser subscription once it is known.
  useEffect(() => {
    if (configLoaded) void syncSubscription(config);
  }, [configLoaded, config, syncSubscription]);

  const requestPermission = useCallback(async () => {
    if (!('Notification' in window)) return 'unsupported' as const;
    void unlockAudio();
    const p = await Notification.requestPermission();
    setPermission(p);
    return p;
  }, []);

  const subscribe = useCallback(async () => {
    if (!pushSupported) throw new Error('This browser does not support push notifications.');
    if (!config.pushConfigured || !config.vapidPublicKey) throw new Error('Push notifications are not configured on the server.');
    let p = currentPermission();
    if (p !== 'granted') p = await requestPermission();
    if (p !== 'granted') return false;
    setDeviceOptOut(false);
    const sub = await ensureBrowserSubscription(config.vapidPublicKey);
    await api.post('/notifications/subscribe', subscriptionBody(sub));
    setSubscribed(true);
    return true;
  }, [config, pushSupported, requestPermission]);

  const unsubscribe = useCallback(async () => {
    setDeviceOptOut(true);
    const sub = await getBrowserSubscription();
    if (sub) {
      await api.post('/notifications/unsubscribe', { endpoint: sub.endpoint });
      await sub.unsubscribe();
    }
    setSubscribed(false);
  }, []);

  const sendTest = useCallback(async () => {
    const res = await api.post<{ deliveries: DeliveryOutcome[] }>('/notifications/test');
    return res?.deliveries ?? [];
  }, []);

  // ── Polling, visibility and in-page timers ────────────────────────────
  // Poll only while the app is visible; refresh as soon as it comes back to the foreground.
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, POLL_MS);
    let lastWake = 0;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      // visibilitychange and focus usually fire together: one request is enough.
      if (Date.now() - lastWake < 2000) return;
      lastWake = Date.now();
      setPermission(currentPermission());
      void refresh();
      setRearm((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refresh]);

  useEffect(() => {
    const at = nextReminder?.nextTriggerAt;
    if (!nextReminder || !at) return;
    const id = window.setTimeout(async () => {
      if (Date.now() + 500 < new Date(at).getTime()) {
        setRearm((n) => n + 1); // capped wait elapsed; re-arm
        return;
      }
      try {
        const occ = await api.post<Occurrence>(`/reminders/${nextReminder.id}/ring`, { scheduledFor: at });
        if (occ) enqueue([occ]);
      } catch {
        /* reminder changed meanwhile; refresh below picks up the truth */
      }
      void refresh();
      if (followUp.current) window.clearTimeout(followUp.current);
      followUp.current = window.setTimeout(() => void refresh(), FOLLOW_UP_MS);
    }, timerDelay(at));
    return () => window.clearTimeout(id);
  }, [nextReminder, rearm, enqueue, refresh]);

  useEffect(() => () => {
    if (followUp.current) window.clearTimeout(followUp.current);
  }, []);

  // ── Service-worker messages ───────────────────────────────────────────
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as { type?: string; url?: string } | null;
      if (msg?.type === 'navigate' && msg.url) navigate(msg.url);
      else if (msg?.type === 'alarm-push') void refresh();
      else if (msg?.type === 'pushsubscriptionchange') void syncSubscription(config);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigate, refresh, syncSubscription, config]);

  // ── Ringing the head of the queue ─────────────────────────────────────
  const current = queue[0] ?? null;
  useEffect(() => {
    if (!current) return;
    const key = ringKey(current);
    if (shown.current.has(key)) return;
    shown.current.add(key);
    void api.post('/notifications/in-app-ack', { occurrenceId: current.id, action: 'shown' }).catch(() => undefined);
    try {
      // Browsers block vibration until the user has interacted with the page.
      if (navigator.userActivation?.hasBeenActive !== false) navigator.vibrate?.([400, 150, 400, 150, 700]);
    } catch {
      /* vibration unsupported or blocked */
    }
    if (current.reminder.sound) {
      void playAlarm().then((ok) => setSoundBlocked(!ok));
    } else setSoundBlocked(false);
  }, [current]);

  const forget = useCallback((id: string) => {
    handled.current.add(id);
    setQueue((q) => q.filter((o) => o.id !== id));
    setOverdue((od) => withoutOverdue(od, id));
  }, []);

  /** Optimistic: the alarm closes immediately; the request runs in the background. */
  const act = useCallback(
    async (o: Occurrence, action: 'complete' | 'snooze' | 'dismiss', minutes?: number) => {
      forget(o.id);
      if (action === 'complete') notify(`Done: ${o.reminder.title}`);
      else if (action === 'snooze') notify(`Snoozed for ${minutes ?? o.reminder.snoozeMinutes} min`, 'info');
      try {
        const updated = await api.post<Occurrence>(`/reminders/occurrences/${o.id}/${action}`, action === 'snooze' ? { minutes } : undefined);
        const until = action === 'snooze' ? updated?.snoozedUntil : null;
        if (until) window.setTimeout(() => void refresh(), timerDelay(until) + 1500);
      } catch (e) {
        const err = toApiError(e);
        if (err.status !== 404 && err.status !== 409) handled.current.delete(o.id);
        notify(err.message, 'error');
        void refresh();
      }
    },
    [forget, notify, refresh],
  );

  // ── Deep links from notification actions: /alarms?occurrence=<id>&action=done|snooze ──
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const occurrenceId = params.get('occurrence');
    const action = params.get('action');
    if (!occurrenceId || handledLink.current === location.search) return;
    handledLink.current = location.search;
    (async () => {
      if (action === 'done' || action === 'snooze') {
        try {
          const o = await api.post<Occurrence>(`/reminders/occurrences/${occurrenceId}/${action === 'done' ? 'complete' : 'snooze'}`, action === 'snooze' ? {} : undefined);
          forget(occurrenceId);
          notify(action === 'done' ? `Done: ${o?.reminder.title ?? 'reminder'}` : `Snoozed: ${o?.reminder.title ?? 'reminder'}`, action === 'done' ? 'success' : 'info');
        } catch (e) {
          notify(toApiError(e).message, 'error');
        }
        void refresh();
      } else {
        // Plain notification click: ring it in-app if it is still open.
        try {
          const od = (await api.get<AlarmSummary>('/reminders/summary'))?.overdue ?? EMPTY_OVERDUE;
          setOverdue(od);
          const match = od.occurrences.find((o) => o.id === occurrenceId);
          if (match && !shown.current.has(ringKey(match))) setQueue((q) => (q.some((x) => x.id === match.id) ? q : [match, ...q]));
        } catch {
          /* ignore */
        }
      }
      navigate(location.pathname, { replace: true });
    })();
  }, [location.search, location.pathname, navigate, notify, refresh, forget]);

  const overdueCount = countOverdue(overdue);

  const value = useMemo<AlarmsContextValue>(
    () => ({
      permission,
      requestPermission,
      pushSupported,
      pushConfigured: config.pushConfigured,
      subscribed,
      subscribe,
      unsubscribe,
      sendTest,
      nextReminder,
      overdue,
      overdueCount,
      refresh,
      forget,
    }),
    [permission, requestPermission, pushSupported, config.pushConfigured, subscribed, subscribe, unsubscribe, sendTest, nextReminder, overdue, overdueCount, refresh, forget],
  );


  return (
    <Ctx.Provider value={value}>
      {/* The overdue count is shown as a badge on the Alarms navigation item (Layout). */}
      {children}
      <AlarmDialog
        occurrence={current}
        timezone={timezone}
        queued={Math.max(0, queue.length - 1)}
        soundBlocked={soundBlocked}
        busy={false}
        onPlaySound={() => void playAlarm().then((ok) => setSoundBlocked(!ok))}
        onDone={() => current && void act(current, 'complete')}
        onSnooze={(m) => current && void act(current, 'snooze', m)}
        onDismiss={() => current && void act(current, 'dismiss')}
      />
    </Ctx.Provider>
  );
}

export function useAlarms(): AlarmsContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAlarms must be used inside <AlarmProvider>');
  return ctx;
}
