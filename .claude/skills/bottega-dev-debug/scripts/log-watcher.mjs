#!/usr/bin/env node
/**
 * Bottega Log Watcher — real-time pino JSON log monitor for QA sessions.
 *
 * Tails ~/Library/Logs/Bottega/app.log from the current position,
 * detects anomalous patterns, and writes a structured report on exit.
 *
 * Usage:
 *   node log-watcher.mjs                          # monitor until Ctrl+C
 *   node log-watcher.mjs --duration 1800          # stop after 30 min
 *   node log-watcher.mjs --output /tmp/report.md  # custom output path
 *
 * The watcher writes its report to --output (default: /tmp/log-monitor-report.md)
 * when it exits (SIGINT, SIGTERM, or --duration timeout).
 */

import { createReadStream, statSync, existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { parseArgs } from 'node:util';

const { values: opts } = parseArgs({
  options: {
    duration: { type: 'string', default: '0' },
    output: { type: 'string', default: '/tmp/log-monitor-report.md' },
  },
});

const LOG_PATH = join(homedir(), 'Library/Logs/Bottega/app.log');
const OUTPUT_PATH = opts.output;
const MAX_DURATION_MS = Number(opts.duration) * 1000;
const POLL_INTERVAL_MS = 500;

// ── Known patterns (not bugs) ─────────────────
const KNOWN_WARNINGS = [
  'Another Bottega instance is already running',
  'Auto-update channel file missing',
  'auto-update not available in dev',
];

// ── Anomaly detectors ─────────────────────────
const ANOMALY_RULES = [
  {
    id: 'fatal',
    name: 'Fatal error',
    severity: 'Alta',
    test: (e) => e.level >= 60,
    extract: (e) => e.msg || 'unknown fatal',
  },
  {
    id: 'error',
    name: 'Error',
    severity: 'Media',
    test: (e) => e.level >= 50 && e.level < 60,
    extract: (e) => e.msg || 'unknown error',
  },
  {
    id: 'unhandled-rejection',
    name: 'Unhandled promise rejection',
    severity: 'Alta',
    test: (e) => /unhandled|uncaught/i.test(e.msg || ''),
    extract: (e) => e.err?.message || e.msg,
  },
  {
    id: 'ws-disconnect',
    name: 'WebSocket disconnect',
    severity: 'Media',
    test: (e) => /disconnect|connection.*(lost|closed|error)/i.test(e.msg || ''),
    extract: (e) => `${e.msg} (${e.component || 'unknown'})`,
  },
  {
    id: 'slow-operation',
    name: 'Slow operation',
    severity: 'Bassa',
    test: (e) => {
      const dur = e.durationMs || e.duration || 0;
      if (dur <= 0) return false;
      // Filter micro-judge completions (expected >10s)
      if (/micro-judge completed/i.test(e.msg || '')) return false;
      // Per-component thresholds
      const comp = e.component || '';
      if (comp === 'subagent-orchestrator' || comp === 'judge-harness') return dur > 20000;
      if (comp === 'tool') return dur > 5000;
      if (comp === 'websocket-server' || comp === 'websocket-connector') return dur > 2000;
      if (comp === 'figma-api') return dur > 3000;
      return dur > 10000;
    },
    extract: (e) => `${e.msg || e.component || 'unknown'} — ${e.durationMs || e.duration}ms`,
  },
  {
    id: 'tool-error',
    name: 'Tool execution error',
    severity: 'Media',
    test: (e) => e.component === 'tool' && e.level >= 40,
    extract: (e) => `${e.toolName || 'unknown'}: ${e.msg}`,
  },
  {
    id: 'abort-timeout',
    name: 'Abort timeout',
    severity: 'Alta',
    test: (e) => /abort.*timeout/i.test(e.msg || ''),
    extract: (e) => e.msg,
  },
  {
    id: 'memory-warning',
    name: 'Memory/context warning',
    severity: 'Media',
    test: (e) => /memory|heap|context.*(limit|exceed|overflow)/i.test(e.msg || ''),
    extract: (e) => e.msg,
  },
  {
    id: 'object-destroyed',
    name: 'Object destroyed (shutdown race)',
    severity: 'Alta',
    test: (e) => /object has been destroyed/i.test(e.msg || '') ||
                 /object has been destroyed/i.test(e.err?.message || ''),
    extract: (e) => e.err?.message || e.msg,
  },
];

// ── State ─────────────────────────────────────
const startTime = Date.now();
let lineCount = 0;
let parsedCount = 0;

/** @type {Map<string, { rule: object, occurrences: Array<{ time: string, detail: string, raw: object }> }>} */
const findings = new Map();

/** @type {Array<{ time: string, level: number, msg: string }>} */
const timeline = [];

/** Script boundary markers (detected from "Prompt enqueued" log entries). */
const scriptMarkers = [];

// ── Core logic ────────────────────────────────

function isKnown(entry) {
  return KNOWN_WARNINGS.some(k => (entry.msg || '').includes(k));
}

function processEntry(entry) {
  parsedCount++;

  // Track all warn+ in timeline
  if (entry.level >= 40) {
    timeline.push({
      time: entry.time ? new Date(entry.time).toISOString() : new Date().toISOString(),
      level: entry.level,
      msg: (entry.msg || 'unknown').slice(0, 120),
    });
  }

  // Track script boundaries (user prompts as delimiters)
  if (entry.msg === 'Prompt enqueued' || entry.msg === 'User prompt received') {
    scriptMarkers.push({
      time: entry.time ? new Date(entry.time).toISOString() : new Date().toISOString(),
      slotId: entry.slotId || 'unknown',
      promptId: entry.promptId || null,
    });
  }

  // Skip known non-bugs
  if (isKnown(entry)) return;

  for (const rule of ANOMALY_RULES) {
    if (rule.test(entry)) {
      if (!findings.has(rule.id)) {
        findings.set(rule.id, { rule, occurrences: [] });
      }
      findings.get(rule.id).occurrences.push({
        time: entry.time ? new Date(entry.time).toISOString() : new Date().toISOString(),
        detail: rule.extract(entry),
        raw: {
          level: entry.level,
          component: entry.component,
          err: entry.err ? { message: entry.err.message, stack: entry.err.stack?.split('\n').slice(0, 3).join('\n') } : undefined,
        },
      });
    }
  }
}

function processLine(line) {
  lineCount++;
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const entry = JSON.parse(trimmed);
    processEntry(entry);
  } catch {
    // non-JSON line (startup banner, etc.)
  }
}

// ── Report generation ─────────────────────────

function generateReport() {
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const findingsArr = [...findings.values()].sort((a, b) => {
    const sevOrder = { Alta: 0, Media: 1, Bassa: 2 };
    return (sevOrder[a.rule.severity] ?? 3) - (sevOrder[b.rule.severity] ?? 3);
  });

  const totalAnomalies = findingsArr.reduce((s, f) => s + f.occurrences.length, 0);

  let md = `# Log Monitor Report\n\n`;
  md += `**Session**: ${new Date(startTime).toISOString()} — ${new Date().toISOString()} (${elapsed}s)\n`;
  md += `**Lines processed**: ${lineCount} (parsed: ${parsedCount})\n`;
  md += `**Anomalies detected**: ${totalAnomalies}\n\n`;

  if (findingsArr.length === 0) {
    md += `## No anomalies detected\n\nAll log entries within normal parameters during the monitoring window.\n`;
  } else {
    // Summary table
    md += `## Summary\n\n`;
    md += `| Severity | Pattern | Count |\n`;
    md += `|----------|---------|-------|\n`;
    for (const f of findingsArr) {
      md += `| ${f.rule.severity} | ${f.rule.name} | ${f.occurrences.length} |\n`;
    }

    // Details
    md += `\n## Details\n\n`;
    for (const f of findingsArr) {
      md += `### ${f.rule.name} (${f.rule.severity}) — ${f.occurrences.length}x\n\n`;
      for (const occ of f.occurrences.slice(0, 10)) {
        md += `- **${occ.time}**: ${occ.detail}\n`;
        if (occ.raw.err?.stack) {
          md += `  \`\`\`\n  ${occ.raw.err.stack}\n  \`\`\`\n`;
        }
      }
      if (f.occurrences.length > 10) {
        md += `- ... and ${f.occurrences.length - 10} more\n`;
      }
      md += `\n`;
    }
  }

  // Script boundaries (prompt markers)
  if (scriptMarkers.length > 0) {
    md += `## Prompt Boundaries (${scriptMarkers.length} prompts)\n\n`;
    for (let i = 0; i < scriptMarkers.length; i++) {
      const m = scriptMarkers[i];
      const nextTime = scriptMarkers[i + 1]?.time || new Date().toISOString();
      const gap = new Date(nextTime) - new Date(m.time);
      md += `- \`${m.time}\` Prompt #${i + 1} (slot: ${m.slotId})${i < scriptMarkers.length - 1 ? ` — ${(gap / 1000).toFixed(1)}s until next` : ''}\n`;
    }
    md += `\n`;
  }

  // Timeline (last 30 events)
  if (timeline.length > 0) {
    md += `## Timeline (warn+ events, last 30)\n\n`;
    const levelName = (l) => l >= 60 ? 'FATAL' : l >= 50 ? 'ERROR' : 'WARN';
    const recent = timeline.slice(-30);
    for (const t of recent) {
      md += `- \`${t.time}\` **${levelName(t.level)}** ${t.msg}\n`;
    }
    md += `\n`;
  }

  return md;
}

function writeReport() {
  const report = generateReport();
  writeFileSync(OUTPUT_PATH, report, 'utf8');
  console.log(`\n[log-watcher] Report written to ${OUTPUT_PATH}`);
  console.log(`[log-watcher] ${lineCount} lines, ${parsedCount} parsed, ${[...findings.values()].reduce((s, f) => s + f.occurrences.length, 0)} anomalies`);
}

// ── Tail implementation ───────────────────────

async function tailLog() {
  if (!existsSync(LOG_PATH)) {
    console.error(`[log-watcher] Log file not found: ${LOG_PATH}`);
    console.error(`[log-watcher] Will poll until it appears...`);
  }

  // Start from current end of file
  let position = 0;
  try {
    position = statSync(LOG_PATH).size;
    console.log(`[log-watcher] Starting from byte ${position} of ${LOG_PATH}`);
  } catch {
    console.log(`[log-watcher] Log file not yet available, will poll...`);
  }

  console.log(`[log-watcher] Monitoring started at ${new Date().toISOString()}`);
  if (MAX_DURATION_MS > 0) {
    console.log(`[log-watcher] Will auto-stop after ${MAX_DURATION_MS / 1000}s`);
  }

  const poll = () => {
    try {
      if (!existsSync(LOG_PATH)) return;
      const stat = statSync(LOG_PATH);

      // File was truncated/rotated
      if (stat.size < position) {
        console.log(`[log-watcher] Log rotated, resetting position`);
        position = 0;
      }

      if (stat.size <= position) return;

      const stream = createReadStream(LOG_PATH, { start: position, encoding: 'utf8' });
      const rl = createInterface({ input: stream, crlfDelay: Infinity });

      let newPosition = position;
      rl.on('line', (line) => {
        newPosition += Buffer.byteLength(line, 'utf8') + 1; // +1 for \n
        processLine(line);
      });

      rl.on('close', () => {
        position = stat.size; // use actual file size to avoid drift
      });
    } catch (err) {
      // File might be temporarily unavailable during rotation
    }
  };

  // Poll loop
  const interval = setInterval(poll, POLL_INTERVAL_MS);

  // Auto-stop timer
  if (MAX_DURATION_MS > 0) {
    setTimeout(() => {
      console.log(`[log-watcher] Duration limit reached, stopping...`);
      clearInterval(interval);
      writeReport();
      process.exit(0);
    }, MAX_DURATION_MS);
  }

  // Graceful shutdown
  const shutdown = () => {
    clearInterval(interval);
    writeReport();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  await new Promise(() => {});
}

tailLog();
