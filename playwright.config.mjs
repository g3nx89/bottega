import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 120_000,
  retries: 0,
  workers: 1, // Electron tests must run serially
  reporter: [['list']],
  outputDir: 'tests/.artifacts/results',
  use: {
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'e2e',
      testDir: 'tests/e2e',
      testMatch: '**/*.spec.mjs',
    },
    {
      name: 'uat',
      testDir: 'tests/uat',
      testMatch: '**/*.spec.mjs',
      timeout: 300_000,
    },
    {
      name: 'agent',
      testDir: 'tests/agent',
      testMatch: '**/*.spec.mjs',
      timeout: 180_000,
      retries: 2,
    },
  ],
});
