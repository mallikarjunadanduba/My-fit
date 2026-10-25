/// <reference lib="webworker" />
/**
 * MyFit Routine service worker (built by vite-plugin-pwa → /sw.js).
 *  - PWA: precaches the app shell so the installed app opens instantly and offline;
 *    navigations fall back to index.html. API calls are never cached here (personal data,
 *    and the app keeps its own in-memory cache).
 *  - Web Push: shows alarm notifications and routes notification taps back into the app.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

// ───────────── App shell ─────────────
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }));

registerRoute(({ url }) => url.origin === 'https://fonts.googleapis.com', new StaleWhileRevalidate({ cacheName: 'google-fonts-css' }));
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com',
  new CacheFirst({ cacheName: 'google-fonts', plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 365 * 24 * 3600 })] }),
);

// The page asks the waiting worker to take over when the user taps "Update" (registerType: 'prompt').
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting();
});
clientsClaim();

// ───────────── Web Push alarms ─────────────
interface PushData {
  title?: string;
  body?: string;
  tag?: string;
  test?: boolean;
  requireInteraction?: boolean;
  occurrenceId?: string;
  reminderId?: string;
  url?: string;
  actions?: { action: string; title: string }[];
}

function parsePayload(event: PushEvent): PushData | null {
  try {
    return event.data ? (event.data.json() as PushData) : null;
  } catch {
    return { title: 'MyFit Routine', body: event.data ? event.data.text() : '' };
  }
}

const windowClients = () => self.clients.matchAll({ type: 'window', includeUncontrolled: true });

async function handlePush(payload: PushData | null) {
  const data = payload ?? { title: 'MyFit Routine', body: 'You have a reminder.' };
  const all = await windowClients();
  // Tell open tabs so the in-app alarm refreshes immediately.
  for (const c of all) c.postMessage({ type: 'alarm-push', payload: data });
  // A focused tab rings the in-app alarm itself; avoid a duplicate system notification.
  if (!data.test && all.some((c) => c.focused && c.visibilityState === 'visible')) return;

  const hasOccurrence = Boolean(data.occurrenceId);
  await self.registration.showNotification(data.title || 'MyFit Routine', {
    body: data.body || '',
    tag: data.tag || data.occurrenceId || 'myfit',
    requireInteraction: Boolean(data.requireInteraction),
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/alarms', occurrenceId: data.occurrenceId || null, reminderId: data.reminderId || null },
    // `renotify`, `timestamp` and `actions` are valid but missing from older TS DOM typings.
    ...({
      renotify: true,
      timestamp: Date.now(),
      actions: hasOccurrence && Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
    } as object),
  });
}

self.addEventListener('push', (event) => {
  event.waitUntil(handlePush(parsePayload(event)));
});

async function openApp(url: string) {
  const target = new URL(url, self.location.origin);
  const all = await windowClients();
  const same = all.find((c) => new URL(c.url).origin === self.location.origin);
  if (same) {
    // The app performs the action itself (it holds the CSRF token); the SW only routes there.
    same.postMessage({ type: 'navigate', url: target.pathname + target.search });
    return same.focus();
  }
  return self.clients.openWindow(target.href);
}

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const data = (n.data ?? {}) as { url?: string; occurrenceId?: string | null };
  n.close();
  let url = data.url || '/alarms';
  if (data.occurrenceId && (event.action === 'done' || event.action === 'snooze')) {
    url = `/alarms?occurrence=${encodeURIComponent(data.occurrenceId)}&action=${event.action}`;
  }
  event.waitUntil(openApp(url));
});

// Re-subscribe when the browser rotates the subscription; the app re-syncs it with the server on next load.
self.addEventListener('pushsubscriptionchange', (event) => {
  const e = event as Event & { oldSubscription?: PushSubscription | null; waitUntil: (p: Promise<unknown>) => void };
  const options = e.oldSubscription?.options;
  e.waitUntil(
    (async () => {
      if (options) {
        try {
          await self.registration.pushManager.subscribe(options);
        } catch {
          /* The app will prompt to re-enable notifications. */
        }
      }
      for (const c of await windowClients()) c.postMessage({ type: 'pushsubscriptionchange' });
    })(),
  );
});
