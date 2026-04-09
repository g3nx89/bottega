#!/usr/bin/env node
/**
 * QA Runner — deterministic test runner for Bottega QA scripts.
 *
 * Parses test script markdown, executes steps, produces structured output
 * with guaranteed metadata JSON for Pass 2 (UX review).
 *
 * Usage:
 *   node qa-runner.mjs --script 02                     # single script
 *   node qa-runner.mjs --script 01 --script 02         # multiple
 *   node qa-runner.mjs --suite smoke                    # predefined suite
 *   node qa-runner.mjs --suite full --output /tmp/qa    # custom output dir
 *
 * Suites: smoke (01,02), pre-release (01-05,14), full (01-16), stress (20-28), error-injection (26-28)
 *
 * Output (per script):
 *   <output>/result-NN.txt       — PASS/FAIL summary (Pass 1)
 *   <output>/NN-metadata.json    — structured metadata for Pass 2
 *   <output>/NN-*.png            — screenshots
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import { parse as parseYaml } from 'yaml';

import { evaluateAssertions } from './assertion-evaluators.mjs';
import { computePHash } from './phash.mjs';
import { getMetrics } from '../../../../tests/helpers/metrics-client.mjs';

const PROJECT_DIR = process.env.BOTTEGA_PROJECT_DIR || '/Users/afato/Projects/bottega';
const SCRIPTS_DIR = join(PROJECT_DIR, 'tests/qa-scripts');
const HELPERS_PATH = join(PROJECT_DIR, '.claude/skills/bottega-dev-debug/scripts/helpers.mjs');

// ── Assertion DSL — Day 3 Fase 2 ──
// Module-scope env-var read so subsequent legacy-mode checks are O(1) and consistent
// across the run. To bypass all assert blocks: QA_RUNNER_LEGACY_MODE=1 node qa-runner.mjs ...
const LEGACY_MODE = process.env.QA_RUNNER_LEGACY_MODE === '1';
const ASSERT_FENCE_OPEN_RE = /^```assert[ \t]*$/;
const ASSERT_FENCE_CLOSE_RE = /^```[ \t]*$/;

// ── Model → provider map (Fase 7.1B) — NO Haiku (removed from main agent in 7.0) ──
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

const SUITES = {
  smoke: ['01', '02'],
  'pre-release': ['01', '02', '03', '04', '05', '14'],
  targeted: ['04', '05', '16', '17', '18', '19'],
  full: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19'],
  stress: ['20', '21', '22', '23', '24', '25', '26', '27', '28'],
  'error-injection': ['26', '27', '28'],
  'design-quality': ['30', '31', '32', '33', '34', '35', '36', '37'],
};

const { values: opts } = parseArgs({
  options: {
    script: { type: 'string', multiple: true, default: [] },
    suite: { type: 'string', default: '' },
    output: { type: 'string', default: '/tmp/bottega-qa' },
    timeout: { type: 'string', default: '120000' },
    'settle-ms': { type: 'string', default: '8000' },
    resume: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    // Day 4 Fase 2 — calibration mode: run each script N times sequentially,
    // then aggregate per-step variance into <output>/<NN>-calibration.json.
    // Usage: --calibrate 3
    calibrate: { type: 'string', default: '0' },
    // Reuse an already-running Bottega via CDP (requires --remote-debugging-port=9222).
    // Skips kill/relaunch cycle — keeps authenticated session alive.
    reuse: { type: 'boolean', default: false },
    // Skip the auth health probe before the first run.
    'skip-probe': { type: 'boolean', default: false },
  },
});

// ── Resolve script list ───────────────────────

function resolveScripts() {
  if (opts.suite && SUITES[opts.suite]) {
    return SUITES[opts.suite];
  }
  if (opts.script.length > 0) {
    return opts.script.map(s => s.padStart(2, '0'));
  }
  console.error('Error: specify --script NN or --suite (smoke|pre-release|full|stress)');
  process.exit(1);
}

function findScriptFile(num) {
  const files = readdirSync(SCRIPTS_DIR).filter(f => f.startsWith(num) && f.endsWith('.md'));
  if (files.length === 0) throw new Error(`Script ${num} not found in ${SCRIPTS_DIR}`);
  return join(SCRIPTS_DIR, files[0]);
}

// ── Markdown parser ───────────────────────────

/**
 * Parse a fenced ```assert block starting at lines[startIdx].
 * Tolerates trailing whitespace on both fences (DD-6).
 *
 * @returns {{ block: object|null, endIdx: number, error: string|null } | null}
 *   - null if `lines[startIdx]` is not an assert fence opener
 *   - { block: object, endIdx, error: null } on success
 *   - { block: null, endIdx, error: string } on parse failure (FAIL loud per DD-6)
 */
function parseAssertionBlock(lines, startIdx) {
  if (!ASSERT_FENCE_OPEN_RE.test(lines[startIdx])) return null;

  const body = [];
  let i = startIdx + 1;
  for (; i < lines.length; i++) {
    if (ASSERT_FENCE_CLOSE_RE.test(lines[i])) break;
    body.push(lines[i]);
  }
  if (i === lines.length) {
    return { block: null, endIdx: i, error: 'unterminated ```assert fence' };
  }

  let parsed;
  try {
    parsed = parseYaml(body.join('\n'));
  } catch (err) {
    return { block: null, endIdx: i, error: `YAML parse error: ${err && err.message ? err.message : String(err)}` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { block: null, endIdx: i, error: `assert block must be a YAML mapping, got ${parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed}` };
  }
  // Empty {} mapping is a parse error (spec §2): use "no assert block" for SOFT_PASS intent,
  // not an empty block that would silently vacuous-pass.
  if (Object.keys(parsed).length === 0) {
    return { block: null, endIdx: i, error: 'assert block must contain at least one assertion (empty mapping)' };
  }
  return { block: parsed, endIdx: i, error: null };
}

/**
 * Parse a test script markdown into structured steps.
 * Extracts: step number, title, send prompt, implementation hints,
 * evaluate criteria, and whether the step requires Figma.
 */
function parseTestScript(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  const script = {
    name: '',
    prerequisites: [],
    requiresFigma: false,
    steps: [],
  };

  // Extract script name from # header
  const titleMatch = content.match(/^# (.+)$/m);
  if (titleMatch) script.name = titleMatch[1];

  // Check if Figma is required
  script.requiresFigma = /Connected to Bottega-Test|Figma|figma/i.test(content);

  let currentStep = null;
  let currentSection = 'body'; // body | evaluate | hint | checks

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New step: ### N. Title or ### Title
    const stepMatch = line.match(/^### (\d+)\.\s*(.+)|^### (.+)/);
    if (stepMatch) {
      if (currentStep) script.steps.push(currentStep);
      const num = stepMatch[1] || String(script.steps.length + 1);
      const title = stepMatch[2] || stepMatch[3];
      currentStep = {
        number: parseInt(num),
        title: title.trim(),
        sendPrompt: null,
        implementationHint: null,
        evaluateCriteria: [],
        pass1Checks: [],
        isManual: false,
        requiresFigma: false,
        assertions: null,           // parsed YAML mapping from ```assert``` block, or null
        assertionParseError: null,  // string error if parsing failed (FAIL loud per DD-6)
        judgeMode: null,            // 'auto' | 'off' — Fase 7.1B directive
        switchModel: null,          // model ID string — Fase 7.1B directive
      };
      currentSection = 'body';
      continue;
    }

    if (!currentStep) continue;

    // Send prompt
    const sendMatch = line.match(/^Send:\s*"(.+)"$/);
    if (sendMatch) {
      currentStep.sendPrompt = sendMatch[1];
      continue;
    }
    // Multi-word send without quotes
    const sendMatch2 = line.match(/^Send:\s*(.+)$/);
    if (sendMatch2 && !currentStep.sendPrompt) {
      currentStep.sendPrompt = sendMatch2[1].replace(/^"|"$/g, '');
      continue;
    }

    // SendNoWait prompt (queue without waiting) — quoted form
    const sendNoWaitMatch = line.match(/^SendNoWait:\s*"(.+)"$/);
    if (sendNoWaitMatch) {
      if (!currentStep.sendNoWaitPrompts) currentStep.sendNoWaitPrompts = [];
      currentStep.sendNoWaitPrompts.push(sendNoWaitMatch[1]);
      continue;
    }
    // SendNoWait — unquoted form (only if quoted didn't match)
    if (!sendNoWaitMatch) {
      const sendNoWaitMatch2 = line.match(/^SendNoWait:\s*(.+)$/);
      if (sendNoWaitMatch2) {
        if (!currentStep.sendNoWaitPrompts) currentStep.sendNoWaitPrompts = [];
        currentStep.sendNoWaitPrompts.push(sendNoWaitMatch2[1].replace(/^"|"$/g, ''));
        continue;
      }
    }

    // Fase 7.1B directives — JudgeMode and SwitchModel
    const judgeModeMatch = line.match(/^JudgeMode:\s*(auto|off)$/i);
    if (judgeModeMatch) {
      currentStep.judgeMode = judgeModeMatch[1].toLowerCase();
      continue;
    }
    const switchModelMatch = line.match(/^SwitchModel:\s*(\S+)$/);
    if (switchModelMatch) {
      currentStep.switchModel = switchModelMatch[1];
      continue;
    }

    // Section markers
    if (line.startsWith('**Implementation hint:**') || line.startsWith('**Implementation hint:')) {
      currentSection = 'hint';
      const inlineHint = line.replace(/^\*\*Implementation hint:\*\*\s*/, '').trim();
      if (inlineHint) currentStep.implementationHint = inlineHint;
      continue;
    }
    if (line.startsWith('**Evaluate:**') || line.startsWith('**Evaluate (Pass 2):**') || line.startsWith('**Evaluate:')) {
      currentSection = 'evaluate';
      continue;
    }
    if (line.startsWith('**Pass 1 checks:**')) {
      currentSection = 'checks';
      continue;
    }
    if (line.startsWith('**Overall assessment:**') || line.startsWith('**Overall assessment:')) {
      currentSection = 'evaluate';
      continue;
    }

    // Assertion block — parse if not in legacy mode (DD-6: fail-loud on parse error)
    if (!LEGACY_MODE && ASSERT_FENCE_OPEN_RE.test(line)) {
      const parsed = parseAssertionBlock(lines, i);
      if (parsed) {
        if (parsed.error) {
          currentStep.assertionParseError = parsed.error;
          console.error(`[qa-runner] ERROR: invalid assertion block in step ${currentStep.number} '${currentStep.title}': ${parsed.error}`);
        } else if (currentStep.assertions !== null) {
          // Spec §2: "only the first assert block per step is honoured. Subsequent blocks → WARN log".
          console.error(
            `[qa-runner] WARN: duplicate assert block in step ${currentStep.number} '${currentStep.title}', ignored (only the first block is honoured)`,
          );
        } else {
          currentStep.assertions = parsed.block;
        }
        i = parsed.endIdx; // skip past the closing fence (loop's i++ then advances past it)
        continue;
      }
    }

    // Collect bullets in current section
    const bulletMatch = line.match(/^- (.+)/);
    if (bulletMatch) {
      if (currentSection === 'evaluate') {
        currentStep.evaluateCriteria.push(bulletMatch[1]);
      } else if (currentSection === 'checks') {
        currentStep.pass1Checks.push(bulletMatch[1]);
      } else if (currentSection === 'hint') {
        currentStep.implementationHint = (currentStep.implementationHint || '') + ' ' + bulletMatch[1];
      }
    }

    // Detect figma-dependent steps
    if (/figma_|screenshot|canvas|element|node/i.test(line)) {
      currentStep.requiresFigma = true;
    }
  }

  if (currentStep) script.steps.push(currentStep);

  // Mark manual steps (no sendPrompt) and warn if they have stray assert blocks.
  // Spec §2: "assert blocks on manual steps are ignored with a WARN log".
  for (const step of script.steps) {
    if (!step.sendPrompt) {
      step.isManual = true;
      if (step.assertions !== null) {
        console.error(
          `[qa-runner] WARN: assert block on manual step ${step.number} '${step.title}' ignored (manual steps are not executed by the runner)`,
        );
        step.assertions = null;
      }
    }
  }

  return script;
}

// ── Port wait ────────────────────────────────

/** Wait until a TCP port is free (connection refused). */
function waitForPortFree(port, timeoutMs = 10_000) {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) { resolve(); return; }
      const sock = createConnection({ port, host: '127.0.0.1' });
      sock.on('connect', () => { sock.destroy(); setTimeout(check, 500); });
      sock.on('error', () => { sock.destroy(); resolve(); }); // ECONNREFUSED = port free
    };
    setTimeout(check, 300); // small initial delay for process cleanup
  });
}

// ── Checkpoint ───────────────────────────────

function getCheckpointPath(outputDir) { return join(outputDir, 'checkpoint.json'); }

function loadCheckpoint(outputDir) {
  try {
    return JSON.parse(readFileSync(getCheckpointPath(outputDir), 'utf8'));
  } catch { return { completed: [] }; }
}

function saveCheckpoint(outputDir, scriptNum) {
  const cp = loadCheckpoint(outputDir);
  if (!cp.completed.includes(scriptNum)) cp.completed.push(scriptNum);
  cp.lastUpdated = new Date().toISOString();
  writeFileSync(getCheckpointPath(outputDir), JSON.stringify(cp, null, 2), 'utf8');
}

// ── Pre-flight checks ────────────────────────

function runPreflight() {
  const issues = [];
  // Check no Electron running
  try {
    execFileSync('pgrep', ['-f', 'electron.*dist/main'], { stdio: 'pipe' });
    issues.push('WARN: Electron is already running — will be killed before first script');
  } catch { /* good, no process */ }
  // Check Figma Desktop
  try {
    execFileSync('pgrep', ['-f', 'Figma'], { stdio: 'pipe' });
  } catch {
    issues.push('ERROR: Figma Desktop not running — tools will fail');
  }
  // Check disk space
  try {
    const df = execFileSync('df', ['-g', '.'], { encoding: 'utf8' });
    const freeGB = parseInt(df.split('\n')[1]?.split(/\s+/)[3] || '999');
    if (freeGB < 1) issues.push('WARN: Low disk space (<1 GB free)');
  } catch { /* ignore */ }

  if (issues.length > 0) {
    console.log('\n=== PRE-FLIGHT CHECKS ===');
    issues.forEach(i => console.log(`  ${i}`));
    if (issues.some(i => i.startsWith('ERROR'))) {
      console.log('\n  Aborting due to pre-flight errors.\n');
      process.exit(1);
    }
    console.log('');
  }
}

// ── Test execution ────────────────────────────

function killElectron() {
  try {
    execFileSync('pkill', ['-f', 'electron.*dist/main'], { stdio: 'ignore' });
  } catch {
    // no process to kill — fine
  }
}

async function runScript(scriptNum, outputDir) {
  const scriptFile = findScriptFile(scriptNum);
  const parsed = parseTestScript(scriptFile);
  const promptTimeout = Number(opts.timeout);
  const settleMs = Number(opts['settle-ms']);

  console.log(`\n=== Running ${scriptNum}: ${parsed.name} ===`);
  console.log(`  Steps: ${parsed.steps.length} (${parsed.steps.filter(s => !s.isManual).length} automated, ${parsed.steps.filter(s => s.isManual).length} manual)`);
  console.log(`  Figma required: ${parsed.requiresFigma}`);

  // Import helpers dynamically
  const helpers = await import(HELPERS_PATH);

  const reuseMode = opts.reuse;
  const startTime = Date.now();
  let app, page, browser;

  if (reuseMode) {
    // Attach to already-running Bottega via CDP — preserves auth session
    try {
      const reused = await helpers.reuseBottega({ settleMs: Math.min(settleMs, 2000) });
      browser = reused.browser;
      page = reused.page;
      app = null; // no Electron app handle in reuse mode
    } catch (err) {
      console.error(`  FAIL: CDP attach failed: ${err.message}`);
      console.error('  Ensure Bottega is running with --remote-debugging-port=9222');
      return {
        scriptNum, name: parsed.name,
        results: [{ step: 0, title: 'CDP Attach', passed: false, error: err.message, manual: false }],
        metadata: [],
      };
    }
    console.log(`  Attached via CDP in ${Date.now() - startTime}ms`);
  } else {
    // Kill any leftover Electron and wait for port to be free
    killElectron();
    await waitForPortFree(9280, 10_000);

    // Launch app
    try {
      const launch = await helpers.launchBottega({ settleMs });
      app = launch.app;
      page = launch.page;
    } catch (err) {
      console.error(`  FAIL: App launch failed: ${err.message}`);
      return {
        scriptNum, name: parsed.name,
        results: [{ step: 0, title: 'App Launch', passed: false, error: err.message, manual: false }],
        metadata: [],
      };
    }
    console.log(`  App launched in ${Date.now() - startTime}ms`);
  }

  // Wait for Figma connection if needed
  if (parsed.requiresFigma) {
    let connected = false;
    for (let i = 0; i < 30; i++) {
      const state = await helpers.getAppState(page);
      if (state.connectionStatus === 'connected') {
        connected = true;
        break;
      }
      await page.waitForTimeout(500);
    }
    console.log(`  Figma: ${connected ? 'connected' : 'disconnected (proceeding anyway)'}`);
  }

  // Reset session
  try {
    await helpers.resetSession(page);
  } catch {}

  // Canvas cleanup — create a fresh Figma page to avoid cross-run pollution
  if (parsed.requiresFigma) {
    try {
      console.log(`  Canvas cleanup: creating fresh page QA-${scriptNum}-${Date.now()}`);
      await helpers.clearFigmaPage(page, `QA-${scriptNum}-${Date.now()}`);
      await page.waitForTimeout(1000);
      // Reset session again after the cleanup turn
      await helpers.resetSession(page);
    } catch (err) {
      console.log(`  Canvas cleanup skipped: ${err.message}`);
    }
  }

  // Screenshot helper
  const screenshotPath = (suffix) => join(outputDir, `${scriptNum}-${suffix}.png`);

  // Take initial screenshot
  await helpers.takeScreenshot(page, screenshotPath('start'));

  // Execute steps
  const results = [];
  const metadata = [];

  for (const step of parsed.steps) {
    const stepResult = {
      step: step.number,
      title: step.title,
      passed: true,
      error: null,
      manual: step.isManual,
    };

    const stepMeta = {
      script: `${scriptNum}-${basename(scriptFile, '.md')}`,
      step: `${step.number}. ${step.title}`,
      prompt: step.sendPrompt,
      response: null,
      toolCards: [],
      screenshot: null,
      passed: true,
      timestamp: new Date().toISOString(),
      evaluateCriteria: step.evaluateCriteria,
      implementationHint: step.implementationHint,
      isManual: step.isManual,
      durationMs: null,
      // Day 3 Fase 2 — assertion DSL fields
      assertionMode: 'soft_pass',  // 'soft_pass' | 'strict' | 'parse_error' | 'legacy'
      assertions: null,             // null when no assert block; AssertionResult[] otherwise
      // Fase 3 — MetricsSnapshot before/after the step, persisted so the
      // baseline recorder can compute metric deltas across N recorded runs.
      // Null when BOTTEGA_AGENT_TEST=1 is not set; consumers must tolerate.
      metricsBefore: null,
      metricsAfter: null,
      screenshotHash: null,
    };

    if (step.isManual) {
      console.log(`  [${step.number}] ${step.title} — MANUAL (skipped, needs qa-tester)`);
      stepResult.manual = true;
      results.push(stepResult);
      metadata.push(stepMeta);
      continue;
    }

    // Send prompt and wait for response
    try {
      const promptPreview = step.sendPrompt.length > 60
        ? step.sendPrompt.slice(0, 60) + '...'
        : step.sendPrompt;
      console.log(`  [${step.number}] ${step.title} — Sending: "${promptPreview}"`);

      // Snapshot tool-card count BEFORE sending so we can compute the per-step
      // diff after response. Without this, helpers.getAppState reads ALL tool
      // cards in the chat and tools_NOT_called_more_than caps fail spuriously
      // because tools from earlier steps leak into later assertions.
      const stateBefore = await helpers.getAppState(page);
      const beforeCount = (stateBefore.toolCards || []).length;

      // Fase 4: capture MetricsRegistry snapshot before the prompt so metric_growth
      // assertions can compute deltas. Tolerate failure (e.g., production build
      // without BOTTEGA_AGENT_TEST) — assertions will fail loudly if needed.
      let metricsBefore = null;
      try {
        metricsBefore = await getMetrics(page);
      } catch (err) {
        // Silent — only metric/metric_growth assertions care, and they fail loud.
      }

      // Fase 7.1B — apply directives before the step
      if (step.judgeMode) {
        console.log(`    -> JudgeMode: ${step.judgeMode}`);
        await page.evaluate((m) => window.api.setSubagentConfig({ judgeMode: m }), step.judgeMode);
        await page.waitForTimeout(300);
      }
      if (step.switchModel) {
        const provider = MODEL_PROVIDERS[step.switchModel];
        if (!provider) {
          console.error(`    -> SwitchModel: unknown model "${step.switchModel}"`);
        } else {
          console.log(`    -> SwitchModel: ${step.switchModel} (${provider})`);
          const slotId = await page.evaluate(() => {
            const tab = typeof getActiveTab === 'function' ? getActiveTab() : null;
            return tab?.id;
          });
          if (slotId) {
            await page.evaluate(([id, p, m]) => window.api.switchModel(id, { provider: p, modelId: m }), [slotId, provider, step.switchModel]);
            await page.waitForTimeout(2000); // allow session recreation
          }
        }
      }

      // Fire SendNoWait prompts before the main Send prompt
      if (step.sendNoWaitPrompts && step.sendNoWaitPrompts.length > 0) {
        for (const noWaitPrompt of step.sendNoWaitPrompts) {
          console.log(`    -> SendNoWait: "${noWaitPrompt.slice(0, 40)}..."`);
          await helpers.sendPromptNoWait(page, noWaitPrompt);
        }
      }

      const stepStart = Date.now();
      const response = await helpers.sendPromptAndWait(page, step.sendPrompt, { timeout: promptTimeout });
      stepMeta.durationMs = Date.now() - stepStart;

      // Capture post-step snapshot AFTER sendPromptAndWait has settled to avoid
      // racing the agent's final tool_call hook.
      let metricsAfter = null;
      try {
        metricsAfter = await getMetrics(page);
      } catch (err) {
        // Silent.
      }

      // Fase 3 — persist metrics into stepMeta so baseline recorder can read
      // them from NN-metadata.json. Assertions still use the locals above.
      stepMeta.metricsBefore = metricsBefore;
      stepMeta.metricsAfter = metricsAfter;

      // ── Capture state for assertions and metadata ──
      // FULL response text for assertion evaluation (NOT truncated to 500).
      // The 500-char truncation only applies to stepMeta.response for the JSON file.
      // Without this, response_contains assertions would falsely fail on content past char 500.
      const lastMsg = await helpers.getLastAssistantMessage(page, 100_000);
      const responseTextFull = lastMsg?.text || '';
      stepMeta.response = responseTextFull.slice(0, 500);

      // Capture tool cards — per-step diff (only cards added since beforeCount).
      // Cumulative tracking would break tools_NOT_called_more_than for any cap
      // less than the cumulative count.
      const state = await helpers.getAppState(page);
      const allToolCards = (state.toolCards || []).map(tc =>
        typeof tc === 'string' ? tc : tc.name || tc.toolName || String(tc)
      );
      stepMeta.toolCards = allToolCards.slice(beforeCount);

      // Take screenshot
      const ssPath = screenshotPath(`step-${step.number}`);
      await helpers.takeScreenshot(page, ssPath);
      stepMeta.screenshot = ssPath;

      // Compute perceptual hash for visual regression baseline
      try {
        stepMeta.screenshotHash = await computePHash(ssPath);
      } catch {
        // sharp may not be installed — visual regression is opt-in
      }

      // ── Assertion evaluation (Day 3 Fase 2) ──
      // PASS / FAIL / SOFT_PASS matrix per ASSERTION-DSL.md §5
      const transportFailed = !response.success;
      if (LEGACY_MODE) {
        // Legacy bypass: ignore assertions entirely, fall back to binary heuristic
        stepMeta.assertionMode = 'legacy';
        if (transportFailed) {
          stepResult.passed = false;
          stepResult.error = 'sendPromptAndWait returned success=false';
        }
      } else if (step.assertionParseError) {
        // FAIL loud — parser rejected the assert block (DD-6)
        stepMeta.assertionMode = 'parse_error';
        stepResult.passed = false;
        stepResult.error = `assertion parse error: ${step.assertionParseError}`;
      } else if (step.assertions && Object.keys(step.assertions).length > 0) {
        // STRICT mode — evaluate the parsed YAML against captured stepData
        stepMeta.assertionMode = 'strict';
        // Fase 4: metricsBefore/metricsAfter come from the MetricsRegistry IPC.
        // null when the build wasn't compiled with BOTTEGA_AGENT_TEST=1; in that
        // case metric/metric_growth assertions fail loud with a clear error.
        const stepData = {
          toolsCalled: stepMeta.toolCards,
          responseText: responseTextFull,
          responseTextTruncated: stepMeta.response,
          screenshotCount: state.screenshotCount || 0,
          durationMs: stepMeta.durationMs,
          page,
          metricsBefore,
          metricsAfter,
        };
        const { passed: assertPassed, results: assertResults } = await evaluateAssertions(step.assertions, stepData);
        stepMeta.assertions = assertResults;
        if (transportFailed) {
          // Transport failed but we still ran assertions for diagnostic data
          stepResult.passed = false;
          stepResult.error = 'sendPromptAndWait returned success=false (assertions evaluated for diagnostics)';
        } else if (!assertPassed) {
          stepResult.passed = false;
          const failed = assertResults.filter((r) => !r.passed);
          stepResult.error = `assertions failed: ${failed.map((r) => `${r.name} (${r.error})`).join('; ')}`;
        }
      } else {
        // SOFT_PASS — no assertion block, legacy binary heuristic
        stepMeta.assertionMode = 'soft_pass';
        if (transportFailed) {
          stepResult.passed = false;
          stepResult.error = 'sendPromptAndWait returned success=false';
        }
      }

      // Console log line — show mode + assertion summary if present
      const assertSummary = stepMeta.assertions
        ? ` | asserts ${stepMeta.assertions.filter((r) => r.passed).length}/${stepMeta.assertions.length} (${stepMeta.assertionMode})`
        : ` | ${stepMeta.assertionMode}`;
      console.log(`    -> ${stepMeta.durationMs}ms${assertSummary}, tools: [${stepMeta.toolCards.join(', ')}]`);

    } catch (err) {
      stepResult.passed = false;
      stepResult.error = err.message || String(err);
      console.log(`    ERROR: ${stepResult.error.slice(0, 100)}`);

      // Still take screenshot on error
      try {
        const ssPath = screenshotPath(`step-${step.number}-error`);
        await helpers.takeScreenshot(page, ssPath);
        stepMeta.screenshot = ssPath;
      } catch {}
    }

    stepMeta.passed = stepResult.passed;
    results.push(stepResult);
    metadata.push(stepMeta);
  }

  // Final screenshot
  await helpers.takeScreenshot(page, screenshotPath('final'));

  // Close app (skip in reuse mode — keep the app running)
  if (app) {
    try {
      await Promise.race([
        app.close(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('app.close timeout')), 10_000)),
      ]);
    } catch {
      console.log('  App close timed out, force killing...');
      killElectron();
      await new Promise(r => setTimeout(r, 1000));
    }
  } else if (browser) {
    // CDP reuse mode: disconnect Playwright but leave the app running
    await browser.close();
  }

  return { scriptNum, name: parsed.name, results, metadata };
}

// ── Output writers ────────────────────────────

function writeResultTxt(outputDir, scriptNum, name, results) {
  const lines = [`=== QA ${scriptNum}: ${name} ===\n`];
  let passed = 0;
  let failed = 0;
  let manual = 0;
  const failures = [];

  for (const r of results) {
    if (r.manual) {
      lines.push(`  MANUAL  [${r.step}] ${r.title}`);
      manual++;
    } else if (r.passed) {
      lines.push(`  PASS  [${r.step}] ${r.title}`);
      passed++;
    } else {
      lines.push(`  FAIL  [${r.step}] ${r.title} — ${r.error || 'unknown'}`);
      failed++;
      failures.push(r);
    }
  }

  lines.push(`\nSUMMARY ${scriptNum}: ${passed} passed, ${failed} failed, ${manual} manual`);

  // Failures detail block — actionable error messages for triage
  if (failures.length > 0) {
    lines.push('\nFAILURES:');
    for (const f of failures) {
      lines.push(`  Step ${f.step}: ${f.title}`);
      lines.push(`    ${f.error || 'unknown error'}`);
    }
  }

  lines.push('');
  lines.push(JSON.stringify(results));

  writeFileSync(join(outputDir, `result-${scriptNum}.txt`), lines.join('\n'), 'utf8');
}

function writeMetadataJson(outputDir, scriptNum, metadata) {
  writeFileSync(
    join(outputDir, `${scriptNum}-metadata.json`),
    JSON.stringify(metadata, null, 2),
    'utf8',
  );
}

/**
 * Aggregate metadata from N calibration runs into a per-step variance report.
 * Reads run-1/, run-2/, ..., run-N/ subdirectories and produces a single
 * <NN>-calibration.json with durationMs arrays, tool union/intersection,
 * and per-assertion stability flags.
 *
 * The output drives Day 4 calibration: engineers read this and tighten or
 * loosen assertion thresholds based on observed variance.
 */
function writeCalibrationJson(outputDir, scriptNum, runs) {
  // runs: array of metadata arrays, one per run
  const allSteps = new Map(); // stepNum → { durations, toolsCalledRuns, assertionsByName }
  for (const runMetadata of runs) {
    for (const m of runMetadata) {
      if (m.isManual) continue;
      const stepNum = parseInt(m.step.match(/^(\d+)\./)?.[1] ?? '0', 10);
      if (!allSteps.has(stepNum)) {
        allSteps.set(stepNum, {
          stepNum,
          stepTitle: m.step.replace(/^\d+\.\s*/, ''),
          durations: [],
          toolsCalledRuns: [],
          assertionResults: new Map(), // name → [pass, pass, fail, ...]
          assertionMode: m.assertionMode,
        });
      }
      const entry = allSteps.get(stepNum);
      entry.durations.push(m.durationMs);
      entry.toolsCalledRuns.push(m.toolCards || []);
      if (Array.isArray(m.assertions)) {
        for (const a of m.assertions) {
          if (!entry.assertionResults.has(a.name)) {
            entry.assertionResults.set(a.name, []);
          }
          entry.assertionResults.get(a.name).push(a.passed);
        }
      }
    }
  }

  const stepReports = [];
  for (const entry of [...allSteps.values()].sort((a, b) => a.stepNum - b.stepNum)) {
    const durations = entry.durations.slice().sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? durations[durations.length - 1];
    // Union and intersection of tool calls across runs
    const toolSets = entry.toolsCalledRuns.map((tc) => new Set(tc.map((t) => t.toLowerCase())));
    const union = new Set();
    for (const s of toolSets) for (const t of s) union.add(t);
    let intersection = toolSets.length > 0 ? new Set(toolSets[0]) : new Set();
    for (const s of toolSets.slice(1)) {
      intersection = new Set([...intersection].filter((t) => s.has(t)));
    }
    // Assertion stability: every-pass vs flaky (mixed)
    const assertionsEvery = [];
    const assertionsFlaky = [];
    for (const [name, results] of entry.assertionResults.entries()) {
      const allPassed = results.every((r) => r === true);
      const allFailed = results.every((r) => r === false);
      if (allPassed) assertionsEvery.push(name);
      else if (!allFailed) assertionsFlaky.push({ name, results });
    }

    stepReports.push({
      step: entry.stepNum,
      stepTitle: entry.stepTitle,
      assertionMode: entry.assertionMode,
      runs: entry.durations.length,
      durationMs: entry.durations,
      durationP95: p95,
      durationRecommendedCap: Math.ceil(p95 * 1.5),
      toolsCalledUnion: [...union].sort(),
      toolsCalledIntersection: [...intersection].sort(),
      assertionsEvery,
      assertionsFlaky,
    });
  }

  const report = {
    script: scriptNum,
    runs: runs.length,
    timestamp: new Date().toISOString(),
    steps: stepReports,
  };

  writeFileSync(
    join(outputDir, `${scriptNum}-calibration.json`),
    JSON.stringify(report, null, 2),
    'utf8',
  );
}

/**
 * Write per-script assertions JSON.
 * Includes one entry per non-manual step regardless of mode (soft_pass / strict / parse_error
 * / legacy), so the file is greppable for any step. Steps without assertions show empty results.
 */
function writeAssertionsJson(outputDir, scriptNum, metadata) {
  const entries = metadata
    .filter((m) => !m.isManual)
    .map((m) => ({
      script: m.script,
      step: parseInt(m.step.match(/^(\d+)\./)?.[1] ?? '0', 10),
      stepTitle: m.step.replace(/^\d+\.\s*/, ''),
      assertionMode: m.assertionMode,
      passed: m.passed,
      durationMs: m.durationMs,
      results: m.assertions ?? [],
    }));
  writeFileSync(
    join(outputDir, `${scriptNum}-assertions.json`),
    JSON.stringify(entries, null, 2),
    'utf8',
  );
}

// ── Auth health probe ────────────────────────

/**
 * Send a trivial prompt to verify the agent is responsive (auth is alive).
 * Runs once before the first script to avoid burning budget on dead auth.
 * Exits with code 2 if the agent doesn't respond.
 */
async function probeAgent(reuseMode) {
  const helpers = await import(HELPERS_PATH);
  let app, page, browser;

  if (reuseMode) {
    try {
      const reused = await helpers.reuseBottega({ settleMs: 2000 });
      browser = reused.browser;
      page = reused.page;
    } catch (err) {
      console.error(`[probe] CDP attach failed: ${err.message}`);
      console.error('[probe] Agent health check FAILED — aborting.');
      process.exit(2);
    }
  } else {
    killElectron();
    await waitForPortFree(9280, 10_000);
    try {
      const launch = await helpers.launchBottega({ settleMs: 3000 });
      app = launch.app;
      page = launch.page;
    } catch (err) {
      console.error(`[probe] App launch failed: ${err.message}`);
      console.error('[probe] Agent health check FAILED — aborting.');
      process.exit(2);
    }
  }

  console.log('[probe] Sending health check prompt...');
  try {
    const response = await helpers.sendPromptAndWait(page, 'Reply with OK', { timeout: 15_000 });
    const responseText = response.lastMessage?.text?.trim() ?? '';
    if (!responseText || !(/ok/i.test(responseText))) {
      console.error(`[probe] Agent response did not contain "OK" — got: "${responseText.slice(0, 100)}"`);
      console.error('[probe] Agent health check FAILED — aborting.');
      if (app) await app.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      process.exit(2);
    }
    console.log(`[probe] Agent responded (${responseText.length} chars) — health check PASSED.`);
  } catch (err) {
    console.error(`[probe] Prompt failed: ${err.message}`);
    console.error('[probe] Agent health check FAILED — aborting.');
    if (app) await app.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    process.exit(2);
  }

  // Reset session after probe so it doesn't pollute the actual run
  try { await helpers.resetSession(page); } catch {}

  // In non-reuse mode, close the app — runScript will relaunch
  if (app) {
    try { await app.close(); } catch { killElectron(); }
    await waitForPortFree(9280, 10_000);
  }
  // In reuse mode, just disconnect Playwright but keep the app alive
  if (browser) {
    await browser.close().catch(() => {});
  }
}

// ── Main ──────────────────────────────────────

// Safety net for unhandled rejections (e.g. Playwright crash)
process.on('unhandledRejection', (err) => {
  console.error(`\n[qa-runner] UNHANDLED REJECTION: ${err?.message || err}`);
  console.error('[qa-runner] Run may be incomplete. Use --resume to continue.');
});

async function main() {
  const scripts = resolveScripts();
  const outputDir = opts.output;
  mkdirSync(outputDir, { recursive: true });

  // Dry run: parse and display all scripts without launching anything
  if (opts['dry-run']) {
    console.log('DRY RUN — parsing scripts only (no Electron launch)\n');
    for (const num of scripts) {
      const f = findScriptFile(num);
      const parsed = parseTestScript(f);
      const auto = parsed.steps.filter(s => s.sendPrompt).length;
      const manual = parsed.steps.filter(s => !s.sendPrompt).length;
      console.log(`  ${num} ${parsed.name}: ${parsed.steps.length} steps (${auto} auto, ${manual} manual)`);
      for (const s of parsed.steps) {
        const label = s.sendPrompt ? `Send: "${s.sendPrompt.slice(0, 60)}${s.sendPrompt.length > 60 ? '...' : ''}"` : 'MANUAL';
        console.log(`    [${s.number}] ${s.title} — ${label}`);
      }
    }
    return;
  }

  // Pre-flight checks
  runPreflight();

  // Resume: skip already-completed scripts
  let scriptsToRun = scripts;
  if (opts.resume) {
    const cp = loadCheckpoint(outputDir);
    const skipped = scripts.filter(s => cp.completed.includes(s));
    scriptsToRun = scripts.filter(s => !cp.completed.includes(s));
    if (skipped.length > 0) {
      console.log(`RESUME: skipping ${skipped.length} completed script(s): ${skipped.join(', ')}`);
    }
    if (scriptsToRun.length === 0) {
      console.log('All scripts already completed. Delete checkpoint.json to re-run.');
      return;
    }
  }

  // Day 4 Fase 2 — calibration mode parsing
  const calibrateRuns = parseInt(opts.calibrate, 10) || 0;
  const calibrationMode = calibrateRuns >= 2; // 1 run is just a normal run

  console.log(`QA Runner — ${scriptsToRun.length} script(s): ${scriptsToRun.join(', ')}`);
  console.log(`Output: ${outputDir}`);
  console.log(`Timeout: ${opts.timeout}ms, Settle: ${opts['settle-ms']}ms`);
  if (opts.resume) console.log(`Resume: enabled (checkpoint: ${getCheckpointPath(outputDir)})`);
  if (calibrationMode) console.log(`Calibration: ${calibrateRuns} runs per script (output: <NN>-calibration.json)`);
  console.log('');

  // Auth health probe — run once before the first script to verify the agent is alive
  if (!opts['skip-probe']) {
    await probeAgent(opts.reuse);
  }

  const allResults = [];

  for (const scriptNum of scriptsToRun) {
    if (calibrationMode) {
      // Calibration: run the script N times, each into a separate run-<k>/ subdir,
      // then aggregate variance into <output>/<NN>-calibration.json.
      const runs = [];
      let lastName = '';
      let crashed = false;
      for (let k = 1; k <= calibrateRuns; k++) {
        const runDir = join(outputDir, `run-${k}`);
        mkdirSync(runDir, { recursive: true });
        console.log(`\n  >>> Calibration run ${k}/${calibrateRuns} for script ${scriptNum}`);
        try {
          const { name, results, metadata } = await runScript(scriptNum, runDir);
          writeResultTxt(runDir, scriptNum, name, results);
          writeMetadataJson(runDir, scriptNum, metadata);
          writeAssertionsJson(runDir, scriptNum, metadata);
          runs.push(metadata);
          lastName = name;
          allResults.push({ scriptNum: `${scriptNum}/run-${k}`, name, results });
        } catch (err) {
          console.error(`  Script ${scriptNum} run ${k} CRASHED: ${err.message}`);
          crashed = true;
          break;
        }
      }
      if (!crashed && runs.length > 0) {
        writeCalibrationJson(outputDir, scriptNum, runs);
        console.log(`  -> Written ${scriptNum}-calibration.json (${runs.length} runs aggregated)`);
      }
      // Don't save checkpoint in calibration mode — it's an explicit run, not a regular pass
      void lastName;
      continue;
    }

    // Normal mode — single run
    try {
      const { name, results, metadata } = await runScript(scriptNum, outputDir);
      writeResultTxt(outputDir, scriptNum, name, results);
      writeMetadataJson(outputDir, scriptNum, metadata);
      writeAssertionsJson(outputDir, scriptNum, metadata);
      saveCheckpoint(outputDir, scriptNum);
      allResults.push({ scriptNum, name, results });
      console.log(`  -> Written result-${scriptNum}.txt + ${scriptNum}-metadata.json + ${scriptNum}-assertions.json + checkpoint`);
    } catch (err) {
      console.error(`  Script ${scriptNum} CRASHED: ${err.message}`);
      allResults.push({ scriptNum, name: 'CRASHED', results: [{ step: 0, title: 'Crash', passed: false, error: err.message, manual: false }] });
      // Still save checkpoint so crash doesn't re-run completed scripts on resume
    }
  }

  // Print overall summary
  console.log('\n=== OVERALL SUMMARY ===');
  let totalPass = 0, totalFail = 0, totalManual = 0;
  for (const { scriptNum, name, results } of allResults) {
    const p = results.filter(r => r.passed && !r.manual).length;
    const f = results.filter(r => !r.passed && !r.manual).length;
    const m = results.filter(r => r.manual).length;
    totalPass += p;
    totalFail += f;
    totalManual += m;
    console.log(`  ${scriptNum} ${name}: ${p} pass, ${f} fail, ${m} manual`);
  }
  console.log(`\nTOTAL: ${totalPass} passed, ${totalFail} failed, ${totalManual} manual`);
  console.log(`Pass rate (automated): ${totalPass + totalFail > 0 ? Math.round(totalPass / (totalPass + totalFail) * 100) : 0}%`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
