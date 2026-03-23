/**
 * Electron E2E tests — proper Playwright test structure.
 *
 * Tests app startup, UI elements, and compression controls.
 * Requires: node scripts/build.mjs before running.
 *
 * Run: npm run test:e2e
 */

import { _electron as electron, test, expect } from '@playwright/test';

/** @type {import('@playwright/test').ElectronApplication} */
let app;
/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['dist/main.js'],
    timeout: 30000,
    env: { ...process.env, FIGMA_COWORK_TEST_MODE: '1' },
  });
  window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  // Allow UI to fully render
  await window.waitForTimeout(2000);
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ── App Startup ──────────────────────────────────

test.describe('App startup', () => {
  test('window opens with correct title element', async () => {
    const title = await window.textContent('#app-title');
    expect(title).toBeTruthy();
  });

  test('status indicator is present', async () => {
    const statusDot = await window.$('#status-dot');
    expect(statusDot).toBeTruthy();
  });

  test('status text is visible', async () => {
    const statusText = await window.textContent('#status-text');
    expect(statusText).toBeTruthy();
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

// ── Settings Panel ───────────────────────────────

test.describe('Settings panel', () => {
  test.beforeAll(async () => {
    const settingsBtn = await window.$('#settings-btn');
    if (settingsBtn) await settingsBtn.click();
    await window.waitForTimeout(500);
  });

  test('settings button exists', async () => {
    const settingsBtn = await window.$('#settings-btn');
    expect(settingsBtn).toBeTruthy();
  });
});

// ── Compression Controls ─────────────────────────

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
    await window.waitForTimeout(300);

    const newValue = await profileSelect?.inputValue();
    expect(newValue).toBe('minimal');

    const newDesc = await descEl?.textContent();
    expect(newDesc).not.toBe(originalDesc);

    // Restore
    await profileSelect?.selectOption('balanced');
    await window.waitForTimeout(300);
  });
});

// ── IPC Roundtrip ────────────────────────────────

test.describe('IPC communication', () => {
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
});

// ── User Input Interaction ───────────────────────

test.describe('User input interaction', () => {
  test('typing a message and sending creates a user bubble', async () => {
    const inputField = await window.$('#input-field');
    await inputField.fill('Hello, Figma!');
    await inputField.press('Enter');
    await window.waitForTimeout(500);

    // Look for user message bubble in chat area
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

// ── Settings Panel Interaction ──────────────────

test.describe('Settings panel interaction', () => {
  test('settings panel opens and closes', async () => {
    // Ensure closed first
    const overlay = await window.$('#settings-overlay');
    const isHidden = await overlay.evaluate((el) => el.classList.contains('hidden'));
    if (!isHidden) {
      await window.click('#settings-close');
      await window.waitForTimeout(300);
    }

    // Open
    await window.click('#settings-btn');
    await window.waitForTimeout(300);
    const isVisibleAfterOpen = await overlay.evaluate((el) => !el.classList.contains('hidden'));
    expect(isVisibleAfterOpen).toBe(true);

    // Close via close button
    await window.click('#settings-close');
    await window.waitForTimeout(300);
    const isHiddenAfterClose = await overlay.evaluate((el) => el.classList.contains('hidden'));
    expect(isHiddenAfterClose).toBe(true);
  });

  test('settings panel closes with Escape key', async () => {
    await window.click('#settings-btn');
    await window.waitForTimeout(300);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    const overlay = await window.$('#settings-overlay');
    const isHidden = await overlay.evaluate((el) => el.classList.contains('hidden'));
    expect(isHidden).toBe(true);
  });
});

// ── Model Selector ──────────────────────────────

test.describe('Model selector', () => {
  test.beforeAll(async () => {
    // Open settings to access model select
    const overlay = await window.$('#settings-overlay');
    const isHidden = await overlay.evaluate((el) => el.classList.contains('hidden'));
    if (isHidden) {
      await window.click('#settings-btn');
      await window.waitForTimeout(500);
    }
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
    // Close settings
    await window.click('#settings-close');
    await window.waitForTimeout(300);
  });
});

// ── Context Bar ─────────────────────────────────

test.describe('Context bar', () => {
  test('context bar renders at zero tokens', async () => {
    const contextLabel = await window.$('#context-label');
    expect(contextLabel).toBeTruthy();
    const text = await contextLabel.textContent();
    // Context label shows "0K / 1M" or similar zero-token format
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

  test('status text shows "Disconnected"', async () => {
    const statusText = await window.textContent('#status-text');
    expect(statusText).toBe('Disconnected');
  });

  test('status dot does not show connected class', async () => {
    const statusDot = await window.$('#status-dot');
    const hasConnected = await statusDot.evaluate((el) => el.classList.contains('connected'));
    expect(hasConnected).toBe(false);
  });
});

// ── Image Generation Settings ───────────────────

test.describe('Image generation settings', () => {
  test.beforeAll(async () => {
    await window.click('#settings-btn');
    await window.waitForTimeout(500);
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
    await window.click('#settings-close');
    await window.waitForTimeout(300);
  });
});

// ── Compression Profile via IPC ─────────────────

test.describe('Compression profile switching via IPC', () => {
  test('switching profile via IPC roundtrip works', async () => {
    // Set to creative
    const result = await window.evaluate(() => window.api.compressionSetProfile('creative'));
    expect(result.success).toBe(true);

    // Verify
    const profile = await window.evaluate(() => window.api.compressionGetProfile());
    expect(profile).toBe('creative');

    // Restore
    await window.evaluate(() => window.api.compressionSetProfile('balanced'));
  });
});

// ── App Stability ────────────────────────────────

test.describe('App stability', () => {
  test('app remains responsive after settings interaction', async () => {
    const title = await window.textContent('#app-title');
    expect(title).toBeTruthy();
  });

  test('final screenshot captures without crash', async () => {
    const screenshot = await window.screenshot();
    expect(screenshot).toBeTruthy();
    expect(screenshot.byteLength).toBeGreaterThan(0);
  });
});
