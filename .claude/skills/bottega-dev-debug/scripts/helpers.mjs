#!/usr/bin/env node
/**
 * Bottega Test Helpers — reusable Playwright functions for real-user testing.
 *
 * Usage: import { launchBottega, sendPromptAndWait, getAppState, ... } from './helpers.mjs'
 *
 * These helpers launch the app in REAL mode by default (not test mode),
 * enabling actual agent responses, Figma connections, and tool execution.
 */

import { _electron as electron, chromium } from '@playwright/test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_DIR = process.env.BOTTEGA_PROJECT_DIR || '/Users/afato/Projects/bottega';

// ── Singleton lock cleanup ──────────────────────
export function clearSingletonLocks() {
  const appSupport = join(process.env.HOME, 'Library/Application Support/Electron');
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const p = join(appSupport, f);
    try { if (existsSync(p)) unlinkSync(p); } catch {}
  }
}

// ── Launch ──────────────────────────────────────

/**
 * Launch Bottega via Playwright Electron.
 * Default: REAL mode (no test mode) — connects to Figma, uses real agent.
 *
 * @param {Object} opts
 * @param {boolean} opts.testMode - Use BOTTEGA_TEST_MODE=1 (stub agent). Default: false
 * @param {number} opts.timeout - Launch timeout ms. Default: 30000
 * @param {number} opts.settleMs - Wait after load for WS/slots to settle. Default: 3000
 * @returns {{ app, page }} Playwright electron app + first window page
 */
export async function launchBottega({ testMode = false, timeout = 30_000, settleMs = 3000 } = {}) {
  clearSingletonLocks();

  const env = { ...process.env };
  if (testMode) env.BOTTEGA_TEST_MODE = '1';
  // Skip restore to start with clean state if desired
  // env.BOTTEGA_SKIP_RESTORE = '1';

  const app = await electron.launch({
    args: [join(PROJECT_DIR, 'dist/main.js')],
    cwd: PROJECT_DIR,
    timeout,
    env,
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(settleMs);

  return { app, page };
}

/**
 * Attach to an already-running Bottega via CDP (Chrome DevTools Protocol).
 * Requires Bottega launched with --remote-debugging-port=9222.
 * Reuses the existing authenticated session — no auth re-negotiation.
 *
 * @param {Object} opts
 * @param {number} opts.cdpPort - CDP port. Default: 9222
 * @param {number} opts.settleMs - Wait for page stability. Default: 2000
 * @returns {{ browser, page }} Playwright browser + main renderer page
 */
export async function reuseBottega({ cdpPort = 9222, settleMs = 2000 } = {}) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error('No browser contexts found via CDP');
  const pages = contexts[0].pages();
  // Find the main renderer page (index.html), skip DevTools or blank pages
  const page = pages.find(p => p.url().includes('index.html')) || pages[0];
  if (!page) throw new Error('No pages found via CDP');
  await page.waitForTimeout(settleMs);
  return { browser, page, app: null };
}

// ── App State ───────────────────────────────────

/**
 * Get comprehensive app state — tabs, messages, streaming, context, errors.
 */
export async function getAppState(page) {
  return page.evaluate(() => {
    const activeTab = typeof getActiveTab === 'function' ? getActiveTab() : null;
    return {
      tabs: Array.from(document.querySelectorAll('.tab-item')).map(t => ({
        label: t.querySelector('.tab-label')?.textContent?.trim(),
        active: t.classList.contains('active'),
        connected: t.querySelector('.tab-dot')?.classList.contains('connected'),
        slotId: t.dataset.slotId,
      })),
      activeTab: activeTab ? {
        id: activeTab.id,
        fileName: activeTab.fileName,
        isStreaming: activeTab.isStreaming,
      } : null,
      messages: {
        total: document.querySelectorAll('.message').length,
        user: document.querySelectorAll('.user-message').length,
        assistant: document.querySelectorAll('.assistant-message').length,
      },
      toolCards: Array.from(document.querySelectorAll('.tool-card')).map(tc => ({
        name: tc.querySelector('.tool-name')?.textContent?.trim(),
        status: tc.querySelector('.tool-status')?.textContent?.trim(),
      })),
      screenshotCount: document.querySelectorAll('.screenshot').length,
      context: document.getElementById('context-label')?.textContent?.trim(),
      connectionStatus: document.getElementById('status-dot')?.classList.contains('connected') ? 'connected' : 'disconnected',
      input: {
        value: document.getElementById('input-field')?.value,
        placeholder: document.getElementById('input-field')?.placeholder,
        disabled: document.getElementById('input-field')?.disabled,
      },
      toolbar: {
        model: document.getElementById('bar-model-label')?.textContent?.trim(),
        effort: document.getElementById('bar-effort-label')?.textContent?.trim(),
        judge: document.getElementById('bar-judge-label')?.textContent?.trim(),
        judgeActive: document.getElementById('bar-judge-btn')?.classList.contains('active'),
      },
      queue: {
        visible: !document.getElementById('prompt-queue')?.classList.contains('hidden'),
        count: document.querySelectorAll('.queue-item')?.length,
      },
      suggestions: {
        visible: !document.getElementById('suggestions')?.classList.contains('hidden'),
      },
      taskPanel: {
        visible: !document.getElementById('task-panel')?.classList.contains('hidden'),
      },
      settings: {
        open: (() => {
          const overlay = document.getElementById('settings-overlay');
          return overlay ? !overlay.classList.contains('hidden') : false;
        })(),
      },
      errors: Array.from(document.querySelectorAll('.error-toast, [class*=error-message]'))
        .map(e => e.textContent?.trim()).filter(Boolean),
    };
  });
}

/**
 * Get the last assistant message content.
 */
export async function getLastAssistantMessage(page, maxLength = 500) {
  return page.evaluate((max) => {
    const msgs = document.querySelectorAll('.assistant-message');
    const last = msgs[msgs.length - 1];
    if (!last) return null;
    return {
      text: last.querySelector('.message-content')?.textContent?.substring(0, max),
      toolCards: Array.from(last.querySelectorAll('.tool-card')).map(tc => ({
        name: tc.querySelector('.tool-name')?.textContent?.trim(),
        status: tc.querySelector('.tool-status')?.textContent?.trim(),
      })),
      hasScreenshot: last.querySelector('.screenshot') !== null,
    };
  }, maxLength);
}

// ── Prompt Interaction ──────────────────────────

/**
 * Send a prompt and wait for the agent to finish responding.
 *
 * @param {Page} page - Playwright page
 * @param {string} text - Prompt text
 * @param {Object} opts
 * @param {number} opts.timeout - Max wait for response in ms. Default: 60000
 * @param {number} opts.pollInterval - Check interval in ms. Default: 1000
 * @returns {Object} { success, messagesBefore, messagesAfter, lastMessage, durationMs }
 */
export async function sendPromptAndWait(page, text, { timeout = 60_000, pollInterval = 1000 } = {}) {
  const before = await page.evaluate(() => document.querySelectorAll('.message').length);
  const start = Date.now();

  // Set input and call sendMessage()
  await page.evaluate((prompt) => {
    // eslint-disable-next-line no-undef
    inputField.value = prompt;
    // eslint-disable-next-line no-undef
    sendMessage();
  }, text);

  // Wait for streaming to start (user message appears)
  await page.waitForTimeout(500);

  // Poll until streaming ends
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const streaming = await page.evaluate(() => {
      const tab = typeof getActiveTab === 'function' ? getActiveTab() : null;
      return tab?.isStreaming ?? false;
    });
    if (!streaming) break;
    await page.waitForTimeout(pollInterval);
  }

  // Additional settle time for judge / suggestions
  await page.waitForTimeout(2000);

  const after = await page.evaluate(() => document.querySelectorAll('.message').length);
  const durationMs = Date.now() - start;
  const lastMessage = await getLastAssistantMessage(page);
  const isTimedOut = after === before;

  return {
    success: !isTimedOut && lastMessage !== null,
    timedOut: isTimedOut,
    messagesBefore: before,
    messagesAfter: after,
    lastMessage,
    durationMs,
  };
}

/**
 * Send a prompt but don't wait — useful for testing abort and queue.
 */
export async function sendPromptNoWait(page, text) {
  const before = await page.evaluate(() => document.querySelectorAll('.message').length);
  await page.evaluate((prompt) => {
    // eslint-disable-next-line no-undef
    inputField.value = prompt;
    // eslint-disable-next-line no-undef
    sendMessage();
  }, text);
  await page.waitForTimeout(300);
  return { messagesBefore: before };
}

/**
 * Wait for streaming to reach a specific state.
 */
export async function waitForStreaming(page, expectedState, { timeout = 10_000 } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const streaming = await page.evaluate(() => {
      const tab = typeof getActiveTab === 'function' ? getActiveTab() : null;
      return tab?.isStreaming ?? false;
    });
    if (streaming === expectedState) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

/**
 * Abort the current agent operation.
 */
export async function abortAgent(page) {
  return page.evaluate(() => {
    const tab = typeof getActiveTab === 'function' ? getActiveTab() : null;
    if (!tab) return { error: 'no active tab' };
    return window.api.abort(tab.id)
      .then(() => ({ success: true }))
      .catch(e => ({ error: e.message }));
  });
}

// ── Tab Management ──────────────────────────────

/**
 * Switch to a tab by slot ID or index (0-based).
 */
export async function switchTab(page, slotIdOrIndex) {
  return page.evaluate((target) => {
    const tabs = document.querySelectorAll('.tab-item');
    let tab;
    if (typeof target === 'number') {
      tab = tabs[target];
    } else {
      tab = document.querySelector(`[data-slot-id="${target}"]`);
    }
    if (!tab) return { error: 'tab not found', target };
    tab.click();
    return { switched: true, label: tab.querySelector('.tab-label')?.textContent?.trim() };
  }, slotIdOrIndex);
}

/**
 * Reset the current session (New Chat).
 */
export async function resetSession(page) {
  await page.evaluate(() => {
    document.getElementById('reset-session-btn')?.click();
  });
  await page.waitForTimeout(1000);
}

// ── Settings ────────────────────────────────────

/**
 * Open the settings panel.
 */
export async function openSettings(page) {
  await page.evaluate(() => document.getElementById('settings-btn').click());
  await page.waitForTimeout(300);
}

/**
 * Close the settings panel.
 */
export async function closeSettings(page) {
  await page.evaluate(() => document.getElementById('settings-close')?.click());
  await page.waitForTimeout(300);
}

/**
 * Get all settings values.
 */
export async function getSettingsState(page) {
  return page.evaluate(() => {
    return {
      model: document.getElementById('model-select')?.value,
      compressionProfile: document.getElementById('compression-profile-select')?.value,
      subagentsEnabled: (() => {
        const toggles = document.querySelectorAll('.setting-group input[type=checkbox]');
        const t = Array.from(toggles).find(t => {
          const g = t.closest('.setting-group');
          return g?.querySelector('.setting-label')?.textContent?.includes('Subagent');
        });
        return t?.checked ?? null;
      })(),
      diagnosticsEnabled: (() => {
        const toggles = document.querySelectorAll('.setting-group input[type=checkbox]');
        const t = Array.from(toggles).find(t => {
          const g = t.closest('.setting-group');
          return g?.querySelector('.setting-label')?.textContent?.includes('Diagnostics');
        });
        return t?.checked ?? null;
      })(),
      modelOptions: (() => {
        const sel = document.getElementById('model-select');
        return sel ? Array.from(sel.options).map(o => ({ label: o.textContent, value: o.value })) : [];
      })(),
    };
  });
}

/**
 * Change the model via the settings select.
 * Settings panel must be open.
 */
export async function changeModel(page, modelValue) {
  return page.evaluate((val) => {
    const sel = document.getElementById('model-select');
    if (!sel) return { error: 'model-select not found' };
    sel.value = val;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { changed: true, value: sel.value };
  }, modelValue);
}

// ── Screenshots ─────────────────────────────────

/**
 * Take a full page screenshot.
 */
export async function takeScreenshot(page, path = '/tmp/bottega-screenshot.png') {
  await page.screenshot({ path });
  return path;
}

/**
 * Take a screenshot of a specific element.
 */
export async function takeElementScreenshot(page, selector, path) {
  const el = page.locator(selector);
  await el.screenshot({ path });
  return path;
}

// ── Figma Canvas ──────────────────────────────

/**
 * Create a fresh Figma page and switch to it (canvas cleanup between QA runs).
 * Uses the agent's figma_execute tool to create a new page in Figma.
 * This consumes one agent turn but is the only reliable path without
 * modifying src/main/ (no direct IPC route to sendCommand).
 */
export async function clearFigmaPage(page, name) {
  const code = `
    const p = figma.createPage();
    p.name = "${name.replace(/"/g, '\\"')}";
    await figma.setCurrentPageAsync(p);
    return { pageId: p.id, pageName: p.name };
  `;
  return sendPromptAndWait(page,
    `Use figma_execute to run this code (no explanation needed, just run it):\n\`\`\`\n${code}\n\`\`\``,
    { timeout: 20_000 },
  );
}

// ── Assertions ──────────────────────────────────

/**
 * Run a set of checks and return pass/fail results.
 * Each check is { name: string, fn: async (page) => boolean }
 */
export async function runChecks(page, checks) {
  const results = [];
  for (const check of checks) {
    try {
      const passed = await check.fn(page);
      results.push({ name: check.name, passed, error: null });
    } catch (e) {
      results.push({ name: check.name, passed: false, error: e.message });
    }
  }
  return {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
  };
}

/**
 * Format check results as a readable report.
 */
export function formatCheckResults(scenarioName, results) {
  const lines = [`\n=== ${scenarioName} ===`, `${results.passed}/${results.total} passed\n`];
  for (const r of results.results) {
    const icon = r.passed ? '  PASS' : '  FAIL';
    lines.push(`${icon}  ${r.name}${r.error ? ` — ${r.error}` : ''}`);
  }
  return lines.join('\n');
}

// ── Fase 7.1C — Model & Judge helpers ──────────

/** Model ID → provider mapping (mirrors qa-runner.mjs MODEL_PROVIDERS) */
const MODEL_PROVIDERS = {
  'claude-opus-4-6': 'anthropic',
  'claude-sonnet-4-6': 'anthropic',
  'gpt-5.4': 'openai',
  'gpt-5.4-mini': 'openai',
  'gpt-5.4-nano': 'openai',
  'gemini-3-flash': 'google',
  'gemini-3.1-pro': 'google',
  'gemini-3.1-flash-lite': 'google',
};

/**
 * Switch the active tab's model by ID (e.g. 'gpt-5.4-mini').
 * Resolves the provider automatically from MODEL_PROVIDERS.
 * @param {Page} page
 * @param {string} modelId
 */
export async function switchModelById(page, modelId) {
  const provider = MODEL_PROVIDERS[modelId];
  if (!provider) throw new Error(`switchModelById: unknown model "${modelId}"`);
  const slotId = await page.evaluate(() => {
    const tab = typeof getActiveTab === 'function' ? getActiveTab() : null;
    return tab?.id;
  });
  if (!slotId) throw new Error('switchModelById: no active tab');
  await page.evaluate(
    ([id, p, m]) => window.api.switchModel(id, { provider: p, modelId: m }),
    [slotId, provider, modelId],
  );
  await page.waitForTimeout(2000);
}

/**
 * Set the judge mode (auto/off).
 * @param {Page} page
 * @param {'auto'|'off'} mode
 */
export async function setJudgeMode(page, mode) {
  await page.evaluate((m) => window.api.setSubagentConfig({ judgeMode: m }), mode);
  await page.waitForTimeout(300);
}
