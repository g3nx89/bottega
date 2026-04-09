#!/usr/bin/env node
/**
 * UX Baseline CLI (Fase 3b) — validates UX review JSON output from Pass 2
 * and diffs it against a committed UX baseline. Pure orchestration; the
 * heavy lifting lives in tests/helpers/ux-baseline/{schema,differ}.ts.
 *
 * Usage:
 *   # Validate a UX review JSON against the schema (no baseline needed)
 *   node ux-baseline-cli.mjs validate /tmp/bottega-qa/ux-review.json
 *
 *   # Diff current review against committed baseline
 *   node ux-baseline-cli.mjs diff /tmp/bottega-qa/ux-review.json
 *
 *   # Bootstrap: promote a review to the baseline
 *   node ux-baseline-cli.mjs record /tmp/bottega-qa/ux-review.json
 *
 * Exit codes:
 *   0 = success / no drift
 *   1 = drift detected or validation error
 *   2 = baseline missing
 *
 * Baseline lives at tests/qa-scripts/baselines/ux-baseline.json (versioned).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { loadUxBaseline } from './qa-baseline-loader.mjs';

const PROJECT_DIR = process.env.BOTTEGA_PROJECT_DIR || '/Users/afato/Projects/bottega';
const BASELINE_PATH = join(PROJECT_DIR, 'tests/qa-scripts/baselines/ux-baseline.json');

function usage() {
  console.error('Usage:');
  console.error('  ux-baseline-cli.mjs validate <review.json>');
  console.error('  ux-baseline-cli.mjs diff     <review.json>');
  console.error('  ux-baseline-cli.mjs record   <review.json>');
  process.exit(1);
}

const [, , command, reviewPath] = process.argv;
if (!command || !reviewPath) usage();
if (!['validate', 'diff', 'record'].includes(command)) usage();
if (!existsSync(reviewPath)) {
  console.error(`Error: review file not found: ${reviewPath}`);
  process.exit(1);
}

let review;
try {
  review = JSON.parse(readFileSync(reviewPath, 'utf8'));
} catch (err) {
  console.error(`Error: invalid JSON in ${reviewPath}: ${err.message}`);
  process.exit(1);
}

function printFinding(f) {
  const tag = {
    overall_score_drop: '✖ overall',
    script_score_drop: '✖ script',
    dimension_score_drop: '✖ dimension',
    new_issue: '+ new',
    fixed_issue: '- fixed',
    changed_severity: '~ severity',
  }[f.category] ?? '•';
  console.log(`  ${tag}: ${f.message}`);
}

async function cmdValidate() {
  const { schemaModule } = await loadUxBaseline();
  const { Value } = await import('@sinclair/typebox/value');
  const errors = [...Value.Errors(schemaModule.UXReview, review)];
  if (errors.length === 0) {
    console.log(`✓ ${reviewPath} is a valid UXReview (schemaVersion ${review.schemaVersion})`);
    process.exit(0);
  }
  console.error(`✖ ${reviewPath} has ${errors.length} schema violation(s):`);
  for (const e of errors.slice(0, 20)) {
    console.error(`  ${e.path || '/'}: ${e.message}`);
  }
  if (errors.length > 20) console.error(`  ... and ${errors.length - 20} more`);
  process.exit(1);
}

async function cmdDiff() {
  const { schemaModule, differModule } = await loadUxBaseline();
  const { Value } = await import('@sinclair/typebox/value');

  // Validate the current review first — diffing garbage is worse than no diff.
  if (!Value.Check(schemaModule.UXReview, review)) {
    console.error('✖ current review is not a valid UXReview — run validate first');
    process.exit(1);
  }

  const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null;
  const report = differModule.diffUXReview({ baseline, current: review });

  console.log(`UX drift verdict: ${report.verdict}`);
  console.log(`  overall delta: ${report.overallDelta.toFixed(2)}`);
  console.log(
    `  summary: ${report.summary.regressionCount} regression(s), ${report.summary.newIssues} new, ${report.summary.fixedIssues} fixed, ${report.summary.changedSeverity} severity changes`,
  );
  for (const f of report.findings) printFinding(f);

  // Emit report JSON next to the input for tooling pipelines.
  const reportPath = join(dirname(reviewPath), 'ux-drift.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`  -> ${reportPath}`);

  if (report.verdict === 'BASELINE_MISSING') process.exit(2);
  if (report.verdict === 'DRIFT') process.exit(1);
  process.exit(0);
}

async function cmdRecord() {
  const { schemaModule } = await loadUxBaseline();
  const { Value } = await import('@sinclair/typebox/value');
  if (!Value.Check(schemaModule.UXReview, review)) {
    console.error('✖ cannot record: review is not a valid UXReview — run validate first');
    process.exit(1);
  }
  mkdirSync(dirname(BASELINE_PATH), { recursive: true });
  writeFileSync(BASELINE_PATH, `${JSON.stringify(review, null, 2)}\n`, 'utf8');
  console.log(`✓ UX baseline recorded at ${BASELINE_PATH}`);
  console.log(`  overall ${review.overallScore.toFixed(2)}, ${review.issues.length} issue(s), ${Object.keys(review.scriptScores).length} script(s)`);
  process.exit(0);
}

try {
  if (command === 'validate') await cmdValidate();
  else if (command === 'diff') await cmdDiff();
  else if (command === 'record') await cmdRecord();
} catch (err) {
  console.error('[ux-baseline-cli] error:', err.message);
  console.error(err.stack);
  process.exit(1);
}
