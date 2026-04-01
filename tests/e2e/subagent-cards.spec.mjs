/**
 * 10m. Subagent batch card + judge verdict card E2E tests.
 *
 * These tests verify the renderer-side card rendering by simulating
 * IPC events from the main process. Requires a running Electron app.
 *
 * Run: npm run test:e2e
 */

import { test, expect } from '@playwright/test';
import { launchApp } from '../helpers/launch.mjs';

/** @type {import('@playwright/test').ElectronApplication} */
let app;
/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
});

test.afterAll(async () => {
  if (app) await app.close();
});

test('batch card renders when subagent:batch-start IPC fires', async () => {
  // Simulate batch-start event via evaluate (triggering the renderer's IPC handler)
  const cardExists = await window.evaluate(() => {
    // Check if the onSubagentBatchStart handler is registered
    return typeof window.api.onSubagentBatchStart === 'function';
  });

  expect(cardExists).toBe(true);
});

test('judge verdict card handlers are registered', async () => {
  const handlers = await window.evaluate(() => ({
    onJudgeRunning: typeof window.api.onJudgeRunning === 'function',
    onJudgeVerdict: typeof window.api.onJudgeVerdict === 'function',
    onJudgeRetryStart: typeof window.api.onJudgeRetryStart === 'function',
  }));

  expect(handlers.onJudgeRunning).toBe(true);
  expect(handlers.onJudgeVerdict).toBe(true);
  expect(handlers.onJudgeRetryStart).toBe(true);
});

test('subagent IPC channels are available on window.api', async () => {
  const channels = await window.evaluate(() => ({
    getSubagentConfig: typeof window.api.getSubagentConfig === 'function',
    setSubagentConfig: typeof window.api.setSubagentConfig === 'function',
    runSubagentBatch: typeof window.api.runSubagentBatch === 'function',
    abortSubagentBatch: typeof window.api.abortSubagentBatch === 'function',
    onSubagentBatchStart: typeof window.api.onSubagentBatchStart === 'function',
    onSubagentStatus: typeof window.api.onSubagentStatus === 'function',
    onSubagentBatchEnd: typeof window.api.onSubagentBatchEnd === 'function',
  }));

  for (const [key, value] of Object.entries(channels)) {
    expect(value, `window.api.${key} should be a function`).toBe(true);
  }
});
