import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    // Server suites share one test database; run files one at a time.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts', 'src/shared/**/*.test.ts'],
          globalSetup: ['tests/server/globalSetup.ts'],
          setupFiles: ['tests/server/setupEnv.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        plugins: [react()],
        resolve: {
          alias: { 'virtual:pwa-register': fileURLToPath(new URL('./tests/client/stubs/pwa-register.ts', import.meta.url)) },
        },
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['tests/client/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/client/setup.ts'],
        },
      },
    ],
  },
});
