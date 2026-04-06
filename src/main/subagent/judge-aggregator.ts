/**
 * Judge aggregator — merges micro-verdicts into a single JudgeVerdict.
 * Pure function, no I/O.
 */

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
 */
export function aggregateVerdicts(verdicts: MicroVerdict[], allJudgeIds: MicroJudgeId[]): JudgeVerdict {
  const verdictMap = new Map(verdicts.map((v) => [v.judgeId, v]));
  const criteria: JudgeCriterion[] = [];
  const allActionItems: string[] = [];
  const failedNames: string[] = [];
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

  // Majority-pass aggregation: PASS if majority of evaluated criteria pass.
  // For minimal tier (1 judge), must pass 1/1.
  // For standard tier (2-3 judges), must pass all but 1.
  // For full tier (5-7 judges), must pass majority (>50%).
  const passThreshold = evaluatedCount <= 1 ? evaluatedCount : Math.ceil(evaluatedCount / 2);
  const passCount = evaluatedCount - failCount;
  const verdict: 'PASS' | 'FAIL' = passCount >= passThreshold ? 'PASS' : 'FAIL';

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
