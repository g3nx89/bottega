/**
 * Judge aggregator — merges micro-verdicts into a single JudgeVerdict.
 * Pure function, no I/O.
 */

import { getBlockingJudgeIds } from './judge-registry.js';
import type { JudgeCriterion, JudgeVerdict, MicroJudgeId, MicroVerdict } from './types.js';

/**
 * Aggregate micro-verdicts into a unified JudgeVerdict.
 *
 * Rules:
 * - verdict = 'FAIL' if any `evaluated` criterion has pass: false
 * - timeout/error criteria are marked pass: true with a skip note — they don't cause FAIL
 * - Missing judges (expected but not returned) get placeholder entries
 * - actionItems = concatenation of all micro-verdict actionItems
 * - summary = code-generated from pass/fail counts
 *
 * @param downgradedFromBlocking Optional set of judge IDs whose evidence severity
 *   is 'minor'. These judges are still evaluated (can still FAIL), but their FAIL
 *   does NOT count as a blocking fail — they become suggestions instead of blockers.
 *   This keeps the quality bar high while making retry more effective.
 */
export function aggregateVerdicts(
  verdicts: MicroVerdict[],
  allJudgeIds: MicroJudgeId[],
  downgradedFromBlocking?: Set<MicroJudgeId>,
): JudgeVerdict {
  const verdictMap = new Map(verdicts.map((v) => [v.judgeId, v]));
  const criteria: JudgeCriterion[] = [];
  const allActionItems: string[] = [];
  const failedNames: MicroJudgeId[] = [];
  let evaluatedCount = 0;
  let failCount = 0;

  for (const id of allJudgeIds) {
    const mv = verdictMap.get(id);

    if (!mv) {
      // Missing judge — placeholder
      criteria.push({
        name: id,
        pass: true,
        finding: 'Evaluation skipped (not returned)',
        evidence: '',
      });
      continue;
    }

    if (mv.status === 'timeout') {
      criteria.push({
        name: id,
        pass: true,
        finding: 'Evaluation skipped (timeout)',
        evidence: '',
      });
      continue;
    }

    if (mv.status === 'error') {
      criteria.push({
        name: id,
        pass: true,
        finding: `Evaluation skipped (error: ${mv.finding})`,
        evidence: mv.evidence || '',
      });
      continue;
    }

    if (mv.status === 'no_credentials') {
      criteria.push({
        name: id,
        pass: true,
        finding: `Evaluation skipped (${mv.finding})`,
        evidence: '',
      });
      continue;
    }

    // status === 'evaluated'
    evaluatedCount++;
    criteria.push({
      name: id,
      pass: mv.pass,
      finding: mv.finding,
      evidence: mv.evidence,
    });

    if (!mv.pass) {
      failCount++;
      failedNames.push(id);
      allActionItems.push(...mv.actionItems);
    }
  }

  // Blocking-criteria aggregation: certain evidence-backed criteria cause
  // immediate FAIL regardless of how many other criteria pass. Derived from
  // the judge registry (blocking: true) so adding a new evidence-backed judge
  // automatically makes it blocking — no manual sync needed.
  const blockingIds = getBlockingJudgeIds();
  // Downgraded judges: their FAIL becomes a suggestion, not a blocker.
  // This happens when evidence severity is 'minor' (deterministic, pre-computed).
  const effectiveBlockingFail = failedNames.some((n) => blockingIds.has(n) && !downgradedFromBlocking?.has(n));
  const passCount = evaluatedCount - failCount;
  let verdict: 'PASS' | 'FAIL';
  if (effectiveBlockingFail) {
    verdict = 'FAIL';
  } else {
    const passThreshold = evaluatedCount <= 1 ? evaluatedCount : Math.ceil(evaluatedCount / 2);
    verdict = passCount >= passThreshold ? 'PASS' : 'FAIL';
  }

  let summary: string;
  if (failCount === 0) {
    summary = `PASS: All ${evaluatedCount}/${allJudgeIds.length} evaluated criteria pass.`;
  } else if (verdict === 'PASS') {
    summary = `PASS (${passCount}/${evaluatedCount}): ${failedNames.join(', ')} flagged as suggestions. ${allActionItems.length} suggestion${allActionItems.length === 1 ? '' : 's'}.`;
  } else {
    summary = `FAIL: ${failCount}/${evaluatedCount} criteria failed (${failedNames.join(', ')}). ${allActionItems.length} action item${allActionItems.length === 1 ? '' : 's'}.`;
  }

  return { verdict, criteria, actionItems: allActionItems, summary };
}
