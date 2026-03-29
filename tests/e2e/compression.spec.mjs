/**
 * Compression E2E tests — UI controls and IPC profile switching.
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
  // Open settings to access compression controls
  await window.click('#settings-btn');
  await window.waitForFunction(
    () => !document.querySelector('#settings-overlay')?.classList.contains('hidden'),
    { timeout: 5000 },
  );
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ── Compression UI ──────────────────────────────

test.describe('Compression UI', () => {
  test('profile selector exists', async () => {
    const profileSelect = await window.$('#compression-profile-select');
    expect(profileSelect).toBeTruthy();
  });

  test('default profile is balanced', async () => {
    const profileSelect = await window.$('#compression-profile-select');
    const value = await profileSelect?.inputValue();
    expect(value).toBe('balanced');
  });

  test('profile description is visible', async () => {
    const descEl = await window.$('#compression-profile-desc');
    expect(descEl).toBeTruthy();
    const text = await descEl?.textContent();
    expect(text?.length).toBeGreaterThan(0);
  });

  test('refresh cache button exists', async () => {
    const refreshBtn = await window.$('#compression-refresh-btn');
    expect(refreshBtn).toBeTruthy();
  });

  test('has all 4 profile options', async () => {
    const profileSelect = await window.$('#compression-profile-select');
    const options = await profileSelect?.$$('option');
    const values = await Promise.all(options?.map((o) => o.getAttribute('value')) ?? []);
    expect(values).toHaveLength(4);
    expect(values).toContain('balanced');
    expect(values).toContain('creative');
    expect(values).toContain('exploration');
    expect(values).toContain('minimal');
  });

  test('profile switching updates description', async () => {
    const profileSelect = await window.$('#compression-profile-select');
    const descEl = await window.$('#compression-profile-desc');

    const originalDesc = await descEl?.textContent();

    await profileSelect?.selectOption('minimal');
    await window.waitForFunction(
      (orig) => document.querySelector('#compression-profile-desc')?.textContent !== orig,
      originalDesc,
      { timeout: 5000 },
    );

    const newValue = await profileSelect?.inputValue();
    expect(newValue).toBe('minimal');

    const newDesc = await descEl?.textContent();
    expect(newDesc).not.toBe(originalDesc);

    // Restore
    await profileSelect?.selectOption('balanced');
    await window.waitForFunction(
      () => document.querySelector('#compression-profile-select')?.value === 'balanced',
      { timeout: 5000 },
    );
  });
});

// ── Compression Profile via IPC ─────────────────

test.describe('Compression profile switching via IPC', () => {
  test('compressionGetProfile returns current profile', async () => {
    const profile = await window.evaluate(() => window.api.compressionGetProfile());
    expect(typeof profile).toBe('string');
    expect(profile).toBe('balanced');
  });

  test('compressionGetProfiles returns all profiles', async () => {
    const profiles = await window.evaluate(() => window.api.compressionGetProfiles());
    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles).toHaveLength(4);
    expect(profiles[0]).toHaveProperty('description');
    expect(profiles[0].description.length).toBeGreaterThan(0);
  });

  test('switching profile via IPC roundtrip works', async () => {
    const result = await window.evaluate(() => window.api.compressionSetProfile('creative'));
    expect(result.success).toBe(true);

    const profile = await window.evaluate(() => window.api.compressionGetProfile());
    expect(profile).toBe('creative');

    // Restore
    await window.evaluate(() => window.api.compressionSetProfile('balanced'));
  });
});
