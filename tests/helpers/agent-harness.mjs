/**
 * Agent Integration Test Harness
 *
 * Provides helpers for testing the real AI agent end-to-end:
 * - Launch Bottega in production mode (real API, real WS port 9280)
 * - Send prompts and wait for agent completion (IPC-based + DOM fallback)
 * - Query Figma directly via test oracle IPC channel
 * - Fuzzy assertions for LLM non-determinism
 * - Diagnostic capture on failure
 * - Shared lifecycle helper for Figma-connected tiers
 */

import { _electron as electron } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ARTIFACTS_DIR = 'tests/.artifacts/agent';

/** Wait for renderer to finish initializing IPC bridges after DOMContentLoaded. */
const POST_LOAD_SETTLE_MS = 3_000;

/** Generate a short unique suffix for node names (avoids cross-test collisions). */
export const uniqueSuffix = () => Date.now().toString(36);

/**
 * Close an Electron app with force-kill fallback.
 * Bottega's cleanup handlers can block shutdown; force-kill after 5s.
 * @param {import('@playwright/test').ElectronApplication} app
 */
export async function closeApp(app) {
  if (!app) return;
  const pid = app.process()?.pid;
  try {
    const timer = setTimeout(() => {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }, 5_000);
    await app.close();
    clearTimeout(timer);
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}

// ═══════════════════════════════════════════════════
// TIER FILTERING
// ═══════════════════════════════════════════════════

/**
 * Skip tests if BOTTEGA_AGENT_TEST_TIER is set and doesn't match this tier.
 * Call at the top of each spec file's describe block.
 *
 * @param {import('@playwright/test').TestType} test
 * @param {number} tier - This file's tier number (0-4)
 */
export function skipIfTierFiltered(test, tier) {
  const envTier = process.env.BOTTEGA_AGENT_TEST_TIER;
  if (envTier !== undefined && envTier !== '' && Number(envTier) !== tier) {
    test.skip(true, `Skipped: BOTTEGA_AGENT_TEST_TIER=${envTier}, this is tier ${tier}`);
  }
}

// ═══════════════════════════════════════════════════
// LAUNCH HELPERS
// ═══════════════════════════════════════════════════

/**
 * Shared Electron launch + initialization sequence.
 * @returns {Promise<{ app, win }>}
 */
async function _launchBase(opts = {}) {
  // Retry loop: previous tier's Electron process may still hold the single-instance lock.
  const maxRetries = 3;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const app = await electron.launch({
        args: ['dist/main.js'],
        timeout: opts.launchTimeout ?? 30_000,
        env: {
          ...process.env,
          BOTTEGA_AGENT_TEST: '1',
          // NO BOTTEGA_TEST_MODE — real port 9280, real auth
        },
      });
      const win = await app.firstWindow();
      await win.waitForLoadState('domcontentloaded');
      await win.waitForTimeout(POST_LOAD_SETTLE_MS);

      // Minimal compression for full tool results
      await win.evaluate(() => window.api.compressionSetProfile('minimal'));

      return { app, win };
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && err.message?.includes('closed')) {
        // Single-instance lock likely still held — wait and retry
        await new Promise((r) => setTimeout(r, 3_000));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/**
 * Launch Bottega in PRODUCTION mode with BOTTEGA_AGENT_TEST flag.
 * Waits for Figma Desktop plugin connection. For Tier 1-4.
 *
 * @param {object} [opts]
 * @param {number} [opts.figmaTimeout=60000] - Max ms to wait for Figma plugin
 * @param {number} [opts.launchTimeout=30000] - Electron launch timeout
 * @returns {Promise<{ app, win, slotId, fileKey, figmaConnected }>}
 */
export async function launchAgentApp(opts = {}) {
  const { app, win } = await _launchBase(opts);

  // Poll for Figma plugin connection
  const deadline = Date.now() + (opts.figmaTimeout ?? 60_000);
  let connected = false;
  let tabs;
  while (Date.now() < deadline) {
    tabs = await win.evaluate(() => window.api.listTabs());
    if (tabs.find((t) => t.isConnected)) {
      connected = true;
      break;
    }
    await win.waitForTimeout(1_000);
  }

  if (!connected) {
    return { app, win, slotId: null, fileKey: null, figmaConnected: false };
  }

  tabs = await win.evaluate(() => window.api.listTabs());
  const slot = tabs.find((t) => t.isConnected);
  return { app, win, slotId: slot.id, fileKey: slot.fileKey, figmaConnected: true };
}

/**
 * Launch Bottega for Tier 0 — no Figma needed, real auth + API.
 *
 * @param {object} [opts]
 * @param {number} [opts.launchTimeout=30000]
 * @returns {Promise<{ app, win, slotId, figmaConnected: false }>}
 */
export async function launchAgentAppNoFigma(opts = {}) {
  const { app, win } = await _launchBase(opts);

  // Get or create an unbound tab (no file)
  let tabs = await win.evaluate(() => window.api.listTabs());
  let slotId;
  if (tabs.length > 0) {
    slotId = tabs[0].id;
  } else {
    await win.evaluate(() => window.api.createTab());
    tabs = await win.evaluate(() => window.api.listTabs());
    slotId = tabs[0]?.id;
  }

  if (!slotId) {
    throw new Error('launchAgentAppNoFigma: failed to acquire a tab/slot');
  }

  return { app, win, slotId, figmaConnected: false };
}

// ═══════════════════════════════════════════════════
// SHARED LIFECYCLE (for Tier 1-4 spec files)
// ═══════════════════════════════════════════════════

/**
 * Set up the standard beforeAll/afterAll/beforeEach/afterEach lifecycle
 * for Figma-connected test tiers (1-4). Returns a shared context object
 * populated by beforeAll.
 *
 * Includes:
 * - App launch with Figma connection wait
 * - Session reset + page clear in beforeEach
 * - Abort + queue clear + diagnostic capture in afterEach
 * - Connection health ping before each test
 * - Graceful skip if Figma not connected
 *
 * @param {import('@playwright/test').TestType} test
 * @returns {{ app: any, win: any, slotId: string|null, fileKey: string|null, figmaConnected: boolean }}
 */
export function useFigmaTierLifecycle(test) {
  const ctx = { app: null, win: null, slotId: null, fileKey: null, figmaConnected: false };

  test.beforeAll(async () => {
    const result = await launchAgentApp();
    Object.assign(ctx, result);
  });

  test.afterAll(async () => {
    await closeApp(ctx.app);
  });

  test.afterEach(async ({}, testInfo) => {
    if (ctx.slotId && ctx.win) {
      await ctx.win.evaluate((id) => window.api.abort(id), ctx.slotId).catch(() => {});
      await ctx.win.evaluate((id) => window.api.queueClear(id), ctx.slotId).catch(() => {});
    }
    if (ctx.win) await captureDiagnostics(ctx.win, testInfo, ctx.fileKey);
  });

  test.beforeEach(async () => {
    test.skip(!ctx.figmaConnected, 'Figma Desktop not connected');
    // Connection health ping — skip remaining tests if Figma disconnected mid-suite
    try {
      await queryFigma(ctx.win, 'return 1;', 5_000, ctx.fileKey);
    } catch {
      ctx.figmaConnected = false;
      test.skip(true, 'Figma connection lost mid-suite');
    }
    // Clear chat DOM + JS state (currentAssistantBubble) for this specific slot.
    // NOTE: We do NOT call resetSession — it fires stale agent:end events that cause
    // race conditions with the __agentDone flag. The agent session accumulates history
    // but each prompt is self-contained and __testResetChat clears the UI.
    await ctx.win.evaluate((id) => window.__testResetChat?.(id), ctx.slotId);
    await clearFigmaPage(ctx.win, ctx.fileKey);
  });

  return ctx;
}

// ═══════════════════════════════════════════════════
// AGENT TURN HELPERS
// ═══════════════════════════════════════════════════

/**
 * Send a prompt and wait for the agent to finish responding.
 *
 * Uses IPC-based agent-end detection when available (__testWaitForAgentEnd),
 * falling back to DOM polling. Extracts tool calls from the LAST assistant
 * message only (not accumulated across turns).
 *
 * @param {import('@playwright/test').Page} win
 * @param {string} slotId
 * @param {string} prompt
 * @param {number} [timeout=160000]
 * @returns {Promise<{ toolCalls: Array<{name: string, success: boolean, error: boolean}>, response: string, hasScreenshot: boolean }>}
 */
export async function sendAndWait(win, slotId, prompt, timeout = 160_000) {
  // Switch to the correct tab — the input field submits to the active tab,
  // and handleSubmit creates the assistant bubble + user message.
  await win.evaluate((id) => window.__testSwitchTab?.(id), slotId);
  await win.waitForTimeout(300);

  // Register one-shot agent:end listener. No drain needed — resetSession is no longer
  // called in beforeEach, so there are no stale agent:end events.
  await win.evaluate((id) => {
    window.__agentDone = false;
    if (window.api.__testWaitForAgentEnd) {
      window.api.__testWaitForAgentEnd(id).then(() => { window.__agentDone = true; });
    }
  }, slotId);

  // Submit via the UI input field (not direct IPC) to trigger the full renderer
  // flow: user message div, assistant bubble creation, streaming state.
  await win.fill('#input-field', prompt);
  await win.press('#input-field', 'Enter');

  // Wait for agent:end via the boolean flag (simple poll, no IPC needed)
  await win.waitForFunction(() => window.__agentDone === true, { timeout, polling: 500 });

  // Extra settle for renderer to finish processing final IPC events
  await win.waitForTimeout(500);

  // Extract results via slot-scoped helpers (bypass active-tab DOM issues)
  const hasSlotHelpers = await win
    .evaluate(() => typeof window.__testGetToolCalls === 'function')
    .catch(() => false);

  let toolCalls, response, hasScreenshot;
  if (hasSlotHelpers) {
    toolCalls = await win.evaluate((id) => window.__testGetToolCalls(id), slotId);
    response = await win.evaluate((id) => window.__testGetResponse(id), slotId);
    hasScreenshot = await win.evaluate((id) => window.__testHasScreenshot(id), slotId);
  } else {
    toolCalls = await getToolCalls(win);
    response = await getAgentResponse(win);
    hasScreenshot = await hasScreenshotInChat(win);
  }
  return { toolCalls, response, hasScreenshot };
}

/**
 * Wait for the agent to finish responding (DOM polling fallback).
 *
 * Polls DOM for two conditions:
 * 1. No [data-testid="tab-item"].streaming (agent turn ended)
 * 2. No [data-testid="tool-spinner"] (all tool cards resolved)
 *
 * On timeout, force-aborts all slots and throws.
 */
export async function waitForAgentEnd(win, slotId, timeout = 160_000) {
  try {
    // Use IPC-based check: poll the specific slot's isStreaming flag.
    // This avoids DOM dependency on .tool-spinner which can leak from
    // restored sessions or previous test messages.
    await win.waitForFunction(
      async (id) => {
        const tabs = await window.api.listTabs();
        const slot = tabs.find((t) => t.id === id);
        return slot && !slot.isStreaming;
      },
      slotId,
      { timeout, polling: 1_000 },
    );
    // Brief settle for DOM to sync with IPC state (tool cards complete rendering)
    await win.waitForTimeout(500);
  } catch (err) {
    // Timeout — force abort and throw
    const tabs = await win.evaluate(() => window.api.listTabs()).catch(() => []);
    for (const tab of tabs) {
      await win.evaluate((id) => window.api.abort(id), tab.id).catch(() => {});
    }
    if (err?.message?.includes('Timeout') || err?.message?.includes('timeout')) {
      throw new Error(`waitForAgentEnd timed out after ${timeout}ms`);
    }
    throw err;
  }
}

// ═══════════════════════════════════════════════════
// DOM EXTRACTION
// ═══════════════════════════════════════════════════

/**
 * Extract tool call info from the LAST assistant message's tool cards.
 * Scoped to prevent cross-turn contamination in multi-turn tests.
 *
 * @returns {Promise<Array<{name: string, success: boolean, error: boolean}>>}
 */
export async function getToolCalls(win) {
  return win.evaluate(() => {
    // Scope to last assistant message to avoid cross-turn contamination
    const msgs = [
      ...document.querySelectorAll(
        '[data-testid="assistant-message"], .assistant-message',
      ),
    ];
    const lastMsg = msgs[msgs.length - 1];
    if (!lastMsg) return [];

    return [...lastMsg.querySelectorAll('[data-testid="tool-card"], .tool-card')].map(
      (card) => ({
        name:
          (card.querySelector('[data-testid="tool-name"]') || card.querySelector('.tool-name'))
            ?.textContent || '',
        success: !!(
          card.querySelector('[data-testid="tool-status"].tool-success') ||
          card.querySelector('.tool-success')
        ),
        error: !!(
          card.querySelector('[data-testid="tool-status"].tool-error') ||
          card.querySelector('.tool-error')
        ),
      }),
    );
  });
}

/**
 * Get text content of the last assistant message.
 * @returns {Promise<string>}
 */
export async function getAgentResponse(win) {
  return win.evaluate(() => {
    const msgs = [
      ...document.querySelectorAll(
        '[data-testid="assistant-message"], .assistant-message',
      ),
    ];
    if (!msgs.length) return '';
    const content =
      msgs[msgs.length - 1].querySelector('[data-testid="message-content"]') ||
      msgs[msgs.length - 1].querySelector('.message-content');
    return content?.textContent || '';
  });
}

/**
 * Check if any screenshot images are present in the chat.
 * @returns {Promise<boolean>}
 */
export async function hasScreenshotInChat(win) {
  return win.evaluate(() => {
    const count =
      document.querySelectorAll('[data-testid="screenshot"]').length ||
      document.querySelectorAll('.screenshot').length;
    return count > 0;
  });
}

// ═══════════════════════════════════════════════════
// FIGMA ORACLE (via test IPC channel)
// ═══════════════════════════════════════════════════

/**
 * Execute Plugin API code directly in Figma via the test oracle channel.
 * Requires BOTTEGA_AGENT_TEST=1 and Figma Desktop connected.
 *
 * The code runs in the Figma plugin sandbox (has access to `figma.*`).
 * Must return a serializable value.
 *
 * @param {import('@playwright/test').Page} win
 * @param {string} code - Plugin API code to execute
 * @param {number} [timeoutMs=15000]
 * @returns {Promise<any>}
 */
export async function queryFigma(win, code, timeoutMs = 15_000, fileKey = undefined) {
  const raw = await win.evaluate(([c, t, fk]) => window.api.__testFigmaExecute(c, t, fk), [
    code,
    timeoutMs,
    fileKey,
  ]);
  // Unwrap WS relay envelope: { success: true, result: <actual> }
  return raw?.result !== undefined ? raw.result : raw;
}

/**
 * Escape regex metacharacters in a string for safe interpolation.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Assert a Figma node exists matching namePattern with optional property checks.
 * Uses string.includes() for plain strings (safe) or escaped regex for RegExp.
 *
 * @param {import('@playwright/test').Page} win
 * @param {string|RegExp} namePattern - String to search (uses includes) or RegExp
 * @param {object} [expectedProps] - Property checks: { type, width, height, childCount }
 * @returns {Promise<{id: string, name: string, type: string, width: number, height: number, childCount: number}>}
 */
export async function assertFigmaNodeExists(win, namePattern, expectedProps = {}, fileKey = undefined) {
  // For plain strings, use includes() which is injection-safe.
  // For RegExp, escape the source to prevent injection.
  const isRegex = namePattern instanceof RegExp;
  const searchStr = isRegex ? escapeRegex(namePattern.source) : JSON.stringify(namePattern);
  const matchExpr = isRegex
    ? `n.name.match(new RegExp(${JSON.stringify(namePattern.source)}, 'i'))`
    : `n.name.includes(${searchStr})`;

  // NOTE: Figma plugin wraps code as (async function() { <code> })()
  // so all code must use explicit top-level return statements.
  const node = await queryFigma(
    win,
    `
    var n = figma.currentPage.findOne(function(n) { return ${matchExpr}; });
    if (!n) return null;
    return {
      id: n.id, name: n.name, type: n.type,
      width: Math.round(n.width), height: Math.round(n.height),
      childCount: 'children' in n ? n.children.length : 0,
    };
  `,
    15_000,
    fileKey,
  );

  const label = isRegex ? `/${namePattern.source}/i` : `"${namePattern}"`;

  if (!node) {
    throw new Error(`No Figma node found matching ${label}`);
  }

  for (const [key, expected] of Object.entries(expectedProps)) {
    if (node[key] !== expected) {
      throw new Error(
        `Node "${node.name}": ${key}=${JSON.stringify(node[key])}, expected ${JSON.stringify(expected)}`,
      );
    }
  }

  return node;
}

/**
 * Remove all children from the current Figma page.
 * @returns {Promise<number>} Remaining child count (should be 0)
 */
export async function clearFigmaPage(win, fileKey = undefined) {
  return queryFigma(
    win,
    `[...figma.currentPage.children].forEach(function(c) { c.remove(); });
    return figma.currentPage.children.length;`,
    15_000,
    fileKey,
  );
}

/**
 * Count children on the current Figma page.
 * @returns {Promise<number>}
 */
export async function getFigmaPageNodeCount(win, fileKey = undefined) {
  return queryFigma(win, 'return figma.currentPage.children.length;', 15_000, fileKey);
}

// ═══════════════════════════════════════════════════
// FUZZY ASSERTIONS (for LLM non-determinism)
// ═══════════════════════════════════════════════════

/**
 * Assert at least one of the named tools was called (OR logic).
 * Handles LLM non-determinism: agent may choose different tools.
 *
 * @param {Array<{name: string}>} calls
 * @param {...string} names - Tool names (any match = pass)
 */
export function assertToolCalled(calls, ...names) {
  const found = calls.some((c) => names.includes(c.name));
  if (!found) {
    const actual = calls.map((c) => c.name).join(', ');
    throw new Error(`Expected one of [${names.join(', ')}], got: [${actual}]`);
  }
}

/**
 * Assert no tool calls resulted in error.
 * @param {Array<{name: string, error: boolean}>} calls
 */
export function assertNoToolErrors(calls) {
  const errors = calls.filter((c) => c.error);
  if (errors.length) {
    throw new Error(`Tool errors: [${errors.map((c) => c.name).join(', ')}]`);
  }
}

/**
 * Assert at least one keyword is present in text (case-insensitive OR).
 *
 * @param {string} text
 * @param {string[]} keywords - Any match = pass
 */
export function assertResponseContains(text, keywords) {
  const lower = text.toLowerCase();
  if (!keywords.some((k) => lower.includes(k.toLowerCase()))) {
    throw new Error(
      `Response missing all of [${keywords.join(', ')}]. First 200ch: "${text.slice(0, 200)}"`,
    );
  }
}

/**
 * Assert app is stable: window responsive, no stack trace in response.
 * Requires both a file path pattern AND a stack keyword to reduce false positives.
 */
export async function assertAgentStable(win) {
  const title = await win.textContent('#app-title');
  if (!title?.includes('Bottega')) {
    throw new Error('Window not responsive — app-title missing');
  }
  const response = await getAgentResponse(win);
  // Require both a stack-trace indicator AND a path pattern to avoid false positives
  const hasStackTrace =
    (response.includes('at Object.<anonymous>') || response.includes('at Module._compile')) &&
    /\(\/.*\.js:\d+:\d+\)/.test(response);
  if (hasStackTrace) {
    throw new Error('Stack trace detected in agent response');
  }
}

// ═══════════════════════════════════════════════════
// DIAGNOSTIC CAPTURE (for afterEach)
// ═══════════════════════════════════════════════════

/**
 * Capture diagnostic info on test failure.
 * Call in afterEach with testInfo from Playwright.
 *
 * Captures: Playwright screenshot, tool calls JSON, agent response text,
 * console errors from renderer, and Figma page node count.
 *
 * @param {import('@playwright/test').Page} win
 * @param {import('@playwright/test').TestInfo} testInfo
 */
export async function captureDiagnostics(win, testInfo, fileKey = undefined) {
  if (testInfo.status !== 'failed') return;

  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const safeName = testInfo.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);

  // 1. Playwright screenshot
  try {
    await win.screenshot({ path: join(ARTIFACTS_DIR, `${safeName}.png`) });
  } catch (e) {
    process.stderr.write(`[diag] screenshot failed: ${e.message}\n`);
  }

  // 2. Tool calls
  try {
    const tools = await getToolCalls(win);
    testInfo.attach('tool-calls', {
      body: JSON.stringify(tools, null, 2),
      contentType: 'application/json',
    });
  } catch (e) {
    process.stderr.write(`[diag] tool-calls failed: ${e.message}\n`);
  }

  // 3. Agent response text
  try {
    const resp = await getAgentResponse(win);
    testInfo.attach('agent-response', { body: resp, contentType: 'text/plain' });
  } catch (e) {
    process.stderr.write(`[diag] agent-response failed: ${e.message}\n`);
  }

  // 4. Console errors from renderer
  try {
    const errors = await win.evaluate(() => {
      return (window.__testConsoleLogs || [])
        .filter((l) => l.level === 'error')
        .map((l) => l.text)
        .slice(-20);
    });
    if (errors.length > 0) {
      testInfo.attach('console-errors', {
        body: JSON.stringify(errors, null, 2),
        contentType: 'application/json',
      });
    }
  } catch (e) {
    process.stderr.write(`[diag] console-errors failed: ${e.message}\n`);
  }

  // 5. Figma page node count (if oracle available)
  try {
    const nodeCount = await queryFigma(win, 'return figma.currentPage.children.length;', 3_000, fileKey);
    testInfo.attach('figma-node-count', {
      body: String(nodeCount),
      contentType: 'text/plain',
    });
  } catch {
    // Oracle may not be available (Tier 0 tests)
  }
}
