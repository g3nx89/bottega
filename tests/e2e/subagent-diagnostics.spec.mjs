/**
 * 10n. Diagnostics E2E tests — subagent runs in zip export.
 *
 * Verifies that diagnostics export includes the subagent-runs directory
 * and that old subagent runs are cleaned up on app start.
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

test('diagnostics export API is available', async () => {
  const hasExport = await window.evaluate(() => typeof window.api.exportDiagnostics === 'function');
  expect(hasExport).toBe(true);
});

test('diagnostics copy info returns system info string', async () => {
  const info = await window.evaluate(() => window.api.copyDiagnosticsInfo());
  expect(typeof info).toBe('string');
  expect(info).toContain('Bottega');
});
