import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: 'src/client',
  publicDir: '../../public',
  plugins: [
    react(),
    // Installable PWA: our own service worker (src/client/sw.ts → /sw.js) with a precache manifest
    // injected; it also handles Web Push alarms. The web manifest lives in public/.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: '.',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 3000}` },
  },
});
