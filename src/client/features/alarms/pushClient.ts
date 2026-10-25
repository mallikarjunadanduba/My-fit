import { urlBase64ToUint8Array } from './schedule';
import { serviceWorkerEnabled } from '../../pwa/pwa';

/** Browser-side Web Push helpers. All functions are safe to call on unsupported browsers. */

const OPT_OUT_KEY = 'myfit.push.optOut';

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && serviceWorkerEnabled() && 'PushManager' in window && 'Notification' in window;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function currentPermission(): NotificationPermission | 'unsupported' {
  return typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported';
}

/** Per-device preference: the user turned push off on this device, so don't silently re-subscribe. */
export function deviceOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDeviceOptOut(v: boolean) {
  try {
    if (v) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    /* storage unavailable: preference not persisted */
  }
}

/** The PWA service worker (registered at startup by src/client/pwa/pwa.ts). */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorkerEnabled()) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch (err) {
    console.warn('[alarms] service worker registration failed', err);
    return null;
  }
}

export async function getBrowserSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ?? null;
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options?.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

/** Returns a browser subscription for `vapidPublicKey`, replacing one made with an old key. */
export async function ensureBrowserSubscription(vapidPublicKey: string): Promise<PushSubscription> {
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  const key = urlBase64ToUint8Array(vapidPublicKey);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  return sub ?? reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

export function subscriptionBody(sub: PushSubscription) {
  const json = sub.toJSON();
  return {
    endpoint: sub.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' },
    userAgent: navigator.userAgent,
  };
}
