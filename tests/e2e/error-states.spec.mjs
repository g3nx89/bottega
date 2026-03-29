/**
 * Error/disconnected state E2E tests — status dot, CSS classes, tab dot state.
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

// ── Status Dot Disconnected State ────────────

test.describe('Status dot disconnected state (no Figma)', () => {
  test('status dot shows "disconnected" class by default', async () => {
    const statusDot = await window.$('#status-dot');
    expect(statusDot).toBeTruthy();
    const hasDisconnected = await statusDot.evaluate(
      (el) => el.classList.contains('disconnected'),
    );
    expect(hasDisconnected).toBe(true);
  });

  test('status dot title shows "Disconnected"', async () => {
    const statusDot = await window.$('#status-dot');
    const title = await statusDot?.getAttribute('title');
    expect(title).toBe('Disconnected');
  });

  test('status dot is visible and has correct CSS class applied', async () => {
    const statusDot = await window.$('#status-dot');
    expect(statusDot).toBeTruthy();

    // Verify the element is visible (not display:none or visibility:hidden)
    const isVisible = await statusDot.evaluate((el) => {
      const style = globalThis.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    expect(isVisible).toBe(true);

    // Verify it does NOT have the connected class
    const hasConnected = await statusDot.evaluate(
      (el) => el.classList.contains('connected'),
    );
    expect(hasConnected).toBe(false);
  });
});

// ── Tab Dot Disconnected State ───────────────

test.describe('Tab dot disconnected state', () => {
  test('newly created tab shows disconnected class on tab dot', async () => {
    // Ensure at least one tab exists
    const tabs = await window.evaluate(() => window.api.listTabs());
    if (tabs.length === 0) {
      const result = await window.evaluate(() => window.api.createTab());
      expect(result.success).toBe(true);
      await window.waitForFunction(
        () => document.querySelectorAll('.tab-item').length > 0,
      );
    }

    // Wait for the tab dot to reflect disconnected state
    await window.waitForFunction(
      () => document.querySelector('.tab-dot.disconnected') !== null,
    );

    // Verify the tab dot has the disconnected class
    const hasDisconnected = await window.evaluate(
      () => document.querySelector('.tab-dot.disconnected') !== null,
    );
    expect(hasDisconnected).toBe(true);

    // Verify the tab dot does NOT have the connected class
    const hasConnected = await window.evaluate(
      () => document.querySelector('.tab-dot.connected') !== null,
    );
    expect(hasConnected).toBe(false);
  });
});
