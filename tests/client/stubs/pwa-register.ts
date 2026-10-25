// Test stand-in for vite-plugin-pwa's `virtual:pwa-register` (no service worker in jsdom).
export function registerSW() {
  return async () => undefined;
}
