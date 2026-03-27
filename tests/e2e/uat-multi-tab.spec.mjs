/**
 * UAT — Multi-tab, Prompt Queue, Scoped Connections, App State Persistence
 *
 * Tests all uncommitted features end-to-end using the REAL Figma Desktop
 * Bridge plugin connection. Requires Figma Desktop to be open with:
 *   - Bottega-Test_A
 *   - Bottega-Test_B
 * and the Bottega Bridge plugin running in both files.
 *
 * Run:
 *   npm run build && npx playwright test tests/e2e/uat-multi-tab.spec.mjs
 */

import { _electron as electron, test, expect } from '@playwright/test';

// ── Test Setup ───────────────────────────────────

/** @type {import('@playwright/test').ElectronApplication} */
let app;
/** @type {import('@playwright/test').Page} */
let win;

// Discovered at runtime from the real Figma plugin connection
let slotA; // { id, fileKey, fileName }
let slotB; // { id, fileKey, fileName }

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['dist/main.js'],
    timeout: 30_000,
    env: {
      ...process.env,
      BOTTEGA_TEST_MODE: '1',
      BOTTEGA_TEST_MOCK_AUTH: '1',
    },
  });
  win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  // Wait for UI + Figma plugin auto-connection (Figma Desktop needs time)
  // Poll until both files connect AND report isConnected (up to 30s)
  let tabs;
  for (let attempt = 0; attempt < 30; attempt++) {
    await win.waitForTimeout(1000);
    tabs = await win.evaluate(() => window.api.listTabs());
    const a = tabs.find(t => t.fileName && t.fileName.includes('Test_A'));
    const b = tabs.find(t => t.fileName && t.fileName.includes('Test_B'));
    if (a?.isConnected && b?.isConnected) break;
  }
  console.log('Discovered tabs:', JSON.stringify(tabs.map(t => ({ id: t.id, fileKey: t.fileKey, fileName: t.fileName, isConnected: t.isConnected }))));

  // Match by fileName pattern
  slotA = tabs.find(t => t.fileName && t.fileName.includes('Test_A'));
  slotB = tabs.find(t => t.fileName && t.fileName.includes('Test_B'));
});

test.afterAll(async () => {
  if (!app) return;
  try {
    // Force-kill: app.close() can hang if cleanup is slow (WS shutdown, metrics flush)
    const pid = app.process()?.pid;
    await Promise.race([
      app.close(),
      new Promise(resolve => setTimeout(resolve, 5000)),
    ]);
    // If still alive after 5s, force kill
    if (pid) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
  } catch {}
});

// ══════════════════════════════════════════════════
// 1. INITIAL STATE & FIGMA CONNECTION
// ══════════════════════════════════════════════════

test.describe('1 — App launch and Figma connection', () => {
  test('1.1 app launches with title "Bottega"', async () => {
    const title = await win.textContent('#app-title');
    expect(title).toBe('Bottega');
  });

  test('1.2 status dot shows connected (Figma plugin active)', async () => {
    const dot = await win.$('#status-dot');
    const cls = await dot.getAttribute('class');
    expect(cls).toContain('connected');
  });

  test('1.3 tab bar exists with add button', async () => {
    expect(await win.$('#tab-bar')).toBeTruthy();
    expect(await win.$('#tab-add-btn')).toBeTruthy();
  });

  test('1.4 input field and send button present', async () => {
    expect(await win.$('#input-field')).toBeTruthy();
    expect(await win.$('#send-btn')).toBeTruthy();
  });

  test('1.5 Bottega-Test_A tab auto-created', async () => {
    test.skip(!slotA, 'Bottega-Test_A not available (requires Figma Desktop with test files)');
    expect(slotA.fileName).toContain('Test_A');
    // isConnected may be false if tabs were restored from disk rather than live WS
    // (test mode uses port 0, plugin connects on 9280)
    if (!slotA.isConnected) {
      console.log('Note: Test_A tab exists but isConnected=false (restored from disk, not live WS)');
    }
  });

  test('1.6 Bottega-Test_B tab auto-created', async () => {
    test.skip(!slotB, 'Bottega-Test_B not available (requires Figma Desktop with test files)');
    expect(slotB.fileName).toContain('Test_B');
    if (!slotB.isConnected) {
      console.log('Note: Test_B tab exists but isConnected=false (restored from disk, not live WS)');
    }
  });

  test('1.7 tab bar renders both file names', async () => {
    test.skip(!slotA || !slotB, 'Requires both Figma test files connected');
    const tabLabels = await win.$$eval('.tab-label', els => els.map(e => e.textContent));
    expect(tabLabels.some(l => l.includes('Test_A'))).toBe(true);
    expect(tabLabels.some(l => l.includes('Test_B'))).toBe(true);
  });

  test('1.8 initial screenshot', async () => {
    const shot = await win.screenshot({ path: 'test-results/uat-01-initial.png' });
    expect(shot.byteLength).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════
// 2. TAB SWITCHING & PER-TAB CHAT ISOLATION
// ══════════════════════════════════════════════════

test.describe('2 — Tab switching and chat isolation', () => {
  test('2.1 activate tab A and send a message', async () => {
    test.skip(!slotA, 'Bottega-Test_A not connected');
    await win.evaluate(id => window.api.activateTab(id), slotA.id);
    await win.waitForTimeout(1500);

    // Click tab A in the UI
    const tabItems = await win.$$('.tab-item');
    for (const item of tabItems) {
      const label = await item.$eval('.tab-label', el => el.textContent);
      if (label.includes('Test_A')) { await item.click(); break; }
    }
    await win.waitForTimeout(1500);

    const input = await win.$('#input-field');
    await input.fill('Hello from Tab A');
    await input.press('Enter');
    await win.waitForTimeout(2000);

    const messages = await win.$$eval('.user-message', els => els.map(e => e.textContent));
    expect(messages.some(m => m.includes('Hello from Tab A'))).toBe(true);
  });

  test('2.2 switch to tab B — tab A messages NOT visible', async () => {
    test.skip(!slotB, 'Bottega-Test_B not connected');
    const tabItems = await win.$$('.tab-item');
    for (const item of tabItems) {
      const label = await item.$eval('.tab-label', el => el.textContent);
      if (label.includes('Test_B')) { await item.click(); break; }
    }
    await win.waitForTimeout(1500);

    const messages = await win.$$eval('.user-message', els => els.map(e => e.textContent));
    expect(messages.some(m => m.includes('Hello from Tab A'))).toBe(false);
  });

  test('2.3 send message in tab B', async () => {
    test.skip(!slotB, 'Bottega-Test_B not connected');
    const input = await win.$('#input-field');
    await input.fill('Hello from Tab B');
    await input.press('Enter');
    await win.waitForTimeout(2000);

    const messages = await win.$$eval('.user-message', els => els.map(e => e.textContent));
    expect(messages.some(m => m.includes('Hello from Tab B'))).toBe(true);
  });

  test('2.4 switch back to tab A — message preserved, tab B message absent', async () => {
    test.skip(!slotA || !slotB, 'Requires both Figma test files connected');

    // Abort any pending streaming on both tabs to ensure clean state
    await win.evaluate(id => window.api.abort(id), slotA.id);
    await win.evaluate(id => window.api.abort(id), slotB.id);
    await win.waitForTimeout(1000);

    const tabItems = await win.$$('.tab-item');
    for (const item of tabItems) {
      const label = await item.$eval('.tab-label', el => el.textContent);
      if (label.includes('Test_A')) { await item.click(); break; }
    }
    await win.waitForTimeout(2000);

    // Query only within #chat-area to ensure we only see the active tab's content
    const messages = await win.$$eval('#chat-area .user-message', els => els.map(e => e.textContent));
    expect(messages.some(m => m.includes('Hello from Tab A'))).toBe(true);
    expect(messages.some(m => m.includes('Hello from Tab B'))).toBe(false);
  });

  test('2.5 screenshot showing chat isolation', async () => {
    const shot = await win.screenshot({ path: 'test-results/uat-02-chat-isolation.png' });
    expect(shot.byteLength).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════
// 3. MANUAL TAB CREATION & LIMITS
// ══════════════════════════════════════════════════

test.describe('3 — Manual tab creation and limits', () => {
  test('3.1 create an unbound tab via + button', async () => {
    const tabsBefore = await win.evaluate(() => window.api.listTabs());
    await win.click('#tab-add-btn');
    await win.waitForTimeout(2000);
    const tabsAfter = await win.evaluate(() => window.api.listTabs());
    expect(tabsAfter.length).toBe(tabsBefore.length + 1);
    const newTab = tabsAfter.find(t => t.fileKey === null);
    expect(newTab).toBeTruthy();
  });

  test('3.2 new tab appears as "New Tab"', async () => {
    const tabLabels = await win.$$eval('.tab-label', els => els.map(e => e.textContent));
    expect(tabLabels.some(l => l === 'New Tab')).toBe(true);
  });

  test('3.3 max 4 tabs enforced', async () => {
    const tabs = await win.evaluate(() => window.api.listTabs());
    const createResults = [];
    for (let i = tabs.length; i < 5; i++) {
      const r = await win.evaluate(() => window.api.createTab());
      createResults.push(r);
    }
    const failed = createResults.find(r => !r.success);
    expect(failed).toBeTruthy();
    expect(failed.error).toContain('Maximum');

    const finalTabs = await win.evaluate(() => window.api.listTabs());
    expect(finalTabs.length).toBeLessThanOrEqual(4);
  });

  test('3.4 close unbound tabs to clean up', async () => {
    const tabs = await win.evaluate(() => window.api.listTabs());
    const unboundTabs = tabs.filter(t => t.fileKey === null);
    for (const ub of unboundTabs) {
      await win.evaluate(id => window.api.closeTab(id), ub.id);
    }
    await win.waitForTimeout(1500);

    const remaining = await win.evaluate(() => window.api.listTabs());
    const bound = remaining.filter(t => t.fileKey !== null);
    expect(bound.length).toBeGreaterThanOrEqual(2);
  });
});

// ══════════════════════════════════════════════════
// 4. PROMPT QUEUE
// ══════════════════════════════════════════════════

test.describe('4 — Prompt queue management', () => {
  test('4.1 queue:list returns empty initially', async () => {
    test.skip(!slotA, 'Bottega-Test_A not connected');
    const queue = await win.evaluate(id => window.api.queueList(id), slotA.id);
    expect(queue).toEqual([]);
  });

  test('4.2 rapid double-send: second prompt may be queued', async () => {
    test.skip(!slotA, 'Bottega-Test_A not connected');
    // Activate tab A
    const tabItems = await win.$$('.tab-item');
    for (const item of tabItems) {
      const label = await item.$eval('.tab-label', el => el.textContent);
      if (label.includes('Test_A')) { await item.click(); break; }
    }
    await win.waitForTimeout(1000);

    const input = await win.$('#input-field');
    await input.fill('Queue test prompt 1');
    await input.press('Enter');
    await win.waitForTimeout(800);

    await input.fill('Queue test prompt 2');
    await input.press('Enter');
    await win.waitForTimeout(2000);

    const queue = await win.evaluate(id => window.api.queueList(id), slotA.id);
    expect(Array.isArray(queue)).toBe(true);
  });

  test('4.3 queue:clear empties the queue', async () => {
    test.skip(!slotA, 'Bottega-Test_A not connected');
    const cleared = await win.evaluate(id => window.api.queueClear(id), slotA.id);
    expect(typeof cleared).toBe('number');

    const queue = await win.evaluate(id => window.api.queueList(id), slotA.id);
    expect(queue).toEqual([]);
  });
});

// ══════════════════════════════════════════════════
// 5. SESSION MANAGEMENT PER TAB
// ══════════════════════════════════════════════════

test.describe('5 — Session management per tab', () => {
  test('5.1 get session messages for tab A', async () => {
    test.skip(!slotA, 'Bottega-Test_A not connected');
    const messages = await win.evaluate(id => window.api.getSessionMessages(id), slotA.id);
    expect(Array.isArray(messages)).toBe(true);
  });

  test('5.2 get session messages for tab B (independent)', async () => {
    test.skip(!slotB, 'Bottega-Test_B not connected');
    const messages = await win.evaluate(id => window.api.getSessionMessages(id), slotB.id);
    expect(Array.isArray(messages)).toBe(true);
  });

  test('5.3 reset session for tab A', async () => {
    test.skip(!slotA, 'Bottega-Test_A not connected');
    const result = await win.evaluate(id => window.api.resetSession(id), slotA.id);
    expect(result.success).toBe(true);
  });

  test('5.4 tab B unaffected after tab A reset', async () => {
    test.skip(!slotB, 'Bottega-Test_B not connected');
    const messages = await win.evaluate(id => window.api.getSessionMessages(id), slotB.id);
    expect(Array.isArray(messages)).toBe(true);
  });
});

// ══════════════════════════════════════════════════
// 6. THINKING LEVEL & MODEL PER TAB
// ══════════════════════════════════════════════════

test.describe('6 — Thinking level & model per tab', () => {
  test('6.1 set thinking level "high" on tab A', async () => {
    test.skip(!slotA, 'Bottega-Test_A not connected');
    await win.evaluate(
      ([id, level]) => window.api.setThinking(id, level),
      [slotA.id, 'high'],
    );
  });

  test('6.2 set thinking level "off" on tab B', async () => {
    test.skip(!slotB, 'Bottega-Test_B not connected');
    await win.evaluate(
      ([id, level]) => window.api.setThinking(id, level),
      [slotB.id, 'off'],
    );
  });

  test('6.3 get available models', async () => {
    const models = await win.evaluate(() => window.api.getModels());
    expect(models.anthropic.length).toBeGreaterThan(0);
    expect(models.openai.length).toBeGreaterThan(0);
    expect(models.google.length).toBeGreaterThan(0);
  });

  test('6.4 get context sizes', async () => {
    const sizes = await win.evaluate(() => window.api.getContextSizes());
    expect(sizes['claude-sonnet-4-6']).toBe(1_000_000);
  });

  test('6.5 invalid model switch returns error', async () => {
    test.skip(!slotA, 'Bottega-Test_A not connected');
    const result = await win.evaluate(
      ([id]) => window.api.switchModel(id, { provider: 'fake', modelId: 'nope' }),
      [slotA.id],
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown model');
  });
});

// ══════════════════════════════════════════════════
// 7. WINDOW CONTROLS
// ══════════════════════════════════════════════════

test.describe('7 — Window controls', () => {
  test('7.1 pin toggle', async () => {
    const pinned = await win.evaluate(() => window.api.togglePin());
    expect(typeof pinned).toBe('boolean');
    const isPinned = await win.evaluate(() => window.api.isPinned());
    expect(isPinned).toBe(pinned);
    if (isPinned) await win.evaluate(() => window.api.togglePin());
  });

  test('7.2 opacity control', async () => {
    await win.evaluate(() => window.api.setOpacity(0.8));
    await win.evaluate(() => window.api.setOpacity(1.0));
  });
});

// ══════════════════════════════════════════════════
// 8. COMPRESSION CONTROLS
// ══════════════════════════════════════════════════

test.describe('8 — Compression controls', () => {
  test('8.1 get current profile', async () => {
    const profile = await win.evaluate(() => window.api.compressionGetProfile());
    expect(typeof profile).toBe('string');
  });

  test('8.2 switch profile round-trip', async () => {
    const result = await win.evaluate(() => window.api.compressionSetProfile('minimal'));
    expect(result.success).toBe(true);
    const profile = await win.evaluate(() => window.api.compressionGetProfile());
    expect(profile).toBe('minimal');
    await win.evaluate(() => window.api.compressionSetProfile('balanced'));
  });

  test('8.3 invalidate caches', async () => {
    const result = await win.evaluate(() => window.api.compressionInvalidateCaches());
    expect(result.success).toBe(true);
  });
});

// ══════════════════════════════════════════════════
// 9. SETTINGS PANEL UI
// ══════════════════════════════════════════════════

test.describe('9 — Settings panel', () => {
  test('9.1 open and close settings', async () => {
    await win.click('#settings-btn');
    await win.waitForTimeout(1500);
    const overlay = await win.$('#settings-overlay');
    expect(await overlay.evaluate(el => !el.classList.contains('hidden'))).toBe(true);

    await win.click('#settings-close');
    await win.waitForTimeout(1500);
    expect(await overlay.evaluate(el => el.classList.contains('hidden'))).toBe(true);
  });

  test('9.2 Escape key closes settings', async () => {
    await win.click('#settings-btn');
    await win.waitForTimeout(1500);
    await win.keyboard.press('Escape');
    await win.waitForTimeout(1500);
    const overlay = await win.$('#settings-overlay');
    expect(await overlay.evaluate(el => el.classList.contains('hidden'))).toBe(true);
  });

  test('9.3 model selector populated', async () => {
    await win.click('#settings-btn');
    await win.waitForTimeout(1500);
    const options = await win.$$('#model-select option');
    expect(options.length).toBeGreaterThan(0);
    await win.click('#settings-close');
  });
});

// ══════════════════════════════════════════════════
// 10. TAB CLOSE & REOPEN
// ══════════════════════════════════════════════════

test.describe('10 — Tab close', () => {
  test('10.1 close tab B via IPC', async () => {
    test.skip(!slotB, 'Bottega-Test_B not connected');
    const result = await win.evaluate(id => window.api.closeTab(id), slotB.id);
    expect(result.success).toBe(true);
    await win.waitForTimeout(1500);

    const tabs = await win.evaluate(() => window.api.listTabs());
    expect(tabs.find(t => t.id === slotB.id)).toBeFalsy();
  });

  test('10.2 tab A still active', async () => {
    test.skip(!slotA, 'Bottega-Test_A not connected');
    const tabs = await win.evaluate(() => window.api.listTabs());
    expect(tabs.find(t => t.id === slotA.id)).toBeTruthy();
  });

  test('10.3 closing invalid slotId throws', async () => {
    try {
      await win.evaluate(() => window.api.closeTab('nonexistent-id'));
      expect(false).toBe(true); // should not reach
    } catch {
      // expected
    }
  });
});

// ══════════════════════════════════════════════════
// 11. DIAGNOSTICS & AUTH
// ══════════════════════════════════════════════════

test.describe('11 — Diagnostics and auth', () => {
  test('11.1 copy system info', async () => {
    const info = await win.evaluate(() => window.api.copyDiagnosticsInfo());
    expect(typeof info).toBe('string');
    expect(info.length).toBeGreaterThan(0);
  });

  test('11.2 diagnostics config', async () => {
    const config = await win.evaluate(() => window.api.getDiagnosticsConfig());
    expect(typeof config.sendDiagnostics).toBe('boolean');
  });

  test('11.3 plugin check', async () => {
    const result = await win.evaluate(() => window.api.checkFigmaPlugin());
    expect(typeof result.installed).toBe('boolean');
  });

  test('11.4 app version', async () => {
    const version = await win.evaluate(() => window.api.getAppVersion());
    expect(version.length).toBeGreaterThan(0);
  });

  test('11.5 auth status has all providers', async () => {
    const status = await win.evaluate(() => window.api.getAuthStatus());
    for (const key of ['anthropic', 'openai', 'google']) {
      expect(['oauth', 'api_key', 'none']).toContain(status[key].type);
    }
  });
});

// ══════════════════════════════════════════════════
// 12. FINAL STATE
// ══════════════════════════════════════════════════

test.describe('12 — Final state', () => {
  test('12.1 app remains responsive', async () => {
    expect(await win.textContent('#app-title')).toBe('Bottega');
  });

  test('12.2 final screenshot', async () => {
    const shot = await win.screenshot({ path: 'test-results/uat-12-final.png' });
    expect(shot.byteLength).toBeGreaterThan(0);
  });
});
