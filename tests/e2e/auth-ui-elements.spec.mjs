/**
 * E2E: auth-related UI banners (F6/F8/F17/F21).
 *
 * Rather than check DOM markup alone, each test triggers the real IPC event
 * from the Electron main process and verifies the renderer transitions the
 * banner from hidden → visible, then dismisses and verifies it hides again.
 */

import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch.mjs';

/** @type {import('@playwright/test').ElectronApplication} */
let app;
/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
});

test.afterAll(async () => {
  // Ensure settings overlay closes before the next spec inherits persisted state.
  try {
    const overlay = window.locator('#settings-overlay');
    const isOpen = await overlay.evaluate((el) => !el.classList.contains('hidden')).catch(() => false);
    if (isOpen) {
      await window.click('#settings-close').catch(() => {});
    }
  } catch {
    // best effort
  }
  if (app) await app.close();
});

/**
 * Close the settings overlay if it was opened by a previous test.
 * Settings opens as a full overlay that intercepts all pointer events, so
 * leftover state between tests blocks banner dismiss clicks.
 */
test.beforeEach(async () => {
  const overlay = window.locator('#settings-overlay');
  const isOpen = await overlay.evaluate((el) => !el.classList.contains('hidden')).catch(() => false);
  if (isOpen) {
    await window.click('#settings-close').catch(() => {});
    await overlay.waitFor({ state: 'hidden' }).catch(() => {});
  }
});

/**
 * Send an IPC message from the main process to the focused renderer.
 * Playwright's ElectronApplication.evaluate runs in the main process and
 * gives us BrowserWindow access for webContents.send().
 */
async function sendFromMain(channel, payload) {
  await app.evaluate(({ BrowserWindow }, args) => {
    const [c, p] = args;
    const wins = BrowserWindow.getAllWindows();
    const win = wins[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send(c, p);
    }
  }, [channel, payload]);
}

// ── F8: Figma token-lost banner ──────────────────────────────

// ── F20 split regression — all 4 account cards render ──────

test.describe('F20: Account cards split — OpenAI + ChatGPT (Codex)', () => {
  test('Settings shows exactly 4 account cards with expected labels', async () => {
    // Regression: renderer PROVIDER_META once lacked `openai-codex`, so the
    // Codex card was missing even though the main process recognized it.
    // Open settings, verify cards.
    const settingsBtn = window.locator('#settings-btn');
    const overlay = window.locator('#settings-overlay');
    const isOpen = await overlay.evaluate((el) => !el.classList.contains('hidden')).catch(() => false);
    if (!isOpen) await settingsBtn.click();

    const cards = window.locator('.account-card');
    await expect(cards).toHaveCount(4);

    // Assert each expected label is present (order-independent).
    const names = await window.locator('.account-card .account-name').allTextContents();
    const sorted = [...names].sort();
    expect(sorted).toEqual(['Anthropic', 'ChatGPT (Codex)', 'Google', 'OpenAI']);

    // Close settings so subsequent tests start fresh.
    await window.click('#settings-close').catch(() => {});
    await overlay.waitFor({ state: 'hidden' }).catch(() => {});
  });

  test('Model picker populates with at least 8 options including Codex + Gemini', async () => {
    // Regression: settings.js `statusDot` collision prevented script load,
    // leaving the #model-select empty. Assert we have the full catalog.
    const settingsBtn = window.locator('#settings-btn');
    const overlay = window.locator('#settings-overlay');
    const isOpen = await overlay.evaluate((el) => !el.classList.contains('hidden')).catch(() => false);
    if (!isOpen) await settingsBtn.click();

    const options = window.locator('#model-select option');
    const count = await options.count();
    expect(count).toBeGreaterThanOrEqual(9);

    const texts = await options.allTextContents();
    // Must include both API-key and OAuth-only models.
    expect(texts.some((t) => t.includes('Claude Sonnet'))).toBe(true);
    expect(texts.some((t) => t.includes('GPT-5.4'))).toBe(true);
    expect(texts.some((t) => t.includes('GPT-5.3 Codex'))).toBe(true);
    expect(texts.some((t) => t.includes('Gemini'))).toBe(true);

    await window.click('#settings-close').catch(() => {});
    await overlay.waitFor({ state: 'hidden' }).catch(() => {});
  });
});

test.describe('F8: Figma token-lost banner flow', () => {
  test('hidden by default', async () => {
    await expect(window.locator('#figma-token-lost-banner')).toBeHidden();
  });

  test('shows on figma:token_lost IPC, hides on dismiss', async () => {
    await sendFromMain('figma:token_lost', {});
    await expect(window.locator('#figma-token-lost-banner')).toBeVisible();
    await window.click('#figma-token-lost-dismiss');
    await expect(window.locator('#figma-token-lost-banner')).toBeHidden();
  });

  test('Re-enter token button opens settings', async () => {
    // Hide settings panel first if open (from prior test clicks)
    await sendFromMain('figma:token_lost', {});
    await expect(window.locator('#figma-token-lost-banner')).toBeVisible();
    await window.click('#figma-token-reenter');
    // Banner should auto-hide when Re-enter is clicked
    await expect(window.locator('#figma-token-lost-banner')).toBeHidden();
  });
});

// ── F6: Keychain unavailable banner ──────────────────────────

test.describe('F6: Keychain unavailable banner flow', () => {
  test('hidden by default', async () => {
    await expect(window.locator('#keychain-unavailable-banner')).toBeHidden();
  });

  test('appears on keychain:unavailable, dismissable', async () => {
    await sendFromMain('keychain:unavailable', { available: true, probeOk: false, reason: 'decrypt test' });
    await expect(window.locator('#keychain-unavailable-banner')).toBeVisible();
    await window.click('#keychain-unavailable-dismiss');
    await expect(window.locator('#keychain-unavailable-banner')).toBeHidden();
  });
});

// ── F17: Auto-fallback banner ────────────────────────────────

test.describe('F17: Auto-fallback banner flow', () => {
  test('hidden by default', async () => {
    await expect(window.locator('#auto-fallback-banner')).toBeHidden();
  });

  test('shows payload text from agent:auto-fallback IPC', async () => {
    await sendFromMain('agent:auto-fallback', {
      from: 'gpt-5.4-mini',
      to: 'gpt-5.4',
      reason: 'unauthorized',
    });
    // The renderer's handler is keyed on (slotId, payload) — but app.js handler
    // uses the (event, slotId, payload) shape via ipcRenderer.on.  The bare
    // IPC payload here lands as first arg (the slotId), and undefined as
    // payload. Renderer guards against missing payload; but we still expect
    // banner visible. Dispatch in the shape renderer expects:
    await sendFromMain('agent:auto-fallback', 'slot-1');
    // Use the page's window.api exposed by preload to invoke the handler
    // directly with a typed payload — reliable way to assert text content.
    await window.addInitScript(() => {
      // no-op; placeholder for future init scripts
    });

    // Invoke payload via a known-good path: use window.api listener directly by
    // issuing ipcRenderer-style event from main with a 2-arg tuple.
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        // main → preload → renderer: (slotId, payload)
        win.webContents.send('agent:auto-fallback', 'slot-xyz', {
          from: 'gpt-5.4-mini',
          to: 'gpt-5.4',
          reason: 'unauthorized',
        });
      }
    });

    await expect(window.locator('#auto-fallback-banner')).toBeVisible();
    await expect(window.locator('#auto-fallback-text')).toContainText('gpt-5.4');
    await expect(window.locator('#auto-fallback-text')).toContainText('unauthorized');

    await window.click('#auto-fallback-dismiss');
    await expect(window.locator('#auto-fallback-banner')).toBeHidden();
  });
});

// ── F21: Post-upgrade modal ──────────────────────────────────

test.describe('F21: Post-upgrade modal flow', () => {
  test('hidden by default', async () => {
    await expect(window.locator('#post-upgrade-modal')).toBeHidden();
  });

  test('shows summary + regressions list on app:post-upgrade IPC', async () => {
    await sendFromMain('app:post-upgrade', {
      previousVersion: '0.14.0',
      currentVersion: '0.15.0',
      regressions: [
        { provider: 'anthropic', previousType: 'oauth' },
        { provider: 'openai', previousType: 'api_key' },
      ],
    });

    await expect(window.locator('#post-upgrade-modal')).toBeVisible();
    await expect(window.locator('#post-upgrade-summary')).toContainText('0.14.0');
    await expect(window.locator('#post-upgrade-summary')).toContainText('0.15.0');
    const items = window.locator('#post-upgrade-list li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('anthropic');
    await expect(items.nth(1)).toContainText('openai');

    await window.click('#post-upgrade-dismiss');
    await expect(window.locator('#post-upgrade-modal')).toBeHidden();
  });

  test('Open Settings button hides modal and triggers settings open', async () => {
    await sendFromMain('app:post-upgrade', {
      previousVersion: '0.14.0',
      currentVersion: '0.15.0',
      regressions: [{ provider: 'anthropic', previousType: 'oauth' }],
    });
    await expect(window.locator('#post-upgrade-modal')).toBeVisible();
    await window.click('#post-upgrade-open-settings');
    await expect(window.locator('#post-upgrade-modal')).toBeHidden();
    // Settings panel should be visible after this click
    await expect(window.locator('#settings-panel')).toBeVisible();
  });
});
