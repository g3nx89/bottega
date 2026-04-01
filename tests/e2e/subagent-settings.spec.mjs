/**
 * 10m. Subagent Settings E2E tests — settings panel interaction.
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

async function ensureSettings(open) {
  const overlay = await window.$('#settings-overlay');
  const isHidden = await overlay.evaluate((el) => el.classList.contains('hidden'));
  if (open && isHidden) {
    await window.click('#settings-btn');
    await window.waitForFunction(
      () => !document.querySelector('#settings-overlay')?.classList.contains('hidden'),
      { timeout: 5000 },
    );
  } else if (!open && !isHidden) {
    await window.click('#settings-close');
    await window.waitForFunction(
      () => document.querySelector('#settings-overlay')?.classList.contains('hidden'),
      { timeout: 5000 },
    );
  }
}

test('subagent settings section is visible with default values', async () => {
  await ensureSettings(true);

  const judgeModeSelect = await window.$('#judge-mode-select');
  expect(judgeModeSelect).not.toBeNull();

  const autoRetryToggle = await window.$('#auto-retry-toggle');
  expect(autoRetryToggle).not.toBeNull();

  const maxRetriesInput = await window.$('#max-retries-input');
  expect(maxRetriesInput).not.toBeNull();
});

test('judge mode dropdown has correct options', async () => {
  await ensureSettings(true);

  const options = await window.$$eval('#judge-mode-select option', (opts) =>
    opts.map((o) => ({ value: o.value, text: o.textContent })),
  );

  expect(options).toEqual([
    { value: 'off', text: 'Off' },
    { value: 'auto', text: 'Auto (after mutations)' },
    { value: 'ask', text: 'On request' },
  ]);
});

test('auto-retry toggle shows/hides max retries stepper', async () => {
  await ensureSettings(true);

  const maxRetriesRow = await window.$('#max-retries-row');

  // Initially hidden (auto-retry off by default)
  const initialDisplay = await maxRetriesRow.evaluate((el) => el.style.display);
  expect(initialDisplay).toBe('none');

  // Enable auto-retry
  await window.click('#auto-retry-toggle');
  const afterEnableDisplay = await maxRetriesRow.evaluate((el) => el.style.display);
  expect(afterEnableDisplay).not.toBe('none');

  // Disable auto-retry
  await window.click('#auto-retry-toggle');
  const afterDisableDisplay = await maxRetriesRow.evaluate((el) => el.style.display);
  expect(afterDisableDisplay).toBe('none');
});

test('per-role model selects are present', async () => {
  await ensureSettings(true);

  for (const role of ['scout', 'analyst', 'auditor', 'judge']) {
    const select = await window.$(`#model-${role}`);
    expect(select).not.toBeNull();
  }
});

test('changing judge mode persists via IPC', async () => {
  await ensureSettings(true);

  await window.selectOption('#judge-mode-select', 'auto');

  // Read back via IPC — Playwright evaluate runs in renderer context
  const config = await window.evaluate(async () => await window.api.getSubagentConfig());
  expect(config.judgeMode).toBe('auto');

  // Reset to default
  await window.selectOption('#judge-mode-select', 'ask');
});
