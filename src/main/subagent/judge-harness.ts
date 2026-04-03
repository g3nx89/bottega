/**
 * Judge harness — auto-triggers a judge subagent after mutating turns.
 * Supports auto-retry: FAIL → feed action items to parent → re-judge.
 */

import { createChildLogger } from '../../figma/logger.js';
import type { AgentInfra } from '../agent.js';
import { categorizeToolName } from '../compression/metrics.js';
import { isMutationTool } from '../compression/mutation-compressor.js';
import type { ScopedConnector } from '../scoped-connector.js';
import type { SessionSlot } from '../slot-manager.js';
import type { SubagentSettings } from './config.js';
import { runSubagentBatch } from './orchestrator.js';
import type { JudgeVerdict, SubagentProgressEvent } from './types.js';

const log = createChildLogger({ component: 'judge-harness' });

const DEFAULT_JUDGE_TIMEOUT_MS = 90_000;

/** Prefix marker for judge retry prompts — filtered out by extractRenderableMessages. */
export const JUDGE_RETRY_MARKER = '[JUDGE_RETRY]';

/** Active judge sessions — keyed by slotId for external abort. */
const activeJudges = new Map<string, { controller: AbortController }>();

/** Abort any active judge for a given slot. No-op if none running. */
export function abortActiveJudge(slotId: string): void {
  const active = activeJudges.get(slotId);
  if (active) {
    active.controller.abort();
    activeJudges.delete(slotId);
    log.info({ slotId }, 'Active judge aborted');
  }
}

export interface JudgeHarnessCallbacks {
  onProgress: (event: SubagentProgressEvent) => void;
  onVerdict: (verdict: JudgeVerdict, attempt: number, maxAttempts: number) => void;
  onRetryStart: (attempt: number, maxAttempts: number) => void;
}

/**
 * Run the judge harness after a mutating turn.
 *
 * Returns the final verdict, or null if skipped/aborted/timed out.
 *
 * Flow:
 * 1. Check preconditions (judgeMode, mutations)
 * 2. Run judge subagent
 * 3. If FAIL + autoRetry: feed action items to parent, re-judge
 * 4. Return final verdict
 */
export async function runJudgeHarness(
  infra: AgentInfra,
  connector: ScopedConnector,
  slot: SessionSlot,
  settings: SubagentSettings,
  turnToolNames: string[],
  parentSignal: AbortSignal,
  callbacks: JudgeHarnessCallbacks,
): Promise<JudgeVerdict | null> {
  // Precondition: judge mode must be 'auto'
  if (settings.judgeMode !== 'auto') return null;

  // Precondition: turn must have mutations or DS-category tools (e.g. figma_setup_tokens, figma_bind_variable)
  const hasMutations = turnToolNames.some((t) => isMutationTool(t) || categorizeToolName(t) === 'ds');
  if (!hasMutations) return null;

  // Prevent concurrent judges on the same slot
  if (activeJudges.has(slot.id)) {
    log.warn({ slotId: slot.id }, 'Judge already running on this slot — skipping');
    return null;
  }

  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal, AbortSignal.timeout(DEFAULT_JUDGE_TIMEOUT_MS)]);
  activeJudges.set(slot.id, { controller });

  // maxRetries is the number of retries after the initial attempt (e.g. maxRetries=2 → 3 total attempts)
  const maxAttempts = settings.autoRetry ? 1 + Math.max(0, settings.maxRetries) : 1;
  let lastVerdict: JudgeVerdict | null = null;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) break;

      const claim =
        attempt === 1
          ? `The agent just completed a turn with these tools: ${[...new Set(turnToolNames)].join(', ')}`
          : `The agent attempted to fix issues from the previous judge verdict. Previous action items: ${lastVerdict?.actionItems.join('; ')}`;

      const batchResult = await runSubagentBatch(
        infra,
        connector,
        [
          {
            role: 'judge',
            context: {
              task: "Evaluate the current state of the Figma file after the agent's modifications.",
              claim,
            },
          },
        ],
        settings,
        `judge-${slot.id}`,
        signal,
        callbacks.onProgress,
      );

      if (batchResult.aborted || signal.aborted) break;

      const judgeResult = batchResult.results[0];
      if (!judgeResult || judgeResult.status !== 'completed' || !judgeResult.verdict) {
        log.warn({ attempt, slotId: slot.id }, 'Judge returned no verdict');
        break;
      }

      lastVerdict = judgeResult.verdict;
      callbacks.onVerdict(lastVerdict, attempt, maxAttempts);

      if (lastVerdict.verdict === 'PASS') {
        log.info({ slotId: slot.id, attempt }, 'Judge PASS');
        break;
      }

      // FAIL — create remediation tasks in the slot's TaskStore
      if (slot.taskStore && lastVerdict.actionItems.length > 0) {
        for (const item of lastVerdict.actionItems) {
          slot.taskStore.create(item, `Judge remediation (attempt ${attempt})`, undefined, {
            source: 'judge',
            judgeAttempt: attempt,
          });
        }
      }

      // FAIL — retry if enabled and attempts remain
      if (settings.autoRetry && attempt < maxAttempts) {
        log.info({ slotId: slot.id, attempt, maxAttempts }, 'Judge FAIL — retrying');
        callbacks.onRetryStart(attempt + 1, maxAttempts);

        // Build retry prompt from action items. Prefix with marker so extractRenderableMessages can filter it out.
        const retryPrompt = `[JUDGE_RETRY]\nThe quality judge found issues. Please fix:\n${lastVerdict.actionItems.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\nAfter fixing, take a screenshot to verify.`;

        try {
          await slot.session.prompt(retryPrompt);
        } catch (err: unknown) {
          if (signal.aborted) break;
          log.error({ err, slotId: slot.id }, 'Parent agent failed during retry');
          break;
        }
      }
    }
  } catch (err: unknown) {
    if ((err as Error)?.name !== 'AbortError') {
      log.error({ err, slotId: slot.id }, 'Judge harness error');
    }
  } finally {
    activeJudges.delete(slot.id);
  }

  return lastVerdict;
}
