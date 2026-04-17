/**
 * Guardrails confirmation modal — E2E (Playwright-Electron).
 *
 * Drives the renderer modal via the exposed `window.guardrailsModal.showConfirmRequest`
 * test hook (rather than firing ipcRenderer events from the page context, which
 * isn't possible across the preload boundary).
 *
 * Run: npm run test:e2e -- guardrails-modal
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
  if (window) {
    await window.evaluate(() => {
      if (window.__grOriginalShowConfirmRequest && window.guardrailsModal) {
        window.guardrailsModal.showConfirmRequest = window.__grOriginalShowConfirmRequest;
      }
      window.__grSpyInstalled = false;
      window.__grResponses = [];
    });
  }
  if (app) await app.close();
});

/**
 * We cannot intercept `window.api.guardrailsRespond` directly because Electron's
 * contextBridge freezes the exposed object. Instead we wrap the hook's
 * showConfirmRequest with a surrogate api whose `guardrailsRespond` pushes
 * to a page-global array we can read back with page.evaluate.
 */
// The spy mutates the shared window.guardrailsModal hook; tests within this
// spec file run serial (Playwright default, no test.describe.parallel). The
// afterAll hook below restores the original function so re-running the spec
// against the same Electron session stays clean.
async function installResponseSpy(page) {
  await page.evaluate(() => {
    if (window.__grSpyInstalled) return;
    window.__grResponses = [];
    const hook = window.guardrailsModal;
    if (!hook || typeof hook.showConfirmRequest !== 'function') return;
    const orig = hook.showConfirmRequest;
    window.__grOriginalShowConfirmRequest = orig;
    hook.showConfirmRequest = (api, root, req) => {
      // Build a plain surrogate object (no Proxy) — Electron main-world
      // objects can still reference frozen contextBridge methods while
      // adding our own on top.
      const surrogate = {
        guardrailsRespond: (payload) => {
          window.__grResponses.push(payload);
          try {
            return api.guardrailsRespond(payload);
          } catch {
            /* main has no pending entry for synthesised requestIds */
          }
        },
      };
      return orig.call(hook, surrogate, root, req);
    };
    window.__grSpyInstalled = true;
  });
}

async function fireConfirmRequest(page, req) {
  await page.evaluate((r) => {
    const root = document.getElementById('guardrails-modal-root');
    const hook = window.guardrailsModal;
    if (!hook || typeof hook.showConfirmRequest !== 'function') {
      throw new Error('guardrailsModal test hook not available');
    }
    hook.showConfirmRequest(window.api, root, r);
  }, req);
}

test.describe('Guardrails modal', () => {
  test('modal is initially hidden', async () => {
    const hidden = await window.evaluate(() =>
      document.getElementById('guardrails-modal-root')?.classList.contains('gr-modal-hidden'),
    );
    expect(hidden).toBe(true);
  });

  test('modal shows when confirm-request fires', async () => {
    await installResponseSpy(window);
    await fireConfirmRequest(window, {
      requestId: 'r1',
      slotId: 's1',
      timestamp: Date.now(),
      match: {
        ruleId: 'bulk-delete',
        description: 'Deleting 12 nodes (threshold: 5)',
        toolName: 'figma_delete',
        affectedLabel: '12 nodes',
      },
    });
    await window.waitForSelector('.gr-modal', { timeout: 2000 });
    const visible = await window.evaluate(
      () => !document.getElementById('guardrails-modal-root')?.classList.contains('gr-modal-hidden'),
    );
    expect(visible).toBe(true);

    const ruleText = await window.textContent('.gr-modal-rule');
    expect(ruleText).toContain('bulk-delete');
    const affectedText = await window.textContent('.gr-modal-affected');
    expect(affectedText).toContain('12 nodes');

    await window.click('.gr-btn-block');
    await window.waitForFunction(() =>
      document.getElementById('guardrails-modal-root')?.classList.contains('gr-modal-hidden'),
    );
  });

  test('Block button responds with block decision and hides modal', async () => {
    await installResponseSpy(window);
    const hookState = await window.evaluate(() => ({
      hasHook: typeof window.guardrailsModal?.showConfirmRequest === 'function',
      spied: !!window.__grSpyInstalled,
      responsesPreCall: (window.__grResponses || []).length,
    }));
    expect(hookState.hasHook).toBe(true);
    expect(hookState.spied).toBe(true);

    await fireConfirmRequest(window, {
      requestId: 'r2',
      slotId: 's1',
      timestamp: Date.now(),
      match: { ruleId: 'bulk-delete', description: 'x', toolName: 'figma_delete', affectedLabel: '10' },
    });
    await window.waitForSelector('.gr-btn-block');
    await window.click('.gr-btn-block');

    await window.waitForFunction(() =>
      document.getElementById('guardrails-modal-root')?.classList.contains('gr-modal-hidden'),
    );

    const calls = await window.evaluate(() => window.__grResponses || []);
    const myCall = calls.find((c) => c.requestId === 'r2');
    expect(myCall).toEqual({ requestId: 'r2', decision: 'block' });
  });

  test('Allow once button responds with allow-once decision', async () => {
    await installResponseSpy(window);
    await fireConfirmRequest(window, {
      requestId: 'r3',
      slotId: 's1',
      timestamp: Date.now(),
      match: {
        ruleId: 'detach-main-instance',
        description: 'detach',
        toolName: 'figma_execute',
        affectedLabel: 'instance',
      },
    });
    await window.waitForSelector('.gr-btn-allow');
    await window.click('.gr-btn-allow');

    await window.waitForFunction(() =>
      document.getElementById('guardrails-modal-root')?.classList.contains('gr-modal-hidden'),
    );

    const calls = await window.evaluate(() => window.__grResponses || []);
    const myCall = calls.find((c) => c.requestId === 'r3');
    expect(myCall).toEqual({ requestId: 'r3', decision: 'allow-once' });
  });

  test('IPC response handler silently drops unknown requestId (fail-closed surface)', async () => {
    // Timeout fail-closed itself is unit-tested in confirm-bus.test.ts (real
    // 10s clock mocked). Here we cover the sibling silent-drop path: sending
    // a response with an unknown requestId must NOT throw and must NOT leak
    // state. If the handler blows up, subsequent real confirms would hang.
    const result = await window.evaluate(async () =>
      window.api
        .guardrailsRespond({ requestId: 'nonexistent-' + Date.now(), decision: 'block' })
        .then(() => 'ok')
        .catch((err) => `throw:${err?.message}`),
    );
    expect(result).toBe('ok');
  });

  test('Settings toggle reflects current state via IPC', async () => {
    // Read current guardrails settings through the exposed IPC handler.
    const initial = await window.evaluate(() => window.api.getGuardrailsSettings());
    expect(typeof initial.enabled).toBe('boolean');

    // Flip it off, confirm persistence, flip back on.
    const offRes = await window.evaluate(() => window.api.setGuardrailsSettings({ enabled: false }));
    expect(offRes.success).toBe(true);
    const afterOff = await window.evaluate(() => window.api.getGuardrailsSettings());
    expect(afterOff.enabled).toBe(false);

    const onRes = await window.evaluate(() => window.api.setGuardrailsSettings({ enabled: true }));
    expect(onRes.success).toBe(true);
    const afterOn = await window.evaluate(() => window.api.getGuardrailsSettings());
    expect(afterOn.enabled).toBe(true);
  });

  test('XSS: HTML-like strings rendered as text, not markup', async () => {
    await installResponseSpy(window);
    let pageErrored = false;
    window.on('pageerror', () => {
      pageErrored = true;
    });
    await fireConfirmRequest(window, {
      requestId: 'r4',
      slotId: 's1',
      timestamp: Date.now(),
      match: {
        ruleId: '<script>alert("xss")</script>',
        description: '<img src=x onerror=alert(1)>',
        toolName: 'figma_delete',
        affectedLabel: '<b>bold</b>',
      },
    });
    await window.waitForSelector('.gr-modal');

    const scriptCount = await window.evaluate(
      () => document.getElementById('guardrails-modal-root')?.querySelectorAll('script').length ?? 0,
    );
    expect(scriptCount).toBe(0);
    const imgCount = await window.evaluate(
      () => document.getElementById('guardrails-modal-root')?.querySelectorAll('img').length ?? 0,
    );
    expect(imgCount).toBe(0);
    const boldCount = await window.evaluate(
      () => document.getElementById('guardrails-modal-root')?.querySelectorAll('b').length ?? 0,
    );
    expect(boldCount).toBe(0);

    const text = await window.textContent('#guardrails-modal-root');
    expect(text).toContain('<script>alert("xss")</script>');
    expect(text).toContain('<b>bold</b>');

    await window.click('.gr-btn-block');
    await window.waitForFunction(() =>
      document.getElementById('guardrails-modal-root')?.classList.contains('gr-modal-hidden'),
    );
    expect(pageErrored).toBe(false);
  });
});
