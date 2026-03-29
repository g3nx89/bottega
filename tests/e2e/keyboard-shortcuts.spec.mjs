/**
 * Keyboard shortcuts E2E tests — Enter sends, Escape closes settings, Shift+Enter inserts newline.
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
  // Ensure at least one tab exists so the input field is functional
  const tabs = await window.evaluate(() => window.api.listTabs());
  if (tabs.length === 0) {
    await window.evaluate(() => window.api.createTab());
    await window.waitForFunction(
      () => document.querySelectorAll('.tab-item').length > 0,
    );
  }
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ── Enter Sends Message ──────────────────────

test.describe('Enter key sends message', () => {
  test('pressing Enter sends message, creates .user-message, and clears input', async () => {
    const inputField = await window.$('#input-field');
    expect(inputField).toBeTruthy();

    // Focus and type a message
    await inputField.focus();
    await inputField.fill('Hello from E2E test');

    // Verify the input has text before sending
    const valueBefore = await inputField.inputValue();
    expect(valueBefore).toBe('Hello from E2E test');

    // Press Enter to send
    await inputField.press('Enter');

    // Wait for a .user-message to appear in the DOM
    await window.waitForFunction(
      () => document.querySelectorAll('.user-message').length > 0,
    );

    // Verify the user message was created with the correct text
    const messageText = await window.evaluate(
      () => document.querySelector('.user-message span')?.textContent,
    );
    expect(messageText).toBe('Hello from E2E test');

    // Verify the input field was cleared
    const valueAfter = await inputField.inputValue();
    expect(valueAfter).toBe('');
  });
});

// ── Escape Closes Settings ───────────────────

test.describe('Escape key closes settings', () => {
  test('Escape closes settings panel after opening it', async () => {
    // Open settings by clicking the settings button
    const settingsBtn = await window.$('#settings-btn');
    expect(settingsBtn).toBeTruthy();
    await settingsBtn.click();

    // Wait for the overlay to become visible (no hidden class)
    await window.waitForFunction(
      () => !document.querySelector('#settings-overlay').classList.contains('hidden'),
    );

    // Press Escape to close
    await window.keyboard.press('Escape');

    // Wait for the overlay to become hidden
    await window.waitForFunction(
      () => document.querySelector('#settings-overlay').classList.contains('hidden'),
    );

    const isHidden = await window.evaluate(
      () => document.querySelector('#settings-overlay').classList.contains('hidden'),
    );
    expect(isHidden).toBe(true);
  });
});

// ── Shift+Enter Does NOT Send ────────────────

test.describe('Shift+Enter inserts newline', () => {
  test('Shift+Enter does not send message and inserts a newline', async () => {
    const inputField = await window.$('#input-field');
    expect(inputField).toBeTruthy();

    // Count existing user messages before this test
    const messageCountBefore = await window.evaluate(
      () => document.querySelectorAll('.user-message').length,
    );

    // Focus and type some text
    await inputField.focus();
    await inputField.fill('');
    await inputField.type('Line one');

    // Press Shift+Enter (should insert newline, not send)
    await inputField.press('Shift+Enter');

    // Type more text after the newline
    await inputField.type('Line two');

    // Verify the input still has text containing a newline
    const value = await inputField.inputValue();
    expect(value).toContain('Line one');
    expect(value).toContain('Line two');
    expect(value).toContain('\n');

    // Verify no new .user-message was created
    const messageCountAfter = await window.evaluate(
      () => document.querySelectorAll('.user-message').length,
    );
    expect(messageCountAfter).toBe(messageCountBefore);

    // Clean up: clear the input field
    await inputField.fill('');
  });
});
