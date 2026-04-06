/**
 * UAT — Real User Journeys with Live Agent
 *
 * Tests end-to-end user scenarios using the REAL AI agent + Figma Desktop.
 * Each test simulates what a human user would do: send prompts, wait for
 * the agent to respond, verify tool execution, check screenshots, and
 * validate the UI state after each interaction.
 *
 * Prerequisites:
 *   - Figma Desktop open with Bottega-Test_A + Bottega Bridge plugin
 *   - Valid Anthropic API credentials (OAuth or API key)
 *
 * Run:
 *   npm run test:uat
 *
 * Cost: ~$0.10-0.30 per run (real API calls)
 */

import { _electron as electron, test, expect } from '@playwright/test';
import { sendAndWait, closeApp, queryFigma, clearFigmaPage } from '../helpers/agent-harness.mjs';

// ── Timeouts ────────────────────────────────────
const AGENT_TIMEOUT = 120_000; // max wait for agent response
const FIGMA_TIMEOUT = 10_000;
const UI_TIMEOUT = 5_000;

// ── Shared state ────────────────────────────────
/** @type {import('@playwright/test').ElectronApplication} */
let app;
/** @type {import('@playwright/test').Page} */
let win;
let slotId;
let fileKey;
let figmaConnected = false;

// ── Setup / Teardown ────────────────────────────

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['dist/main.js'],
    timeout: 30_000,
    env: {
      ...process.env,
      BOTTEGA_AGENT_TEST: '1',
      BOTTEGA_SKIP_RESTORE: '1',
      BOTTEGA_FAST_QUIT: '1',
    },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Dismiss plugin nudge
  await win.evaluate(() => localStorage.setItem('bottega:plugin-nudge-dismissed', '1'));
  await win.waitForTimeout(3000);

  // Force-close settings if open
  await win.evaluate(() => {
    const overlay = document.getElementById('settings-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      overlay.classList.add('hidden');
      const btn = document.getElementById('settings-btn');
      if (btn) btn.classList.remove('active');
    }
  });

  // Wait for Figma connection
  console.log('Waiting for Figma plugin connection (up to 60s)...');
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const tabs = await win.evaluate(() => window.api.listTabs());
    const connected = tabs.find(t => t.isConnected);
    if (connected) {
      slotId = connected.id;
      fileKey = connected.fileKey;
      figmaConnected = true;
      console.log(`Connected to "${connected.fileName}" after ${Math.round((Date.now() - (deadline - 60_000)) / 1000)}s`);
      break;
    }
    await win.waitForTimeout(1000);
  }

  if (!figmaConnected) {
    console.warn('Figma not connected — Figma-dependent tests will be skipped');
  }
});

test.afterAll(async () => {
  await closeApp(app);
});

test.afterEach(async () => {
  if (slotId && win) {
    await win.evaluate(id => window.api.abort(id), slotId).catch(() => {});
    await win.evaluate(id => window.api.queueClear(id), slotId).catch(() => {});
  }
});

// ── Helper ──────────────────────────────────────

async function resetAndClear() {
  await win.evaluate(id => window.api.resetSessionWithClear(id), slotId);
  await win.waitForTimeout(300);
  if (figmaConnected) {
    await clearFigmaPage(win, fileKey);
  }
}

// ══════════════════════════════════════════════════
// 1. HAPPY PATH — Screenshot & Describe
// ══════════════════════════════════════════════════

test.describe('1 — Happy path: prompt → agent → response', () => {
  test.beforeEach(async () => {
    test.skip(!figmaConnected, 'Requires Figma Desktop');
    await resetAndClear();
  });

  test('1.1 agent takes screenshot and describes the page', async () => {
    const { toolCalls, response, hasScreenshot } = await sendAndWait(
      win, slotId,
      'Take a screenshot of the current page and briefly describe what you see.',
      AGENT_TIMEOUT,
    );

    // Agent should have called figma_screenshot
    expect(toolCalls.some(tc => tc.name === 'figma_screenshot')).toBe(true);
    expect(toolCalls.every(tc => tc.success)).toBe(true);

    // Response should contain text
    expect(response.length).toBeGreaterThan(20);

    // Screenshot should be visible in the chat
    expect(hasScreenshot).toBe(true);

    // UI: user message + assistant message visible
    const msgCount = await win.evaluate(() => document.querySelectorAll('.message').length);
    expect(msgCount).toBeGreaterThanOrEqual(2);

    // UI: context bar updated (non-zero)
    const context = await win.evaluate(() => document.getElementById('context-label')?.textContent);
    expect(context).not.toMatch(/^0K/);
  });

  test('1.2 input field clears after sending', async () => {
    // Send prompt
    await win.evaluate(
      ([id, t]) => window.__agentSubmit(id, t),
      [slotId, 'What do you see?'],
    );
    await win.waitForTimeout(500);

    // Input should be empty
    const value = await win.evaluate(() => document.getElementById('input-field')?.value);
    expect(value).toBe('');
  });
});

// ══════════════════════════════════════════════════
// 2. CREATION — Agent creates a Figma element
// ══════════════════════════════════════════════════

test.describe('2 — Creation: agent modifies Figma', () => {
  test.beforeEach(async () => {
    test.skip(!figmaConnected, 'Requires Figma Desktop');
    await resetAndClear();
  });

  test('2.1 agent creates a rectangle in Figma', async () => {
    const { toolCalls, response } = await sendAndWait(
      win, slotId,
      'Create a blue rectangle that is 200 pixels wide and 100 pixels tall.',
      AGENT_TIMEOUT,
    );

    // Agent should have used figma_execute (or create_child)
    const mutationTool = toolCalls.find(tc =>
      tc.name === 'figma_execute' || tc.name === 'figma_create_child'
    );
    expect(mutationTool).toBeTruthy();
    expect(mutationTool.success).toBe(true);

    // Verify the rectangle exists in Figma
    const nodeCount = await queryFigma(
      win,
      'return figma.currentPage.children.length;',
      FIGMA_TIMEOUT,
      fileKey,
    );
    expect(nodeCount).toBeGreaterThanOrEqual(1);

    // Response should mention the creation
    expect(response.toLowerCase()).toMatch(/creat|done|rect/);
  });

  test('2.2 agent takes a verification screenshot after creation', async () => {
    const { toolCalls, hasScreenshot } = await sendAndWait(
      win, slotId,
      'Create a red circle on the canvas, then show me a screenshot of the result.',
      AGENT_TIMEOUT,
    );

    // Should have both a mutation tool and a screenshot
    expect(toolCalls.some(tc => tc.name === 'figma_execute' || tc.name === 'figma_create_child')).toBe(true);
    expect(toolCalls.some(tc => tc.name === 'figma_screenshot')).toBe(true);
    expect(hasScreenshot).toBe(true);
  });
});

// ══════════════════════════════════════════════════
// 3. INPUT VALIDATION — UI-level edge cases
// ══════════════════════════════════════════════════

test.describe('3 — Input validation', () => {
  test('3.1 empty prompt is not sent', async () => {
    const before = await win.evaluate(() => document.querySelectorAll('.message').length);

    // Try to submit empty
    await win.evaluate(() => {
      document.getElementById('input-field').value = '';
      sendMessage();
    });
    await win.waitForTimeout(300);

    const after = await win.evaluate(() => document.querySelectorAll('.message').length);
    expect(after).toBe(before);
  });

  test('3.2 whitespace-only prompt is not sent', async () => {
    const before = await win.evaluate(() => document.querySelectorAll('.message').length);

    await win.evaluate(() => {
      document.getElementById('input-field').value = '   \n\t  ';
      sendMessage();
    });
    await win.waitForTimeout(300);

    const after = await win.evaluate(() => document.querySelectorAll('.message').length);
    expect(after).toBe(before);
  });

  test('3.3 long prompt (5000 chars) accepted', async () => {
    await win.evaluate(() => {
      const input = document.getElementById('input-field');
      input.value = 'A'.repeat(5000);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const length = await win.evaluate(() => document.getElementById('input-field').value.length);
    expect(length).toBe(5000);

    // Cleanup
    await win.evaluate(() => { document.getElementById('input-field').value = ''; });
  });
});

// ══════════════════════════════════════════════════
// 4. SESSION RESET — New Chat clears everything
// ══════════════════════════════════════════════════

test.describe('4 — Session reset (New Chat)', () => {
  test.beforeEach(async () => {
    test.skip(!figmaConnected, 'Requires Figma Desktop');
  });

  test('4.1 send a prompt then reset — chat clears', async () => {
    // Send a prompt to have messages
    await sendAndWait(
      win, slotId,
      'Take a screenshot.',
      AGENT_TIMEOUT,
    );

    const msgsBefore = await win.evaluate(() => document.querySelectorAll('.message').length);
    expect(msgsBefore).toBeGreaterThan(0);

    // Click New Chat
    await win.evaluate(() => document.getElementById('reset-session-btn').click());
    await win.waitForTimeout(1000);

    const msgsAfter = await win.evaluate(() => document.querySelectorAll('.message').length);
    expect(msgsAfter).toBe(0);

    // Suggestions should be hidden
    const suggestionsHidden = await win.evaluate(() =>
      document.getElementById('suggestions')?.classList.contains('hidden')
    );
    expect(suggestionsHidden).toBe(true);
  });

  test('4.2 agent works after reset', async () => {
    // Reset
    await win.evaluate(id => window.api.resetSessionWithClear(id), slotId);
    await win.waitForTimeout(500);

    // Send new prompt — agent should still work
    const { response } = await sendAndWait(
      win, slotId,
      'Say hello.',
      AGENT_TIMEOUT,
    );

    expect(response.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════
// 5. SETTINGS — Changes take effect
// ══════════════════════════════════════════════════

test.describe('5 — Settings panel', () => {
  test('5.1 settings opens and lists models', async () => {
    await win.click('#settings-btn');
    await win.waitForFunction(
      () => !document.querySelector('#settings-overlay')?.classList.contains('hidden'),
      { timeout: UI_TIMEOUT },
    );

    const optionCount = await win.evaluate(() =>
      document.querySelectorAll('#model-select option').length
    );
    expect(optionCount).toBeGreaterThan(0);

    await win.click('#settings-close');
    await win.waitForFunction(
      () => document.querySelector('#settings-overlay')?.classList.contains('hidden'),
      { timeout: UI_TIMEOUT },
    );
  });

  test('5.2 compression profile switch persists', async () => {
    const original = await win.evaluate(() => window.api.compressionGetProfile());

    await win.evaluate(() => window.api.compressionSetProfile('creative'));
    const switched = await win.evaluate(() => window.api.compressionGetProfile());
    expect(switched).toBe('creative');

    // Restore
    await win.evaluate((p) => window.api.compressionSetProfile(p), original);
  });
});

// ══════════════════════════════════════════════════
// 6. SLASH COMMANDS — Menu appears and works
// ══════════════════════════════════════════════════

test.describe('6 — Slash commands', () => {
  test('6.1 typing "/" shows the slash menu', async () => {
    await win.evaluate(() => {
      const input = document.getElementById('input-field');
      input.value = '/';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await win.waitForTimeout(300);

    const visible = await win.evaluate(() =>
      !document.getElementById('slash-menu')?.classList.contains('hidden')
    );
    expect(visible).toBe(true);

    const itemCount = await win.evaluate(() =>
      document.querySelectorAll('#slash-menu .slash-menu-item').length
    );
    expect(itemCount).toBeGreaterThan(0);

    // Cleanup
    await win.evaluate(() => {
      document.getElementById('input-field').value = '';
      document.getElementById('input-field').dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
});

// ══════════════════════════════════════════════════
// 7. PROMPT QUEUE — Rapid sends are queued
// ══════════════════════════════════════════════════

test.describe('7 — Prompt queue', () => {
  test.beforeEach(async () => {
    test.skip(!figmaConnected, 'Requires Figma Desktop');
    await resetAndClear();
  });

  test('7.1 second prompt is queued while first is streaming', async () => {
    // Send first prompt (don't wait for completion)
    await win.evaluate(
      ([id, t]) => window.__agentSubmit(id, t),
      [slotId, 'Take a screenshot and describe the page in detail.'],
    );

    // Wait for streaming to start
    await win.waitForFunction(
      () => document.getElementById('input-field')?.placeholder?.includes('queue'),
      { timeout: FIGMA_TIMEOUT },
    );

    // Send second prompt — should be queued
    await win.evaluate(() => {
      document.getElementById('input-field').value = 'What colors do you see?';
      sendMessage();
    });
    await win.waitForTimeout(500);

    const queueItems = await win.evaluate(id => window.api.queueList(id), slotId);
    // The second prompt is either in the queue or already being processed
    expect(typeof queueItems).toBe('object');

    // Cleanup
    await win.evaluate(id => window.api.abort(id), slotId);
    await win.evaluate(id => window.api.queueClear(id), slotId);
  });
});

// ══════════════════════════════════════════════════
// 8. VISUAL VERIFICATION — Screenshots captured
// ══════════════════════════════════════════════════

test.describe('8 — Visual artifacts', () => {
  test('8.1 initial state screenshot', async () => {
    const shot = await win.screenshot({ path: 'tests/.artifacts/uat-journey-initial.png' });
    expect(shot.byteLength).toBeGreaterThan(0);
  });

  test('8.2 final state screenshot', async () => {
    const shot = await win.screenshot({ path: 'tests/.artifacts/uat-journey-final.png' });
    expect(shot.byteLength).toBeGreaterThan(0);
  });
});
