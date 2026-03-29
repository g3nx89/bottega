/**
 * Pin toggle E2E tests — verify always-on-top behavior.
 *
 * Tests the pin button toggles the window's always-on-top state
 * and updates the UI accordingly.
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

test.describe('Pin toggle', () => {
  test('pin button exists', async () => {
    const pinBtn = await window.$('#pin-btn');
    expect(pinBtn).toBeTruthy();
  });

  test('initial state is not pinned', async () => {
    const pinBtn = await window.$('#pin-btn');
    const cls = await pinBtn.getAttribute('class');
    expect(cls).not.toContain('pinned');

    const isOnTop = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
    );
    expect(isOnTop).toBe(false);
  });

  test('clicking pin button activates always-on-top', async () => {
    await window.click('#pin-btn');
    await window.waitForFunction(
      () => document.querySelector('#pin-btn')?.classList.contains('pinned'),
      { timeout: 2000 },
    );

    const isOnTop = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
    );
    expect(isOnTop).toBe(true);
  });

  test('clicking again deactivates always-on-top', async () => {
    await window.click('#pin-btn');
    await window.waitForFunction(
      () => !document.querySelector('#pin-btn')?.classList.contains('pinned'),
      { timeout: 2000 },
    );

    const isOnTop = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
    );
    expect(isOnTop).toBe(false);
  });
});
