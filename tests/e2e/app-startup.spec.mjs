/**
 * App startup E2E tests — launch, DOM elements, context bar, connection status.
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

// ── App Startup ──────────────────────────────────

test.describe('App startup', () => {
  test('window opens with correct title element', async () => {
    const title = await window.textContent('#app-title');
    expect(title).toBe('Bottega');
  });

  test('status indicator is present', async () => {
    const statusDot = await window.$('#status-dot');
    expect(statusDot).toBeTruthy();
  });

  test('status dot has a title attribute', async () => {
    const statusDot = await window.$('#status-dot');
    const title = await statusDot?.getAttribute('title');
    expect(title).toBeTruthy();
  });

  test('input field is present', async () => {
    const inputField = await window.$('#input-field');
    expect(inputField).toBeTruthy();
  });

  test('send button is present', async () => {
    const sendBtn = await window.$('#send-btn');
    expect(sendBtn).toBeTruthy();
  });

  test('initial screenshot captures without crash', async () => {
    const screenshot = await window.screenshot();
    expect(screenshot).toBeTruthy();
    expect(screenshot.byteLength).toBeGreaterThan(0);
  });
});

// ── Context Bar ─────────────────────────────────

test.describe('Context bar', () => {
  test('context bar renders at zero tokens', async () => {
    const contextLabel = await window.$('#context-label');
    expect(contextLabel).toBeTruthy();
    const text = await contextLabel.textContent();
    expect(text).toMatch(/^0/);
  });

  test('context fill element exists', async () => {
    const contextFill = await window.$('#context-fill');
    expect(contextFill).toBeTruthy();
  });
});

// ── Connection Status ───────────────────────────

test.describe('Connection status (no Figma)', () => {
  test('status dot shows disconnected by default', async () => {
    const statusDot = await window.$('#status-dot');
    const hasDisconnected = await statusDot.evaluate((el) => el.classList.contains('disconnected'));
    expect(hasDisconnected).toBe(true);
  });

  test('status dot title shows "Disconnected"', async () => {
    const statusDot = await window.$('#status-dot');
    const title = await statusDot?.getAttribute('title');
    expect(title).toBe('Disconnected');
  });

  test('status dot does not show connected class', async () => {
    const statusDot = await window.$('#status-dot');
    const hasConnected = await statusDot.evaluate((el) => el.classList.contains('connected'));
    expect(hasConnected).toBe(false);
  });
});

// ── App Stability ────────────────────────────────

test.describe('App stability', () => {
  test('app remains responsive', async () => {
    const title = await window.textContent('#app-title');
    expect(title).toBeTruthy();
  });

  test('final screenshot captures without crash', async () => {
    const screenshot = await window.screenshot();
    expect(screenshot).toBeTruthy();
    expect(screenshot.byteLength).toBeGreaterThan(0);
  });
});
