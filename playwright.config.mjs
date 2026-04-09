import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 120_000,
  retries: 0,
  workers: 1, // Electron tests must run serially
  reporter: [['list'], ['./tests/helpers/agent-metrics-reporter.mjs']],
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
      testMatch: '**/tier[0-4]*.spec.mjs',
      timeout: 180_000,
      retries: 2,
    },
    {
      name: 'imagegen',
      testDir: 'tests/agent',
      testMatch: '**/tier5*.spec.mjs',
      timeout: 300_000,
      retries: 1,
    },
    {
      name: 'resilience',
      testDir: 'tests/agent',
      testMatch: '**/tier6*.spec.mjs',
      timeout: 900_000,
      retries: 0,
    },
  ],
});
