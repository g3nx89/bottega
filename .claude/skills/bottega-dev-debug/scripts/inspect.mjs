#!/usr/bin/env node
/**
 * Bottega Inspector v2 — launches the app via Playwright Electron,
 * dumps comprehensive state (DOM, console, preload API, main process),
 * takes a screenshot, and exits cleanly.
 *
 * Usage:
 *   node .claude/skills/bottega-dev-debug/scripts/inspect.mjs [--screenshot /tmp/bottega.png]
 *
 * No CDP port needed — uses Playwright's _electron.launch() for reliable lifecycle control.
 * Automatically handles singleton lock cleanup.
 */

import { _electron as electron } from '@playwright/test';
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opts } = parseArgs({
  options: {
    screenshot: { type: 'string', default: '/tmp/bottega-screenshot.png' },
    'output-json': { type: 'string', default: '' },
  },
});

const PROJECT_DIR = process.cwd();
const screenshotPath = opts.screenshot;
const jsonOutputPath = opts['output-json'];

// ── Singleton lock cleanup ──────────────────────
function clearSingletonLocks() {
  const appSupport = join(process.env.HOME, 'Library/Application Support/Electron');
  for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const p = join(appSupport, f);
    try { if (existsSync(p)) unlinkSync(p); } catch {}
  }
}

async function main() {
  console.log('=== Bottega Inspector v2 ===\n');

  // 1. Clear singleton locks
  clearSingletonLocks();

  // 2. Launch via Playwright Electron
  console.log('[1] Launching Electron...');
  const app = await electron.launch({
    args: [join(PROJECT_DIR, 'dist/main.js')],
    cwd: PROJECT_DIR,
    timeout: 30_000,
    env: {
      ...process.env,
      BOTTEGA_TEST_MODE: '1',
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2000);
  console.log('[2] Window ready:', page.url());

  const report = {};

  // 3. Connection status
  try {
    report.status = {
      dotClass: await page.$eval('#status-dot', el => el.className),
      dotTitle: await page.$eval('#status-dot', el => el.getAttribute('title')),
    };
    console.log(`\n--- Connection: ${report.status.dotTitle} (${report.status.dotClass}) ---`);
  } catch {
    report.status = { error: 'Could not read status dot' };
    console.log('\n--- Connection: unknown ---');
  }

  // 4. Preload API
  try {
    const apiKeys = await page.evaluate(() =>
      typeof window.api !== 'undefined' ? Object.keys(window.api) : []
    );
    report.api = { methodCount: apiKeys.length, methods: apiKeys };
    console.log(`--- Preload API: ${apiKeys.length} methods ---`);
  } catch (e) {
    report.api = { error: e.message };
    console.log('--- Preload API: error ---');
  }

  // 5. UI state
  try {
    report.ui = await page.evaluate(() => ({
      title: document.title,
      appTitle: document.querySelector('#app-title')?.textContent || '',
      tabCount: document.querySelectorAll('.tab-item').length,
      messageCount: document.querySelectorAll('.message').length,
      userMessages: document.querySelectorAll('.user-message').length,
      agentMessages: document.querySelectorAll('.agent-message').length,
      settingsOpen: !document.querySelector('#settings-overlay')?.classList.contains('hidden'),
      inputValue: document.querySelector('#input-field')?.value || '',
      inputPlaceholder: document.querySelector('#input-field')?.placeholder || '',
      contextLabel: document.querySelector('#context-label')?.textContent || '',
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
    }));
    console.log(`--- UI: ${report.ui.tabCount} tabs, ${report.ui.messageCount} messages, ${report.ui.windowWidth}x${report.ui.windowHeight} ---`);
  } catch (e) {
    report.ui = { error: e.message };
  }

  // 6. Console errors/warnings (collect for 2s)
  const consoleMessages = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleMessages.push({ type: msg.type(), text: msg.text() });
    }
  });
  await page.waitForTimeout(2000);
  report.console = consoleMessages;
  if (consoleMessages.length > 0) {
    console.log(`\n--- Console: ${consoleMessages.length} errors/warnings ---`);
    for (const m of consoleMessages) console.log(`  [${m.type}] ${m.text}`);
  } else {
    console.log('\n--- Console: clean (no errors/warnings) ---');
  }

  // 7. Main process info (via electronApp.evaluate)
  try {
    report.mainProcess = await app.evaluate(async ({ app: electronApp, BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      return {
        version: electronApp.getVersion(),
        electronVersion: process.versions.electron,
        nodeVersion: process.versions.node,
        isOnTop: win?.isAlwaysOnTop() || false,
        bounds: win?.getBounds(),
      };
    });
    console.log(`--- Main process: v${report.mainProcess.version}, Electron ${report.mainProcess.electronVersion} ---`);
  } catch (e) {
    report.mainProcess = { error: e.message };
  }

  // 8. Screenshot
  try {
    await page.screenshot({ path: screenshotPath });
    report.screenshot = screenshotPath;
    console.log(`\n--- Screenshot: ${screenshotPath} ---`);
  } catch (e) {
    report.screenshot = { error: e.message };
    console.log(`\n--- Screenshot: failed (${e.message}) ---`);
  }

  // 9. Save JSON report
  if (jsonOutputPath) {
    writeFileSync(jsonOutputPath, JSON.stringify(report, null, 2));
    console.log(`--- JSON report: ${jsonOutputPath} ---`);
  }

  // 10. Cleanup
  await app.close();
  console.log('\n=== Done ===');
}

main().catch(err => {
  console.error('Inspector failed:', err.message);
  process.exit(1);
});
