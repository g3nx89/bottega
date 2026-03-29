/**
 * Settings panel E2E tests — panel interaction, model selector, image gen settings.
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

/** Helper: ensure settings overlay is in the desired state. */
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

// ── Settings Panel ───────────────────────────────

test.describe('Settings panel', () => {
  test('settings button exists', async () => {
    const settingsBtn = await window.$('#settings-btn');
    expect(settingsBtn).toBeTruthy();
  });

  test('settings panel opens and closes', async () => {
    await ensureSettings(false);

    // Open
    await window.click('#settings-btn');
    await window.waitForFunction(
      () => !document.querySelector('#settings-overlay')?.classList.contains('hidden'),
      { timeout: 5000 },
    );
    const overlay = await window.$('#settings-overlay');
    expect(await overlay.evaluate((el) => !el.classList.contains('hidden'))).toBe(true);

    // Close
    await window.click('#settings-close');
    await window.waitForFunction(
      () => document.querySelector('#settings-overlay')?.classList.contains('hidden'),
      { timeout: 5000 },
    );
    expect(await overlay.evaluate((el) => el.classList.contains('hidden'))).toBe(true);
  });

  test('settings panel closes with Escape key', async () => {
    await ensureSettings(true);

    await window.keyboard.press('Escape');
    await window.waitForFunction(
      () => document.querySelector('#settings-overlay')?.classList.contains('hidden'),
      { timeout: 5000 },
    );

    const overlay = await window.$('#settings-overlay');
    expect(await overlay.evaluate((el) => el.classList.contains('hidden'))).toBe(true);
  });
});

// ── Model Selector ──────────────────────────────

test.describe('Model selector', () => {
  test.beforeAll(async () => {
    await ensureSettings(true);
    await window.waitForFunction(
      () => document.querySelectorAll('#model-select option').length > 0,
      { timeout: 10000 },
    );
  });

  test('model selector is populated with options', async () => {
    const modelSelect = await window.$('#model-select');
    expect(modelSelect).toBeTruthy();
    const options = await modelSelect.$$('option');
    expect(options.length).toBeGreaterThan(0);
  });

  test('model selector has a selected value', async () => {
    const modelSelect = await window.$('#model-select');
    const value = await modelSelect.inputValue();
    expect(value).toBeTruthy();
  });

  test.afterAll(async () => {
    await ensureSettings(false);
  });
});

// ── Image Generation Settings ───────────────────

test.describe('Image generation settings', () => {
  test.beforeAll(async () => {
    await ensureSettings(true);
    await window.waitForFunction(
      () => document.querySelectorAll('#imagegen-model-select option').length > 0,
      { timeout: 10000 },
    );
  });

  test('image gen model selector exists and is populated', async () => {
    const select = await window.$('#imagegen-model-select');
    expect(select).toBeTruthy();
    const options = await select.$$('option');
    expect(options.length).toBeGreaterThan(0);
  });

  test('image gen key status shows default key info', async () => {
    const status = await window.$('#imagegen-key-status');
    expect(status).toBeTruthy();
    const text = await status.textContent();
    expect(text.length).toBeGreaterThan(0);
  });

  test.afterAll(async () => {
    await ensureSettings(false);
  });
});
