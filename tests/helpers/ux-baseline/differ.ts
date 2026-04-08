/**
 * UX baseline differ (Fase 3b) — compares a UXReview against a committed
 * UXBaseline and produces a UXDiffReport. Pure function; no IO.
 *
 * Wire contract: docs/ux-baselines.md
 * Plan reference: Fase 3 Task 3.4 in happy-marinating-sonnet.md
 *
 * Drift categories:
 *   - overall_score_drop     → regression if |delta| > rules.regressionOverall
 *   - script_score_drop      → regression if |delta| > rules.regressionScript (per-script)
 *   - dimension_score_drop   → regression if |delta| > rules.regressionDimension (per-dimension, per-script)
 *   - new_issue              → reported but not a regression by itself;
 *                              high-severity new issues contribute to count
 *   - fixed_issue            → informational (issue went away)
 *   - changed_severity       → regression only if severity escalates
 *
 * Verdict:
 *   - BASELINE_MISSING: input.baseline is null
 *   - SCHEMA_MISMATCH:  baseline.schemaVersion != current.schemaVersion
 *   - DRIFT:            any finding with category in the regression set
 *                       (overall/script/dimension drops beyond threshold,
 *                       new 'alta' issues, escalated severity)
 *   - OK:               otherwise
 */

import {
  CURRENT_UX_REVIEW_SCHEMA_VERSION,
  DEFAULT_UX_DIFF_RULES,
  UX_DIMENSION_KEYS,
  type UXBaseline,
  type UXCategory,
  type UXDiffFinding,
  type UXDiffReport,
  type UXDiffRules,
  type UXDimensionScores,
  type UXIssue,
  type UXReview,
  type UXSeverity,
} from './schema.js';

export interface DifferInput {
  baseline: UXBaseline | null;
  current: UXReview;
  rulesOverride?: UXDiffRules;
}

/** Severity order used to detect escalation. */
const SEVERITY_ORDER: Record<UXSeverity, number> = {
  bassa: 0,
  media: 1,
  alta: 2,
};

export function diffUXReview(input: DifferInput): UXDiffReport {
  const current = input.current;

  if (input.baseline === null) {
    return {
      baselineRunId: '(none)',
      baselineTimestamp: '(none)',
      currentRunId: current.runId,
      currentTimestamp: current.timestamp,
      verdict: 'BASELINE_MISSING',
      overallDelta: 0,
      findings: [],
      summary: { newIssues: 0, fixedIssues: 0, changedSeverity: 0, regressionCount: 0 },
    };
  }

  if (input.baseline.schemaVersion !== CURRENT_UX_REVIEW_SCHEMA_VERSION) {
    return {
      baselineRunId: input.baseline.runId,
      baselineTimestamp: input.baseline.timestamp,
      currentRunId: current.runId,
      currentTimestamp: current.timestamp,
      verdict: 'SCHEMA_MISMATCH',
      overallDelta: 0,
      findings: [],
      summary: { newIssues: 0, fixedIssues: 0, changedSeverity: 0, regressionCount: 0 },
    };
  }

  const baseline = input.baseline;
  const rules = input.rulesOverride ?? DEFAULT_UX_DIFF_RULES;
  const findings: UXDiffFinding[] = [];

  // ── 1. Overall score drop ─────────────────────────────────────────
  const overallDelta = round2(current.overallScore - baseline.overallScore);
  if (overallDelta < 0 && Math.abs(overallDelta) > rules.regressionOverall) {
    findings.push({
      category: 'overall_score_drop',
      baseline: baseline.overallScore,
      current: current.overallScore,
      delta: overallDelta,
      message: `overall score dropped ${overallDelta.toFixed(2)} (baseline ${baseline.overallScore.toFixed(2)} → current ${current.overallScore.toFixed(2)}, threshold ${rules.regressionOverall})`,
    });
  }

  // ── 2. Per-script score drops + dimension drops ──────────────────
  for (const [scriptKey, baselineScript] of Object.entries(baseline.scriptScores)) {
    const currentScript = current.scriptScores[scriptKey];
    if (!currentScript) {
      // Script dropped from current run — that's a test coverage regression,
      // not a UX one. Report it as info via new_issue channel is misleading,
      // so skip. (The runtime baseline differ catches step count changes.)
      continue;
    }
    const scriptDelta = round2(currentScript.score - baselineScript.score);
    if (scriptDelta < 0 && Math.abs(scriptDelta) > rules.regressionScript) {
      findings.push({
        category: 'script_score_drop',
        script: scriptKey,
        baseline: baselineScript.score,
        current: currentScript.score,
        delta: scriptDelta,
        message: `${scriptKey} score dropped ${scriptDelta.toFixed(2)} (${baselineScript.score.toFixed(2)} → ${currentScript.score.toFixed(2)}, threshold ${rules.regressionScript})`,
      });
    }

    // Per-dimension checks
    for (const dim of UX_DIMENSION_KEYS) {
      const b = baselineScript.dimensionScores[dim as keyof UXDimensionScores];
      const c = currentScript.dimensionScores[dim as keyof UXDimensionScores];
      const dimDelta = round2(c - b);
      if (dimDelta < 0 && Math.abs(dimDelta) > rules.regressionDimension) {
        findings.push({
          category: 'dimension_score_drop',
          script: scriptKey,
          dimension: dim,
          baseline: b,
          current: c,
          delta: dimDelta,
          message: `${scriptKey}.${dim} dropped ${dimDelta.toFixed(2)} (${b.toFixed(2)} → ${c.toFixed(2)}, threshold ${rules.regressionDimension})`,
        });
      }
    }
  }

  // ── 3. Issue diff: new / fixed / changed severity ────────────────
  const baselineIssues = new Map(baseline.issues.map((i) => [i.id, i]));
  const currentIssues = new Map(current.issues.map((i) => [i.id, i]));

  // New issues: in current but not baseline
  for (const [id, issue] of currentIssues) {
    if (!baselineIssues.has(id)) {
      findings.push({
        category: 'new_issue',
        issueId: id,
        severity: issue.severity,
        message: `new ${issue.severity} issue in ${issue.script} (${issue.category}): ${issue.description.slice(0, 120)}`,
      });
    }
  }
  // Fixed issues: in baseline but not current
  for (const [id, issue] of baselineIssues) {
    if (!currentIssues.has(id)) {
      findings.push({
        category: 'fixed_issue',
        issueId: id,
        severity: issue.severity,
        message: `fixed: ${issue.severity} issue in ${issue.script} no longer reported (${issue.description.slice(0, 120)})`,
      });
    }
  }
  // Changed severity: in both, different severity
  for (const [id, currentIssue] of currentIssues) {
    const baselineIssue = baselineIssues.get(id);
    if (!baselineIssue) continue;
    if (baselineIssue.severity !== currentIssue.severity) {
      findings.push({
        category: 'changed_severity',
        issueId: id,
        severity: currentIssue.severity,
        message: `severity ${baselineIssue.severity} → ${currentIssue.severity} on ${currentIssue.script}: ${currentIssue.description.slice(0, 120)}`,
      });
    }
  }

  // ── 4. Verdict ────────────────────────────────────────────────────
  // Regression = score drops beyond threshold + new 'alta' issues + escalated severity.
  // New bassa/media issues are noisy (reviewer variance), so they don't
  // trip the verdict by themselves — they still appear in the report.
  const regressionCount = findings.filter((f) => {
    if (
      f.category === 'overall_score_drop' ||
      f.category === 'script_score_drop' ||
      f.category === 'dimension_score_drop'
    ) {
      return true;
    }
    if (f.category === 'new_issue' && f.severity === 'alta') return true;
    if (f.category === 'changed_severity' && f.issueId && f.severity) {
      const before = baselineIssues.get(f.issueId);
      if (!before) return false;
      return SEVERITY_ORDER[f.severity] > SEVERITY_ORDER[before.severity];
    }
    return false;
  }).length;

  const newIssuesCount = findings.filter((f) => f.category === 'new_issue').length;
  const fixedIssuesCount = findings.filter((f) => f.category === 'fixed_issue').length;
  const changedSeverityCount = findings.filter((f) => f.category === 'changed_severity').length;

  return {
    baselineRunId: baseline.runId,
    baselineTimestamp: baseline.timestamp,
    currentRunId: current.runId,
    currentTimestamp: current.timestamp,
    verdict: regressionCount > 0 ? 'DRIFT' : 'OK',
    overallDelta,
    findings,
    summary: {
      newIssues: newIssuesCount,
      fixedIssues: fixedIssuesCount,
      changedSeverity: changedSeverityCount,
      regressionCount,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Stable ID computation (for producer side) ─────────────────────

/**
 * Compute a stable UX-<sha1[:8]> ID from (script, step, description).
 * The Pass 2 ux-reviewer prompt asks the LLM to emit these IDs directly,
 * but we export the function so tests and tooling can verify/regenerate.
 *
 * Note: uses a lightweight hash because the LLM can't run crypto libs in
 * the prompt. The ux-reviewer prompt supplies pre-computed hashes inline
 * when determinism across runs matters.
 */
export function computeUXIssueId(script: string, step: string, description: string): string {
  const input = `${script}|${step}|${description.trim().toLowerCase()}`;
  // FNV-1a 32-bit → hex; collision domain is per-baseline (N~20 issues),
  // so 8 hex chars is plenty. Not cryptographic; that's not the threat model.
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Two rounds → 8 hex chars stable across platforms.
  let hash2 = 0x811c9dc5;
  for (let i = input.length - 1; i >= 0; i--) {
    hash2 ^= input.charCodeAt(i);
    hash2 = Math.imul(hash2, 0x01000193);
  }
  const hex = ((hash >>> 0).toString(16).padStart(4, '0') + (hash2 >>> 0).toString(16).padStart(4, '0')).slice(0, 8);
  return `UX-${hex}`;
}

// Re-export for consumers that only import differ.
export type { UXCategory, UXIssue };
