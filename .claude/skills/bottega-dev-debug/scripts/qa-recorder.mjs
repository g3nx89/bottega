#!/usr/bin/env node
/**
 * QA Recorder — captures tool interactions from app logs during QA sessions
 * and transforms them into test fixtures for playbook tests, mock connector
 * data, and performance baselines.
 *
 * Runs alongside the log-watcher during Pass 1. Reads the same pino JSON logs
 * but extracts structured interaction data instead of anomalies.
 *
 * Usage:
 *   node qa-recorder.mjs --duration 6600 --output /tmp/bottega-qa/recordings
 *
 * Outputs (in --output directory):
 *   - tool-sequences.json    — ordered tool call chains per agent turn
 *   - connector-fixtures.json — real connector params + responses for mocking
 *   - timing-baselines.json  — p50/p90/max per tool for performance regression
 *   - playbook-drafts.json   — auto-generated playbook test stubs
 *   - error-scenarios.json   — real error cases with context
 */

import { createReadStream, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';

const { values: opts } = parseArgs({
  options: {
    duration: { type: 'string', default: '0' },
    output: { type: 'string', default: '/tmp/bottega-qa/recordings' },
  },
});

const LOG_PATH = join(homedir(), 'Library/Logs/Bottega/app.log');
const OUTPUT_DIR = opts.output;
const MAX_DURATION_MS = Number(opts.duration) * 1000;
const POLL_INTERVAL_MS = 500;

// ── State ─────────────────────────────────────

const startTime = Date.now();
let lineCount = 0;

/**
 * Active turn tracker: groups tool calls by agent turn (sid + turnId).
 * @type {Map<string, { prompt: string, tools: Array, startTime: number, slotId: string }>}
 */
const activeTurns = new Map();

/** Completed turn sequences */
const completedTurns = [];

/** Tool timing data: toolName → [durationMs] */
const toolTimings = new Map();

/** Connector call recordings: { toolName, params, result, durationMs } */
const connectorFixtures = [];

/** Error scenarios */
const errorScenarios = [];

// ── Processing ────────────────────────────────

function processEntry(entry) {
  const sid = entry.sid || entry.sessionId || 'unknown';
  const component = entry.component || '';
  const msg = entry.msg || '';

  // Track user prompt (start of turn)
  if (msg === 'Prompt enqueued' || msg === 'User prompt received' || msg === 'user-message') {
    const turnKey = `${sid}-${entry.time}`;
    activeTurns.set(turnKey, {
      prompt: entry.text || entry.prompt || '',
      tools: [],
      startTime: entry.time,
      slotId: entry.slotId || sid,
    });
  }

  // Track tool execution (component=tool from QA recording, or session-events Tool start/end)
  if (component === 'tool' || (component === 'session-events' && (msg === 'Tool start' || msg === 'Tool end'))) {
    const toolName = entry.toolName || entry.tool || entry.name || '';
    const durationMs = entry.durationMs || entry.duration || 0;

    // Add to timing baselines
    if (toolName && durationMs > 0) {
      if (!toolTimings.has(toolName)) toolTimings.set(toolName, []);
      toolTimings.get(toolName).push(durationMs);
    }

    // Find the active turn for this session
    const turnKey = [...activeTurns.keys()].find(k => k.startsWith(sid));
    if (turnKey) {
      activeTurns.get(turnKey).tools.push({
        toolName,
        params: entry.params || entry.input || {},
        result: truncate(entry.result || entry.output || '', 500),
        durationMs,
        error: entry.error || entry.err?.message || null,
        timestamp: entry.time,
      });
    }

    // Capture connector fixture (params + response)
    if (toolName && !toolName.startsWith('_')) {
      connectorFixtures.push({
        toolName,
        params: sanitizeParams(entry.params || entry.input || {}),
        resultPreview: truncate(entry.result || entry.output || '', 300),
        durationMs,
        error: entry.error || entry.err?.message || null,
      });
    }
  }

  // Track turn completion (suggestions = end of agent response cycle, or context update with no tool in progress)
  if (msg === 'Suggestions generated' || msg === 'Agent turn completed' || msg === 'message-end' || msg === 'onAgentEnd') {
    const turnKey = [...activeTurns.keys()].find(k => k.startsWith(sid));
    if (turnKey) {
      const turn = activeTurns.get(turnKey);
      if (turn.tools.length > 0) {
        completedTurns.push({
          prompt: turn.prompt,
          toolSequence: turn.tools.map(t => ({
            name: t.toolName,
            params: t.params,
            durationMs: t.durationMs,
            error: t.error,
          })),
          totalDurationMs: entry.time - turn.startTime,
          responseText: truncate(entry.text || entry.response || '', 300),
          slotId: turn.slotId,
        });
      }
      activeTurns.delete(turnKey);
    }
  }

  // Track errors
  if (entry.level >= 50 && component === 'tool') {
    errorScenarios.push({
      toolName: entry.toolName || entry.tool || 'unknown',
      error: entry.err?.message || entry.error || msg,
      stack: entry.err?.stack?.split('\n').slice(0, 3).join('\n') || null,
      params: sanitizeParams(entry.params || {}),
      context: { sid, component, time: new Date(entry.time).toISOString() },
    });
  }
}

// ── Helpers ────────────────────────────────────

function truncate(s, maxLen) {
  if (typeof s !== 'string') s = JSON.stringify(s) || '';
  return s.length > maxLen ? s.slice(0, maxLen) + '...' : s;
}

function sanitizeParams(params) {
  if (!params || typeof params !== 'object') return {};
  const clean = { ...params };
  // Remove large fields that bloat fixtures
  for (const key of ['code', 'jsx', 'svg', 'imageData', 'base64']) {
    if (clean[key] && typeof clean[key] === 'string' && clean[key].length > 200) {
      clean[key] = `[${clean[key].length} chars]`;
    }
  }
  return clean;
}

function computeStats(times) {
  if (!times.length) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    count: n,
    min: sorted[0],
    max: sorted[n - 1],
    avg: Math.round(sorted.reduce((s, t) => s + t, 0) / n),
    p50: sorted[Math.floor(n * 0.5)],
    p90: sorted[Math.floor(n * 0.9)],
    p99: sorted[Math.floor(n * 0.99)],
  };
}

// ── Playbook generation ───────────────────────

function generatePlaybookDrafts() {
  return completedTurns
    .filter(t => t.toolSequence.length > 0 && t.prompt)
    .slice(0, 50) // cap at 50 most useful
    .map(turn => ({
      description: `Replay: "${turn.prompt.slice(0, 80)}"`,
      prompt: turn.prompt,
      actions: turn.toolSequence.map(t => {
        if (t.error) {
          return { type: 'call', toolName: t.name, params: t.params, expectError: true };
        }
        return { type: 'call', toolName: t.name, params: t.params };
      }),
      dslCode: generateDslCode(turn),
    }));
}

function generateDslCode(turn) {
  const lines = [`when("${turn.prompt.slice(0, 60).replace(/"/g, '\\"')}", [`];
  for (const t of turn.toolSequence) {
    const paramsStr = Object.keys(t.params).length > 0
      ? JSON.stringify(t.params).slice(0, 100)
      : '{}';
    lines.push(`  calls("${t.name}", ${paramsStr}),`);
  }
  if (turn.responseText) {
    lines.push(`  says("${turn.responseText.slice(0, 40).replace(/"/g, '\\"')}..."),`);
  }
  lines.push('])');
  return lines.join('\n');
}

// ── Report generation ─────────────────────────

function writeReports() {
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 1. Tool sequences
  writeFileSync(
    join(OUTPUT_DIR, 'tool-sequences.json'),
    JSON.stringify(completedTurns, null, 2),
    'utf8',
  );

  // 2. Connector fixtures (deduplicated by toolName)
  const fixturesByTool = {};
  for (const f of connectorFixtures) {
    if (!fixturesByTool[f.toolName]) fixturesByTool[f.toolName] = [];
    if (fixturesByTool[f.toolName].length < 5) { // max 5 per tool
      fixturesByTool[f.toolName].push(f);
    }
  }
  writeFileSync(
    join(OUTPUT_DIR, 'connector-fixtures.json'),
    JSON.stringify(fixturesByTool, null, 2),
    'utf8',
  );

  // 3. Timing baselines
  const baselines = {};
  for (const [tool, times] of toolTimings) {
    baselines[tool] = computeStats(times);
  }
  writeFileSync(
    join(OUTPUT_DIR, 'timing-baselines.json'),
    JSON.stringify(baselines, null, 2),
    'utf8',
  );

  // 4. Playbook drafts
  const drafts = generatePlaybookDrafts();
  writeFileSync(
    join(OUTPUT_DIR, 'playbook-drafts.json'),
    JSON.stringify(drafts, null, 2),
    'utf8',
  );

  // 5. Error scenarios
  writeFileSync(
    join(OUTPUT_DIR, 'error-scenarios.json'),
    JSON.stringify(errorScenarios, null, 2),
    'utf8',
  );

  // Summary
  console.log(`\n[qa-recorder] Reports written to ${OUTPUT_DIR}`);
  console.log(`[qa-recorder] ${lineCount} lines processed`);
  console.log(`[qa-recorder] ${completedTurns.length} turns recorded`);
  console.log(`[qa-recorder] ${toolTimings.size} unique tools profiled`);
  console.log(`[qa-recorder] ${connectorFixtures.length} connector fixtures`);
  console.log(`[qa-recorder] ${errorScenarios.length} error scenarios`);
  console.log(`[qa-recorder] ${generatePlaybookDrafts().length} playbook drafts generated`);
}

// ── Tail implementation ───────────────────────

function processLine(line) {
  lineCount++;
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    processEntry(JSON.parse(trimmed));
  } catch {
    // non-JSON line
  }
}

async function tailLog() {
  let position = 0;
  try {
    position = statSync(LOG_PATH).size;
    console.log(`[qa-recorder] Starting from byte ${position} of ${LOG_PATH}`);
  } catch {
    console.log(`[qa-recorder] Log file not yet available, will poll...`);
  }

  console.log(`[qa-recorder] Recording started at ${new Date().toISOString()}`);
  if (MAX_DURATION_MS > 0) {
    console.log(`[qa-recorder] Will auto-stop after ${MAX_DURATION_MS / 1000}s`);
  }

  const poll = () => {
    try {
      if (!existsSync(LOG_PATH)) return;
      const stat = statSync(LOG_PATH);
      if (stat.size < position) position = 0; // rotated
      if (stat.size <= position) return;

      const stream = createReadStream(LOG_PATH, { start: position, encoding: 'utf8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      rl.on('line', processLine);
      rl.on('close', () => { position = stat.size; });
    } catch {}
  };

  const interval = setInterval(poll, POLL_INTERVAL_MS);

  if (MAX_DURATION_MS > 0) {
    setTimeout(() => {
      clearInterval(interval);
      writeReports();
      process.exit(0);
    }, MAX_DURATION_MS);
  }

  const shutdown = () => {
    clearInterval(interval);
    writeReports();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await new Promise(() => {});
}

tailLog();
