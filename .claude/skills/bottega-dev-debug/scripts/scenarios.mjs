#!/usr/bin/env node
/**
 * Bottega Scenario Runner — predefined user-journey tests.
 *
 * Usage:
 *   node scripts/scenarios.mjs                      # Run all scenarios
 *   node scripts/scenarios.mjs --scenario happy-path # Run one scenario
 *   node scripts/scenarios.mjs --list                # List available scenarios
 *   node scripts/scenarios.mjs --real                # Real mode (default, requires Figma)
 *   node scripts/scenarios.mjs --test-mode           # Test mode (stub agent, no Figma)
 *   node scripts/scenarios.mjs --json                # JSON output
 *
 * Real mode (default): Requires Figma Desktop open with Bridge plugin.
 * Test mode: No external dependencies, tests UI-only flows.
 */

import { parseArgs } from 'node:util';
import { writeFileSync } from 'node:fs';
import {
  launchBottega, getAppState, sendPromptAndWait, sendPromptNoWait,
  waitForStreaming, abortAgent, switchTab, resetSession,
  openSettings, closeSettings, getSettingsState, changeModel,
  takeScreenshot, runChecks, formatCheckResults,
} from './helpers.mjs';

const { values: opts } = parseArgs({
  options: {
    scenario: { type: 'string', default: '' },
    list: { type: 'boolean', default: false },
    'test-mode': { type: 'boolean', default: false },
    real: { type: 'boolean', default: true },
    json: { type: 'boolean', default: false },
    'output-json': { type: 'string', default: '' },
  },
});

// ── Scenario: App Startup ───────────────────────

async function scenarioStartup(page) {
  return runChecks(page, [
    {
      name: 'Window loads with title "Bottega"',
      fn: async (p) => {
        const title = await p.evaluate(() => document.getElementById('app-title')?.textContent);
        return title === 'Bottega';
      },
    },
    {
      name: 'Status dot exists',
      fn: async (p) => {
        const exists = await p.evaluate(() => document.getElementById('status-dot') !== null);
        return exists;
      },
    },
    {
      name: 'Input field is enabled and empty',
      fn: async (p) => {
        const state = await p.evaluate(() => ({
          disabled: document.getElementById('input-field')?.disabled,
          value: document.getElementById('input-field')?.value,
        }));
        return !state.disabled && state.value === '';
      },
    },
    {
      name: 'Toolbar shows model label',
      fn: async (p) => {
        const label = await p.evaluate(() => document.getElementById('bar-model-label')?.textContent);
        return label && label.length > 0;
      },
    },
    {
      name: 'Context bar shows 0K initially',
      fn: async (p) => {
        const text = await p.evaluate(() => document.getElementById('context-label')?.textContent);
        return text?.includes('0K');
      },
    },
    {
      name: 'At least one tab exists',
      fn: async (p) => {
        const count = await p.evaluate(() => document.querySelectorAll('.tab-item').length);
        return count >= 1;
      },
    },
    {
      name: 'Preload API exposes required methods',
      fn: async (p) => {
        const methods = await p.evaluate(() => Object.keys(window.api));
        const required = ['sendPrompt', 'abort', 'resetSession', 'switchModel'];
        return required.every(m => methods.includes(m));
      },
    },
  ]);
}

// ── Scenario: Happy Path (requires Figma) ───────

async function scenarioHappyPath(page) {
  return runChecks(page, [
    {
      name: 'Figma is connected (status dot green)',
      fn: async (p) => {
        const state = await getAppState(p);
        return state.connectionStatus === 'connected';
      },
    },
    {
      name: 'Send "take a screenshot" and get response',
      fn: async (p) => {
        const result = await sendPromptAndWait(p, 'Take a screenshot of the current page and briefly describe what you see', { timeout: 30_000 });
        return result.success && result.messagesAfter > result.messagesBefore;
      },
    },
    {
      name: 'Agent used figma_screenshot tool',
      fn: async (p) => {
        const state = await getAppState(p);
        return state.toolCards.some(tc => tc.name === 'figma_screenshot' && tc.status === '✓');
      },
    },
    {
      name: 'Screenshot image appeared in chat',
      fn: async (p) => {
        const state = await getAppState(p);
        return state.screenshotCount >= 1;
      },
    },
    {
      name: 'Context bar updated (non-zero)',
      fn: async (p) => {
        const state = await getAppState(p);
        return state.context && !state.context.startsWith('0K');
      },
    },
    {
      name: 'Input field cleared after send',
      fn: async (p) => {
        const state = await getAppState(p);
        return state.input.value === '';
      },
    },
  ]);
}

// ── Scenario: Multi-tab (requires 2 Figma files) ─

async function scenarioMultiTab(page) {
  return runChecks(page, [
    {
      name: 'At least 2 tabs exist',
      fn: async (p) => {
        const state = await getAppState(p);
        return state.tabs.length >= 2;
      },
    },
    {
      name: 'Switch to second tab preserves first tab messages',
      fn: async (p) => {
        const state1 = await getAppState(p);
        const firstTabMsgs = state1.messages.total;
        const secondSlotId = state1.tabs[1]?.slotId;
        if (!secondSlotId) return false;

        await switchTab(p, secondSlotId);
        await p.waitForTimeout(500);

        // Switch back
        const firstSlotId = state1.tabs[0]?.slotId;
        await switchTab(p, firstSlotId);
        await p.waitForTimeout(500);

        const state2 = await getAppState(p);
        return state2.messages.total === firstTabMsgs;
      },
    },
    {
      name: 'Both tabs show connection status',
      fn: async (p) => {
        const state = await getAppState(p);
        return state.tabs.every(t => typeof t.connected === 'boolean');
      },
    },
  ]);
}

// ── Scenario: Input Validation ──────────────────

async function scenarioInputValidation(page) {
  await resetSession(page);
  return runChecks(page, [
    {
      name: 'Empty prompt is blocked',
      fn: async (p) => {
        const before = await p.evaluate(() => document.querySelectorAll('.message').length);
        await p.evaluate(() => { inputField.value = ''; sendMessage(); });
        await p.waitForTimeout(300);
        const after = await p.evaluate(() => document.querySelectorAll('.message').length);
        return before === after;
      },
    },
    {
      name: 'Whitespace-only prompt is blocked',
      fn: async (p) => {
        const before = await p.evaluate(() => document.querySelectorAll('.message').length);
        await p.evaluate(() => { inputField.value = '   \n\t  '; sendMessage(); });
        await p.waitForTimeout(300);
        const after = await p.evaluate(() => document.querySelectorAll('.message').length);
        return before === after;
      },
    },
    {
      name: 'Long prompt (5000 chars) is accepted in textarea',
      fn: async (p) => {
        await p.evaluate(() => {
          inputField.value = 'A'.repeat(5000);
          inputField.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const len = await p.evaluate(() => inputField.value.length);
        await p.evaluate(() => { inputField.value = ''; });
        return len === 5000;
      },
    },
    {
      name: 'New Chat clears all messages',
      fn: async (p) => {
        await resetSession(p);
        const state = await getAppState(p);
        return state.messages.total === 0;
      },
    },
  ]);
}

// ── Scenario: Settings ──────────────────────────

async function scenarioSettings(page) {
  return runChecks(page, [
    {
      name: 'Settings panel opens',
      fn: async (p) => {
        await openSettings(p);
        const state = await getAppState(p);
        await closeSettings(p);
        return state.settings.open;
      },
    },
    {
      name: 'Settings has model select with options',
      fn: async (p) => {
        await openSettings(p);
        const settings = await getSettingsState(p);
        await closeSettings(p);
        return settings.modelOptions.length > 0 && settings.model !== '';
      },
    },
    {
      name: 'Compression profile select works',
      fn: async (p) => {
        await openSettings(p);
        await p.evaluate(() => {
          const sel = document.getElementById('compression-profile-select');
          sel.value = 'creative';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const val = await p.evaluate(() => document.getElementById('compression-profile-select')?.value);
        // Restore
        await p.evaluate(() => {
          const sel = document.getElementById('compression-profile-select');
          sel.value = 'balanced';
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await closeSettings(p);
        return val === 'creative';
      },
    },
    {
      name: 'Settings close button works',
      fn: async (p) => {
        await openSettings(p);
        await closeSettings(p);
        const state = await getAppState(p);
        return !state.settings.open;
      },
    },
  ]);
}

// ── Scenario: Slash Commands ────────────────────

async function scenarioSlashCommands(page) {
  return runChecks(page, [
    {
      name: 'Typing "/" opens slash menu',
      fn: async (p) => {
        await p.evaluate(() => {
          inputField.value = '/';
          inputField.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await p.waitForTimeout(300);
        const visible = await p.evaluate(() =>
          !document.getElementById('slash-menu')?.classList.contains('hidden')
        );
        // Clear
        await p.evaluate(() => {
          inputField.value = '';
          inputField.dispatchEvent(new Event('input', { bubbles: true }));
        });
        return visible;
      },
    },
    {
      name: 'Slash menu has items',
      fn: async (p) => {
        await p.evaluate(() => {
          inputField.value = '/';
          inputField.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await p.waitForTimeout(300);
        const count = await p.evaluate(() =>
          document.querySelectorAll('#slash-menu .slash-menu-item').length
        );
        await p.evaluate(() => {
          inputField.value = '';
          inputField.dispatchEvent(new Event('input', { bubbles: true }));
        });
        return count > 0;
      },
    },
  ]);
}

// ── Scenario Registry ───────────────────────────

const SCENARIOS = {
  startup: { name: 'App Startup', fn: scenarioStartup, requiresFigma: false },
  'happy-path': { name: 'Happy Path', fn: scenarioHappyPath, requiresFigma: true },
  'multi-tab': { name: 'Multi-Tab Isolation', fn: scenarioMultiTab, requiresFigma: true },
  'input-validation': { name: 'Input Validation', fn: scenarioInputValidation, requiresFigma: false },
  settings: { name: 'Settings Panel', fn: scenarioSettings, requiresFigma: false },
  'slash-commands': { name: 'Slash Commands', fn: scenarioSlashCommands, requiresFigma: false },
};

// ── Main ────────────────────────────────────────

async function main() {
  if (opts.list) {
    console.log('Available scenarios:\n');
    for (const [id, s] of Object.entries(SCENARIOS)) {
      console.log(`  ${id.padEnd(20)} ${s.name}${s.requiresFigma ? ' (requires Figma)' : ''}`);
    }
    return;
  }

  const testMode = opts['test-mode'];
  const scenarioIds = opts.scenario
    ? [opts.scenario]
    : Object.keys(SCENARIOS);

  // Filter out Figma-requiring scenarios in test mode
  const toRun = scenarioIds.filter(id => {
    const s = SCENARIOS[id];
    if (!s) {
      console.error(`Unknown scenario: ${id}`);
      return false;
    }
    if (testMode && s.requiresFigma) {
      console.log(`Skipping "${s.name}" (requires Figma, running in test mode)`);
      return false;
    }
    return true;
  });

  if (toRun.length === 0) {
    console.log('No scenarios to run.');
    return;
  }

  console.log(`=== Bottega Scenario Runner ===`);
  console.log(`Mode: ${testMode ? 'TEST (stub agent)' : 'REAL (Figma required)'}`);
  console.log(`Scenarios: ${toRun.join(', ')}\n`);

  // Build first
  console.log('[1] Launching Bottega...');
  const { app, page } = await launchBottega({ testMode });

  // Take initial screenshot
  await takeScreenshot(page, '/tmp/bottega-scenario-start.png');
  console.log('[2] App launched. Running scenarios...\n');

  const allResults = {};
  let totalPassed = 0;
  let totalFailed = 0;

  for (const id of toRun) {
    const scenario = SCENARIOS[id];
    console.log(`--- Running: ${scenario.name} ---`);
    try {
      const results = await scenario.fn(page);
      allResults[id] = results;
      totalPassed += results.passed;
      totalFailed += results.failed;

      if (opts.json) {
        // Will be printed at end
      } else {
        console.log(formatCheckResults(scenario.name, results));
      }
    } catch (e) {
      console.error(`  CRASH: ${e.message}`);
      allResults[id] = { total: 0, passed: 0, failed: 1, results: [{ name: 'scenario execution', passed: false, error: e.message }] };
      totalFailed++;
    }
  }

  // Final screenshot
  await takeScreenshot(page, '/tmp/bottega-scenario-end.png');

  // Summary
  const summary = {
    mode: testMode ? 'test' : 'real',
    scenariosRun: toRun.length,
    totalChecks: totalPassed + totalFailed,
    totalPassed,
    totalFailed,
    scenarios: allResults,
    screenshots: {
      start: '/tmp/bottega-scenario-start.png',
      end: '/tmp/bottega-scenario-end.png',
    },
  };

  if (opts.json || opts['output-json']) {
    const jsonStr = JSON.stringify(summary, null, 2);
    if (opts['output-json']) {
      writeFileSync(opts['output-json'], jsonStr);
      console.log(`\nJSON report: ${opts['output-json']}`);
    } else {
      console.log(jsonStr);
    }
  }

  console.log(`\n=== Summary: ${totalPassed}/${totalPassed + totalFailed} passed ===`);
  if (totalFailed > 0) {
    console.log(`${totalFailed} check(s) FAILED`);
  }

  await app.close();
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Scenario runner failed:', err.message);
  process.exit(1);
});
