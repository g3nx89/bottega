/**
 * Shared Electron launch helper for E2E tests.
 *
 * Centralizes app launch configuration to avoid duplication across spec files.
 */

import { _electron as electron } from '@playwright/test';

/**
 * Launch the Electron app in test mode.
 * @param {object} [opts]
 * @param {number} [opts.timeout] - Launch timeout in ms (default 30000)
 * @param {number} [opts.readyDelay] - Wait after domcontentloaded in ms (default 2000)
 * @param {Record<string, string>} [opts.env] - Extra env vars to merge
 * @returns {Promise<{ app: import('@playwright/test').ElectronApplication, window: import('@playwright/test').Page }>}
 */
export async function launchApp(opts = {}) {
  const app = await electron.launch({
    args: ['dist/main.js'],
    timeout: opts.timeout ?? 30_000,
    env: { ...process.env, BOTTEGA_TEST_MODE: '1', ...opts.env },
  });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(opts.readyDelay ?? 2_000);
  return { app, window };
}
