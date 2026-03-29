/**
 * IPC roundtrip E2E tests — preload bridge, user input interaction.
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

// ── User Input Interaction ───────────────────────

test.describe('User input interaction', () => {
  test.beforeAll(async () => {
    // Ensure there's an active tab — in test mode no Figma connection
    // auto-creates tabs, so create one programmatically.
    const tabs = await window.evaluate(() => window.api.listTabs());
    if (tabs.length === 0) {
      await window.evaluate(() => window.api.createTab());
      await window.waitForFunction(
        () => window.api.listTabs().then((t) => t.length > 0),
        { timeout: 5000 },
      );
    }
  });

  test('typing a message and sending creates a user bubble', async () => {
    const inputField = await window.$('#input-field');
    await inputField.fill('Hello, Figma!');
    await inputField.press('Enter');

    // Wait for user message to appear in chat
    await window.waitForFunction(
      () => document.querySelectorAll('.user-message').length > 0,
      { timeout: 5000 },
    );

    const userMessages = await window.$$('.user-message');
    expect(userMessages.length).toBeGreaterThan(0);

    const lastMessage = userMessages[userMessages.length - 1];
    const text = await lastMessage.textContent();
    expect(text).toContain('Hello, Figma!');
  });

  test('input field clears after sending', async () => {
    const inputField = await window.$('#input-field');
    const value = await inputField.inputValue();
    expect(value).toBe('');
  });
});
