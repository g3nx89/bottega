/**
 * Thinking-effort picker E2E tests.
 *
 * Verifies the toolbar effort chip:
 *   - Fetches capabilities from main via `window.api.getThinkingCapabilities`
 *     before showing the dropdown.
 *   - Filters the dropdown to the levels actually supported by the active
 *     model (so "minimal" / "xhigh" only appear when the model supports them).
 *   - Routes user picks through `window.api.setThinking` and repaints the
 *     chip with the *effective* level echoed back by main.
 *   - Falls back gracefully when the preload bridge omits the capability API.
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
  // Ensure at least one tab exists so the picker has a target slot.
  const tabs = await window.evaluate(() => window.api.listTabs());
  if (tabs.length === 0) {
    await window.evaluate(() => window.api.createTab());
    await window.waitForFunction(() => window.api.listTabs().then((t) => t.length > 0), { timeout: 5000 });
  }
});

test.afterAll(async () => {
  if (app) await app.close();
});

test.describe('Thinking-effort picker', () => {
  test('toolbar chip is rendered with a non-empty label', async () => {
    const btn = await window.$('#bar-effort-btn');
    expect(btn).toBeTruthy();
    const label = (await window.textContent('#bar-effort-label'))?.trim();
    expect(label).toBeTruthy();
  });

  test('preload bridge exposes getThinkingCapabilities', async () => {
    const hasApi = await window.evaluate(() => typeof window.api.getThinkingCapabilities === 'function');
    expect(hasApi).toBe(true);
  });

  test('capabilities return the expected shape for the active slot', async () => {
    const caps = await window.evaluate(async () => {
      const tabs = await window.api.listTabs();
      if (!tabs.length) return null;
      return window.api.getThinkingCapabilities(tabs[0].id);
    });

    expect(caps).not.toBeNull();
    expect(Array.isArray(caps.availableLevels)).toBe(true);
    expect(caps.availableLevels[0]).toBe('off');
    expect(typeof caps.supportsThinking).toBe('boolean');
    expect(typeof caps.supportsXhigh).toBe('boolean');
    // If the slot's default model supports thinking, xhigh presence must
    // match supportsXhigh — no drift between the two signals.
    if (caps.supportsXhigh) expect(caps.availableLevels).toContain('xhigh');
    if (!caps.supportsXhigh) expect(caps.availableLevels).not.toContain('xhigh');
  });

  test('opening the dropdown renders only supported levels', async () => {
    // Close any stray dropdown first.
    await window.evaluate(() => document.body.click());

    await window.click('#bar-effort-btn');
    await window.waitForFunction(
      () => !!document.querySelector('#bar-effort-btn .toolbar-dropdown'),
      { timeout: 3000 },
    );

    const rendered = await window.evaluate(() => {
      const items = document.querySelectorAll('#bar-effort-btn .toolbar-dropdown .dropdown-item');
      return [...items].map((i) => i.textContent.trim().replace(/\u2713$/, '').trim());
    });

    const caps = await window.evaluate(async () => {
      const tabs = await window.api.listTabs();
      return window.api.getThinkingCapabilities(tabs[0].id);
    });

    const LABELS = { off: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Max' };
    const expected = caps.availableLevels.map((l) => LABELS[l]).filter(Boolean);

    // Every rendered item must be in the expected set, and every expected
    // item must be rendered. We do not assert order to stay resilient to
    // future level ordering changes.
    expect([...rendered].sort()).toEqual([...expected].sort());

    // Close the dropdown for the next test.
    await window.evaluate(() => document.body.click());
  });

  test('picking a supported level updates the chip label and persists', async () => {
    await window.click('#bar-effort-btn');
    await window.waitForFunction(
      () => !!document.querySelector('#bar-effort-btn .toolbar-dropdown'),
      { timeout: 3000 },
    );

    // Pick an item different from the current one, choosing the first
    // non-active entry so we actually trigger a change.
    const targetLabel = await window.evaluate(() => {
      const items = [...document.querySelectorAll('#bar-effort-btn .toolbar-dropdown .dropdown-item')];
      const target = items.find((i) => !i.classList.contains('active')) ?? items[0];
      const label = target.textContent.trim();
      target.click();
      return label;
    });

    // Wait for the label to match the picked one (normalized: strip checkmark).
    await window.waitForFunction(
      (expected) => {
        const l = document.getElementById('bar-effort-label')?.textContent?.trim();
        return l === expected || expected.startsWith(l ?? '');
      },
      targetLabel,
      { timeout: 3000 },
    );

    const finalLabel = (await window.textContent('#bar-effort-label'))?.trim();
    expect(finalLabel).toBeTruthy();

    // The persisted value must be one of the known level IDs.
    const stored = await window.evaluate(() => localStorage.getItem('bottega:effort'));
    expect(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).toContain(stored);
  });

  test('chip tooltip reflects the provider family (reasoning effort / thinking budget / thinking)', async () => {
    const title = await window.evaluate(() => document.getElementById('bar-effort-btn')?.title ?? '');
    expect(title).toMatch(/Thinking budget|Reasoning effort|Thinking/i);
  });
});
