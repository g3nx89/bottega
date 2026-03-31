#!/usr/bin/env node
/**
 * Bottega Log Analyzer — parses pino JSON logs and produces a structured diagnostic.
 *
 * Usage: node .claude/skills/bottega-dev-debug/scripts/analyze-logs.mjs [--last N] [--json]
 *
 * Options:
 *   --last N    Only analyze the last N lines (default: all)
 *   --json      Output machine-readable JSON instead of human-readable text
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';

const { values: opts } = parseArgs({
  options: {
    last: { type: 'string', default: '0' },
    json: { type: 'boolean', default: false },
  },
});

const LOG_PATH = join(homedir(), 'Library/Logs/Bottega/app.log');
const CRASHES_DIR = join(homedir(), 'Library/Logs/Bottega/crashes');
const lastN = Number(opts.last);

function main() {
  if (!existsSync(LOG_PATH)) {
    console.error(`Log file not found: ${LOG_PATH}`);
    process.exit(1);
  }

  const raw = readFileSync(LOG_PATH, 'utf8');
  let lines = raw.split('\n').filter(l => l.trim());
  if (lastN > 0) lines = lines.slice(-lastN);

  const entries = [];
  for (const line of lines) {
    try { entries.push(JSON.parse(line)); } catch {}
  }

  // Categorize by level
  const fatals = entries.filter(e => e.level >= 60);
  const errors = entries.filter(e => e.level >= 50 && e.level < 60);
  const warns = entries.filter(e => e.level >= 40 && e.level < 50);

  // Group by message pattern
  const groupByMsg = (arr) => {
    const groups = {};
    for (const e of arr) {
      const key = e.msg || 'unknown';
      if (!groups[key]) groups[key] = { count: 0, first: e, last: e, msg: key };
      groups[key].count++;
      groups[key].last = e;
    }
    return Object.values(groups).sort((a, b) => b.count - a.count);
  };

  const fatalGroups = groupByMsg(fatals);
  const errorGroups = groupByMsg(errors);
  const warnGroups = groupByMsg(warns);

  // Check crash dumps
  let crashDumps = [];
  try {
    if (existsSync(CRASHES_DIR)) {
      crashDumps = readdirSync(CRASHES_DIR);
    }
  } catch {}

  // Most recent session info
  const lastEntry = entries[entries.length - 1];
  const lastSession = lastEntry?.sessionId || 'unknown';

  // Recent errors (last 5 with stacks)
  const recentErrors = [...fatals, ...errors]
    .sort((a, b) => (b.time || 0) - (a.time || 0))
    .slice(0, 5)
    .map(e => ({
      level: e.level >= 60 ? 'FATAL' : 'ERROR',
      msg: e.msg,
      component: e.component || 'unknown',
      time: e.time ? new Date(e.time).toISOString() : 'unknown',
      stack: e.err?.stack?.split('\n').slice(0, 4).join('\n') || null,
    }));

  const report = {
    logFile: LOG_PATH,
    totalLines: lines.length,
    parsed: entries.length,
    summary: {
      fatals: fatals.length,
      errors: errors.length,
      warnings: warns.length,
    },
    fatalPatterns: fatalGroups.map(g => ({ msg: g.msg, count: g.count })),
    errorPatterns: errorGroups.map(g => ({ msg: g.msg, count: g.count })),
    warnPatterns: warnGroups.map(g => ({ msg: g.msg, count: g.count })),
    recentErrors,
    crashDumps: crashDumps.length > 0 ? crashDumps : 'none',
    lastSession,
  };

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human-readable output
  console.log(`=== Bottega Log Analysis ===`);
  console.log(`Log: ${LOG_PATH}`);
  console.log(`Lines: ${lines.length} (parsed: ${entries.length})`);
  console.log(`\n--- Summary ---`);
  console.log(`FATAL: ${fatals.length}  |  ERROR: ${errors.length}  |  WARN: ${warns.length}`);

  if (fatalGroups.length > 0) {
    console.log(`\n--- FATAL patterns (level 60) ---`);
    for (const g of fatalGroups) {
      console.log(`  [${g.count}x] ${g.msg}`);
    }
  }

  if (errorGroups.length > 0) {
    console.log(`\n--- ERROR patterns (level 50) ---`);
    for (const g of errorGroups) {
      console.log(`  [${g.count}x] ${g.msg}`);
    }
  }

  if (warnGroups.length > 0) {
    console.log(`\n--- WARN patterns (level 40) ---`);
    for (const g of warnGroups) {
      console.log(`  [${g.count}x] ${g.msg}`);
    }
  }

  if (recentErrors.length > 0) {
    console.log(`\n--- Recent errors (newest first) ---`);
    for (const e of recentErrors) {
      console.log(`  [${e.level}] ${e.time} (${e.component}): ${e.msg}`);
      if (e.stack) {
        for (const line of e.stack.split('\n')) {
          console.log(`    ${line}`);
        }
      }
    }
  }

  console.log(`\nCrash dumps: ${crashDumps.length > 0 ? crashDumps.join(', ') : 'none'}`);
  console.log(`\n=== Done ===`);
}

main();
