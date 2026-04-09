#!/usr/bin/env node
/**
 * Baseline CLI (Fase 3) — orchestrator for runtime baseline recording
 * and drift detection. Spawns qa-runner.mjs internally, collects its
 * metadata JSON output, and calls recorder/differ via qa-baseline-loader.
 *
 * Usage:
 *   # Record a new baseline (runs qa-runner N times, aggregates, commits JSON)
 *   node baseline-cli.mjs record --script 02 --runs 5
 *
 *   # Diff a single run against the committed baseline
 *   node baseline-cli.mjs diff --script 02
 *
 * Exit codes:
 *   0 = success / no drift
 *   1 = drift detected or command error
 *   2 = baseline missing
 *
 * Pre-reqs: BOTTEGA_AGENT_TEST=1 build (for metricsBefore/After capture).
 * Script files resolve from tests/qa-scripts/.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { loadRecorder, loadDiffer } from './qa-baseline-loader.mjs';

const PROJECT_DIR = process.env.BOTTEGA_PROJECT_DIR || '/Users/afato/Projects/bottega';
const QA_RUNNER = join(PROJECT_DIR, '.claude/skills/bottega-dev-debug/scripts/qa-runner.mjs');
const BASELINES_DIR = join(PROJECT_DIR, 'tests/qa-scripts/baselines');
const QA_OUTPUT = '/tmp/bottega-qa';

function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PROJECT_DIR, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function usage() {
  console.error('Usage:');
  console.error('  baseline-cli.mjs record --script NN [--script NN] [--runs 5]');
  console.error('  baseline-cli.mjs diff   --script NN [--script NN]');
  process.exit(1);
}

const [, , command, ...rest] = process.argv;
if (!command || !['record', 'diff'].includes(command)) usage();

const { values: opts } = parseArgs({
  args: rest,
  options: {
    script: { type: 'string', multiple: true, default: [] },
    runs: { type: 'string', default: '5' },
    reuse: { type: 'boolean', default: false },
    'skip-probe': { type: 'boolean', default: false },
  },
});

if (opts.script.length === 0) usage();
const scripts = opts.script.map((s) => s.padStart(2, '0'));
const runs = Number.parseInt(opts.runs, 10);
if (command === 'record' && (!Number.isFinite(runs) || runs < 1)) {
  console.error('--runs must be a positive integer');
  process.exit(1);
}

function runQaRunnerOnce(scriptNum) {
  // Delegate to qa-runner for a single script. --output stays fixed so we
  // know where to read metadata from.
  console.log(`  [run] qa-runner --script ${scriptNum}`);
  const res = spawnSync(
    process.execPath,
    [QA_RUNNER, '--script', scriptNum, '--output', QA_OUTPUT, ...(opts.reuse ? ['--reuse'] : []), '--skip-probe'],
    {
      stdio: ['inherit', 'inherit', 'inherit'],
      env: process.env,
    },
  );
  // qa-runner's exit code reflects Pass 1 PASS/FAIL. For baseline recording
  // we tolerate FAIL — the metric deltas are still meaningful. For diff mode
  // we proceed and let the drift check flag it.
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(`qa-runner crashed for script ${scriptNum} (exit ${res.status})`);
  }
  const metadataPath = join(QA_OUTPUT, `${scriptNum}-metadata.json`);
  if (!existsSync(metadataPath)) {
    throw new Error(`qa-runner did not produce ${metadataPath}`);
  }
  return JSON.parse(readFileSync(metadataPath, 'utf8'));
}

async function cmdRecord() {
  const { recordBaseline } = await loadRecorder();
  const appVersion = readPackageVersion();

  mkdirSync(BASELINES_DIR, { recursive: true });

  for (const scriptNum of scripts) {
    console.log(`[baseline-cli] record ${scriptNum}: ${runs} runs`);
    const runMetadata = [];
    for (let i = 0; i < runs; i++) {
      console.log(`  run ${i + 1}/${runs}`);
      const metadata = runQaRunnerOnce(scriptNum);
      runMetadata.push(metadata);
    }

    const baseline = recordBaseline(runMetadata, {
      script: detectScriptName(scriptNum, runMetadata[0]),
      appVersion,
    });
    const baselineFile = join(BASELINES_DIR, `${scriptNum}-${baseline.script.replace(/^\d+-/, '')}.baseline.json`);
    writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`  -> ${baselineFile}`);
  }
  console.log('[baseline-cli] record complete');
}

async function cmdDiff() {
  const { diffRun } = await loadDiffer();
  mkdirSync(QA_OUTPUT, { recursive: true });

  let anyDrift = false;
  let anyMissing = false;

  for (const scriptNum of scripts) {
    console.log(`[baseline-cli] diff ${scriptNum}`);
    const metadata = runQaRunnerOnce(scriptNum);

    // Find a baseline file matching this script number.
    const baselineFile = findBaselineFile(scriptNum);
    let baseline = null;
    if (baselineFile && existsSync(baselineFile)) {
      baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
    }

    const report = diffRun({ baseline, run: metadata });
    const reportPath = join(QA_OUTPUT, `${scriptNum}-drift.json`);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    printReportSummary(report);
    console.log(`  -> ${reportPath}`);

    if (report.verdict === 'BASELINE_MISSING') anyMissing = true;
    if (report.verdict === 'DRIFT') anyDrift = true;
  }

  if (anyMissing) process.exit(2);
  if (anyDrift) process.exit(1);
}

function detectScriptName(scriptNum, firstMetadata) {
  // qa-runner writes stepMeta.script as "NN-<name>". Extract the tail.
  const raw = firstMetadata?.[0]?.script ?? `${scriptNum}-unknown`;
  // "02-02-happy-path" → "02-happy-path" (qa-runner double-prefixes).
  return raw.replace(/^\d+-/, '');
}

function findBaselineFile(scriptNum) {
  try {
    const entries = readdirSync(BASELINES_DIR);
    const match = entries.find((e) => e.startsWith(`${scriptNum}-`) && e.endsWith('.baseline.json'));
    return match ? join(BASELINES_DIR, match) : null;
  } catch {
    return null;
  }
}

function printReportSummary(report) {
  console.log(`  verdict: ${report.verdict}`);
  console.log(`  steps: ${report.summary.driftedSteps}/${report.summary.totalSteps} drifted, ${report.summary.newFindings} regression finding(s)`);
  for (const step of report.steps) {
    if (step.verdict === 'OK' || step.verdict === 'SKIPPED_MANUAL') continue;
    console.log(`  [${step.stepNumber}] ${step.stepTitle} — ${step.findings.length} finding(s)`);
    for (const f of step.findings) {
      const tag = f.severity === 'regression' ? '✖' : f.severity === 'warning' ? '⚠' : 'i';
      console.log(`    ${tag} ${f.category}${f.path ? ` (${f.path})` : ''}: ${f.rule}`);
    }
  }
}

// Entry
(async () => {
  try {
    if (command === 'record') await cmdRecord();
    else if (command === 'diff') await cmdDiff();
  } catch (err) {
    console.error('[baseline-cli] error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
