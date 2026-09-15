import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'tests/**/*.test.ts',
      // The desktop main process, with electron and electron-updater mocked.
      'apps/desktop/test/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', 'packages/web/**'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
