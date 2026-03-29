/**
 * Tab lifecycle E2E tests — creation, switching, closing, max limit, UI sync.
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

// ── Initial State ────────────────────────────

test.describe('Tab initial state', () => {
  test('listTabs returns an array with zero or more tabs', async () => {
    const tabs = await window.evaluate(() => window.api.listTabs());
    expect(Array.isArray(tabs)).toBe(true);
    expect(tabs.length).toBeGreaterThanOrEqual(0);
  });
});

// ── Tab Creation ─────────────────────────────

test.describe('Tab creation', () => {
  test('createTab creates a new tab and listTabs length increases', async () => {
    const before = await window.evaluate(() => window.api.listTabs());
    const result = await window.evaluate(() => window.api.createTab());
    expect(result.success).toBe(true);

    // Wait for the renderer to process the tab:created event
    await window.waitForFunction(
      (prevLen) => document.querySelectorAll('.tab-item').length > prevLen,
      before.length,
    );

    const after = await window.evaluate(() => window.api.listTabs());
    expect(after.length).toBe(before.length + 1);
  });

  test('new tab appears as "New Tab" in tab bar', async () => {
    // Ensure at least one tab exists from the previous test
    await window.waitForFunction(
      () => document.querySelectorAll('.tab-item').length > 0,
    );

    const labels = await window.evaluate(() =>
      [...document.querySelectorAll('.tab-label')].map((el) => el.textContent),
    );
    expect(labels).toContain('New Tab');
  });

  test('createTab up to max (4) succeeds, 5th fails with "Maximum" error', async () => {
    // Close all existing tabs first to start from a clean slate
    const existing = await window.evaluate(() => window.api.listTabs());
    for (const tab of existing) {
      await window.evaluate((id) => window.api.closeTab(id), tab.id);
    }
    // Wait for all tabs to be removed from the DOM
    await window.waitForFunction(
      () => document.querySelectorAll('.tab-item').length === 0,
    );

    // Create exactly 4 tabs (the maximum)
    for (let i = 0; i < 4; i++) {
      const res = await window.evaluate(() => window.api.createTab());
      expect(res.success).toBe(true);
    }

    await window.waitForFunction(
      () => document.querySelectorAll('.tab-item').length === 4,
    );

    // 5th creation should fail
    const fifth = await window.evaluate(() => window.api.createTab());
    expect(fifth.success).toBe(false);
    expect(fifth.error).toMatch(/Maximum/i);
  });
});

// ── Tab Bar UI ───────────────────────────────

test.describe('Tab bar UI', () => {
  test('tab bar UI reflects the correct number of .tab-item elements', async () => {
    const tabCount = await window.evaluate(() => window.api.listTabs().then((t) => t.length));
    const domCount = await window.evaluate(() => document.querySelectorAll('.tab-item').length);
    expect(domCount).toBe(tabCount);
  });
});

// ── Tab Closing ──────────────────────────────

test.describe('Tab closing', () => {
  test('closeTab removes tab and listTabs length decreases', async () => {
    const before = await window.evaluate(() => window.api.listTabs());
    expect(before.length).toBeGreaterThan(0);

    const tabToClose = before[before.length - 1].id;
    await window.evaluate((id) => window.api.closeTab(id), tabToClose);

    // Wait for the DOM to reflect the removal
    await window.waitForFunction(
      (prevLen) => document.querySelectorAll('.tab-item').length < prevLen,
      before.length,
    );

    const after = await window.evaluate(() => window.api.listTabs());
    expect(after.length).toBe(before.length - 1);
  });

  test('after closing active tab, another tab becomes active or empty state', async () => {
    // Ensure we have at least 2 tabs
    const tabs = await window.evaluate(() => window.api.listTabs());
    if (tabs.length < 2) {
      await window.evaluate(() => window.api.createTab());
      await window.waitForFunction(
        (prevLen) => document.querySelectorAll('.tab-item').length > prevLen,
        tabs.length,
      );
    }

    // Find the active tab
    const activeId = await window.evaluate(
      () => document.querySelector('.tab-item.active')?.dataset.slotId,
    );
    expect(activeId).toBeTruthy();

    const beforeCount = await window.evaluate(() => document.querySelectorAll('.tab-item').length);

    // Close the active tab
    await window.evaluate((id) => window.api.closeTab(id), activeId);

    await window.waitForFunction(
      (prevLen) => document.querySelectorAll('.tab-item').length < prevLen,
      beforeCount,
    );

    const remaining = await window.evaluate(() => document.querySelectorAll('.tab-item').length);
    if (remaining > 0) {
      // Another tab should now be active
      const newActive = await window.evaluate(
        () => document.querySelector('.tab-item.active')?.dataset.slotId,
      );
      expect(newActive).toBeTruthy();
      expect(newActive).not.toBe(activeId);
    }
    // If remaining === 0, empty state is acceptable
  });
});
