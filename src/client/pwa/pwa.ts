import { registerSW } from 'virtual:pwa-register';

/**
 * PWA runtime: service-worker registration, update prompt and install prompt.
 * The service worker is only built for production (`npm run build`); in `vite` dev mode
 * there is none, so push/offline/install are unavailable there by design.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());
export function subscribePwa(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const pwaState = {
  needRefresh: false,
  offlineReady: false,
  installEvent: null as BeforeInstallPromptEvent | null,
  installed: false,
};

let updateSW: ((reload?: boolean) => Promise<void>) | null = null;

export const serviceWorkerEnabled = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !import.meta.env.DEV;

/** Call once at startup (before React renders) so the install event isn't missed. */
export function initPwa() {
  if (typeof window === 'undefined') return;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own install button
    pwaState.installEvent = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    pwaState.installEvent = null;
    pwaState.installed = true;
    emit();
  });

  if (!serviceWorkerEnabled()) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      pwaState.needRefresh = true;
      emit();
    },
    onOfflineReady() {
      pwaState.offlineReady = true;
      emit();
    },
    onRegisteredSW(_url, reg) {
      // Check for a new version hourly while the app stays open.
      if (reg) setInterval(() => void reg.update().catch(() => undefined), 60 * 60 * 1000);
    },
  });
}

/** Activates the waiting service worker and reloads into the new version. */
export async function applyUpdate() {
  pwaState.needRefresh = false;
  emit();
  await updateSW?.(true);
}

export function dismissUpdate() {
  pwaState.needRefresh = false;
  emit();
}

/** Shows the browser's install dialog (Android/desktop Chrome, Edge). Returns true if installed. */
export async function promptInstall(): Promise<boolean> {
  const ev = pwaState.installEvent;
  if (!ev) return false;
  await ev.prompt();
  const { outcome } = await ev.userChoice;
  pwaState.installEvent = null;
  emit();
  return outcome === 'accepted';
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
