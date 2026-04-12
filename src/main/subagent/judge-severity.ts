/**
 * Evidence-based severity classification for micro-judge findings.
 *
 * Judges evaluate honestly (PASS/FAIL), but the harness uses severity to decide
 * whether a FAIL should BLOCK the overall verdict or appear as a SUGGESTION.
 *
 * Design principle: the judge criteria stay strict — severity controls the
 * meta-system behavior (blocking vs suggesting), not the evaluation itself.
 * This keeps the quality bar HIGH while making retry more effective: the agent
 * fixes ONE major issue well instead of three issues poorly.
 *
 * Severity is computed from deterministic evidence (pre-computed numbers),
 * never from LLM output. This guarantees reproducibility.
 */

import type { JudgeEvidence } from './judge-evidence.js';
import type { MicroJudgeId } from './types.js';

export type EvidenceSeverity = 'major' | 'minor';

// ── Thresholds ────────────────────────────────────────────────────────

/** Alignment: offsets beyond this are definitely a bug, not intentional stagger. */
const ALIGNMENT_MAJOR_PX = 8;

/** Typography: designs with this many text nodes MUST have hierarchy. */
const TYPOGRAPHY_MAJOR_TEXT_COUNT = 4;

/** Consistency: deviations beyond this across same-role siblings are clearly wrong. */
const CONSISTENCY_MAJOR_PX = 4;

/** Naming: this many auto-generated structural names signals systematic neglect. */
const NAMING_MAJOR_AUTO_COUNT = 3;

/** Naming: this many containers without auto-layout signals structural debt. */
const NAMING_MAJOR_NO_LAYOUT_COUNT = 2;

// ── Main function ─────────────────────────────────────────────────────

/**
 * Classify the severity of a judge's evidence findings.
 *
 * Returns `null` when:
 * - The judge has no evidence-backed criterion (e.g. completeness, design_quality)
 * - The evidence is null (plugin disconnected — keep default blocking behavior)
 * - The evidence shows no issue (verdict is 'ok'/'aligned'/'consistent'/etc.)
 *
 * When non-null, the harness uses severity to decide blocking behavior:
 * - 'major' → stays blocking → triggers retry
 * - 'minor' → downgraded to non-blocking → becomes a suggestion
 */
export function computeEvidenceSeverity(
  judgeId: MicroJudgeId,
  evidence: JudgeEvidence | null,
): EvidenceSeverity | null {
  if (!evidence) return null;

  switch (judgeId) {
    case 'alignment': {
      if (evidence.alignment.verdict !== 'misaligned') return null;
      if (evidence.alignment.findings.length === 0) return null;
      const maxDev = Math.max(...evidence.alignment.findings.map((f) => f.maxDeviation));
      return maxDev > ALIGNMENT_MAJOR_PX ? 'major' : 'minor';
    }

    case 'visual_hierarchy': {
      if (evidence.visual_hierarchy.verdict !== 'flat') return null;
      return evidence.visual_hierarchy.textCount >= TYPOGRAPHY_MAJOR_TEXT_COUNT ? 'major' : 'minor';
    }

    case 'consistency': {
      if (evidence.consistency.verdict !== 'inconsistent') return null;
      if (evidence.consistency.findings.length === 0) return null;
      const maxDev = Math.max(
        ...evidence.consistency.findings.map((f) => Math.max(...f.values) - Math.min(...f.values)),
      );
      return maxDev > CONSISTENCY_MAJOR_PX ? 'major' : 'minor';
    }

    case 'naming': {
      if (evidence.naming.verdict === 'ok' || evidence.naming.verdict === 'insufficient_data') return null;
      const autoCount = evidence.naming.autoNamedFrames.length;
      const noLayoutCount = evidence.naming.framesWithoutAutoLayout.length;
      return autoCount >= NAMING_MAJOR_AUTO_COUNT || noLayoutCount >= NAMING_MAJOR_NO_LAYOUT_COUNT ? 'major' : 'minor';
    }

    // Non-evidence judges: no severity classification
    case 'token_compliance':
    case 'completeness':
    case 'componentization':
    case 'design_quality':
      return null;

    default:
      return null;
  }
}

/**
 * Compute the set of judge IDs that should be downgraded from blocking to
 * non-blocking based on evidence severity. These judges still evaluate
 * (and may FAIL), but their FAIL appears as a suggestion, not a blocker.
 */
export function computeDowngradedJudges(
  activeJudgeIds: MicroJudgeId[],
  evidence: JudgeEvidence | null,
): Set<MicroJudgeId> {
  const downgraded = new Set<MicroJudgeId>();
  for (const id of activeJudgeIds) {
    const severity = computeEvidenceSeverity(id, evidence);
    if (severity === 'minor') {
      downgraded.add(id);
    }
  }
  return downgraded;
}
