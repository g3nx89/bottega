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

  const autoRetryToggle = await window.$('#auto-retry-toggle');
  expect(autoRetryToggle).not.toBeNull();

  const maxRetriesInput = await window.$('#max-retries-input');
  expect(maxRetriesInput).not.toBeNull();

  const microJudgeList = await window.$('#micro-judge-list');
  expect(microJudgeList).not.toBeNull();
});

test('micro-judge list shows 8 judges', async () => {
  await ensureSettings(true);

  const rows = await window.$$('.micro-judge-row');
  expect(rows.length).toBe(8);
});

test('micro-judge rows have enable checkbox, label, and model select', async () => {
  await ensureSettings(true);

  const firstRow = await window.$('.micro-judge-row[data-judge="alignment"]');
  expect(firstRow).not.toBeNull();

  const checkbox = await firstRow.$('.judge-enable');
  expect(checkbox).not.toBeNull();

  const label = await firstRow.$('.judge-label');
  expect(label).not.toBeNull();
  const labelText = await label.textContent();
  expect(labelText).toBe('Alignment');

  const modelSelect = await firstRow.$('.judge-model');
  expect(modelSelect).not.toBeNull();
});

test('auto-retry toggle shows/hides max retries stepper', async () => {
  await ensureSettings(true);

  const maxRetriesRow = await window.$('#max-retries-row');
  const toggle = await window.$('#auto-retry-toggle');
  const startChecked = await toggle.evaluate((el) => el.checked);

  // Normalize to OFF so subsequent assertions are state-independent.
  // Default flipped to `autoRetry: true` in commit 24d11f1 (2026-04-11).
  if (startChecked) {
    await window.click('#auto-retry-toggle');
  }

  const offDisplay = await maxRetriesRow.evaluate((el) => el.style.display);
  expect(offDisplay).toBe('none');

  // Enable auto-retry → stepper visible.
  await window.click('#auto-retry-toggle');
  const afterEnableDisplay = await maxRetriesRow.evaluate((el) => el.style.display);
  expect(afterEnableDisplay).not.toBe('none');

  // Disable auto-retry → stepper hidden.
  await window.click('#auto-retry-toggle');
  const afterDisableDisplay = await maxRetriesRow.evaluate((el) => el.style.display);
  expect(afterDisableDisplay).toBe('none');

  // Restore original state so later tests see a consistent config.
  if (startChecked) {
    await window.click('#auto-retry-toggle');
  }
});

test('per-role model selects are present', async () => {
  await ensureSettings(true);

  for (const role of ['scout', 'analyst', 'auditor', 'judge']) {
    const select = await window.$(`#model-${role}`);
    expect(select).not.toBeNull();
  }
});

test('disabling a micro-judge persists via IPC', async () => {
  await ensureSettings(true);

  // Uncheck alignment judge
  const alignmentCheckbox = await window.$('.micro-judge-row[data-judge="alignment"] .judge-enable');
  await alignmentCheckbox.click();

  // Read back via IPC
  const config = await window.evaluate(async () => await window.api.getSubagentConfig());
  expect(config.microJudges?.alignment?.enabled).toBe(false);

  // Re-enable
  await alignmentCheckbox.click();
});

// ── Subagent IPC channels after semantic refactor ──

test('subagent IPC channels still available after semantic refactor', async () => {
  const channels = await window.evaluate(() => ({
    getSubagentConfig: typeof window.api.getSubagentConfig === 'function',
    runSubagentBatch: typeof window.api.runSubagentBatch === 'function',
    setJudgeOverride: typeof window.api.setJudgeOverride === 'function',
    forceRerunJudge: typeof window.api.forceRerunJudge === 'function',
  }));
  expect(channels.getSubagentConfig).toBe(true);
  expect(channels.runSubagentBatch).toBe(true);
  expect(channels.setJudgeOverride).toBe(true);
  expect(channels.forceRerunJudge).toBe(true);
});

test('subagent config returns valid structure with microJudges', async () => {
  const config = await window.evaluate(async () => await window.api.getSubagentConfig());
  expect(config).toBeDefined();
  expect(config).toHaveProperty('judgeMode');
  expect(config).toHaveProperty('autoRetry');
  expect(config).toHaveProperty('microJudges');
});
