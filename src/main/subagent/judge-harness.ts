/**
 * Judge harness — auto-triggers micro-judges after mutating turns.
 * Supports auto-retry with selective re-evaluation of failed criteria only.
 */

import { createChildLogger } from '../../figma/logger.js';
import type { AgentInfra } from '../agent.js';
import { categorizeToolName } from '../compression/metrics.js';
import type { ScopedConnector } from '../scoped-connector.js';
import type { SessionSlot } from '../slot-manager.js';
import type { SubagentSettings } from './config.js';
import { prefetchForMicroJudges } from './context-prefetch.js';
import { aggregateVerdicts } from './judge-aggregator.js';
import { getActiveJudges, getDataNeedsForJudges } from './judge-registry.js';
import { runMicroJudgeBatch } from './orchestrator.js';
import { createReadOnlyTools } from './read-only-tools.js';
import type {
  ActivationTier,
  JudgeVerdict,
  MicroJudgeId,
  MicroVerdict,
  PrefetchedContext,
  SubagentProgressEvent,
} from './types.js';

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

/** Read-only tool categories that do NOT trigger the judge. */
export const READ_ONLY_CATEGORIES = new Set(['discovery', 'screenshot', 'task', 'other']);

/** Structural tools that trigger the 'full' judge tier. */
const STRUCTURAL_TOOLS = new Set([
  'figma_create_child',
  'figma_clone',
  'figma_delete',
  'figma_instantiate',
  'figma_render_jsx',
  'figma_create_icon',
]);

/**
 * Determine activation tier based on tools used in the turn.
 * - full: structural mutations (create, clone, delete, execute, instantiate, jsx)
 * - visual: styling/typography/layout mutations
 * - narrow: rename or token-only changes
 */
/** Mutation tools that only affect naming — route to narrow tier, not visual. */
const NAMING_ONLY_TOOLS = new Set(['figma_rename']);

export function determineTier(turnToolNames: string[]): ActivationTier {
  let hasVisual = false;
  for (const t of turnToolNames) {
    const cat = categorizeToolName(t);
    if (cat === 'execute' || STRUCTURAL_TOOLS.has(t)) return 'full';
    if (NAMING_ONLY_TOOLS.has(t)) continue; // Don't count rename as visual
    if (cat === 'mutation' || cat === 'ds') hasVisual = true;
  }
  // If we only had naming-only tools (and no visual mutations), use narrow
  if (!hasVisual && turnToolNames.some((t) => NAMING_ONLY_TOOLS.has(t))) return 'narrow';
  return hasVisual ? 'visual' : 'narrow';
}

/**
 * Run the judge harness after a mutating turn.
 *
 * Returns the final verdict, or null if skipped/aborted/timed out.
 *
 * Flow:
 * 1. Check preconditions (fail-safe: trigger for everything except read-only)
 * 2. Determine tier → get active judges
 * 3. Selective prefetch → run micro-judges in parallel
 * 4. Aggregate → if FAIL + autoRetry, selective retry of failed judges only
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
  // Check judgeOverride on slot (toggle control)
  if (slot.judgeOverride === false) return null;
  if (slot.judgeOverride !== true && settings.judgeMode !== 'auto') return null;

  // Fail-safe precondition: trigger for everything except pure read-only turns
  const hasMutations = turnToolNames.some((t) => !READ_ONLY_CATEGORIES.has(categorizeToolName(t)));
  if (!hasMutations) return null;

  // Prevent concurrent judges on the same slot
  if (activeJudges.has(slot.id)) {
    log.warn({ slotId: slot.id }, 'Judge already running on this slot — skipping');
    return null;
  }

  const controller = new AbortController();
  const signal = AbortSignal.any([parentSignal, controller.signal, AbortSignal.timeout(DEFAULT_JUDGE_TIMEOUT_MS)]);
  activeJudges.set(slot.id, { controller });

  const maxAttempts = settings.autoRetry ? 1 + Math.max(0, settings.maxRetries) : 1;

  // Determine which judges to run
  const tier = determineTier(turnToolNames);
  const disabledJudges = new Set<MicroJudgeId>();
  for (const [id, config] of Object.entries(settings.microJudges)) {
    if (!config.enabled) disabledJudges.add(id as MicroJudgeId);
  }
  const toolCategories = new Set(turnToolNames.map(categorizeToolName));
  const activeJudgeIds = getActiveJudges(tier, turnToolNames, disabledJudges, toolCategories);

  if (activeJudgeIds.length === 0) {
    activeJudges.delete(slot.id);
    return null;
  }

  // Build read-only tools for prefetch
  const toolDeps = {
    connector,
    figmaAPI: infra.figmaAPI,
    operationQueue: infra.queueManager.getQueue(connector.fileKey),
    wsServer: infra.wsServer,
    designSystemCache: infra.designSystemCache,
    configManager: infra.configManager,
    fileKey: connector.fileKey,
  };
  const readOnlyTools = createReadOnlyTools(toolDeps);

  let lastVerdict: JudgeVerdict | null = null;
  let currentJudgeIds = activeJudgeIds;
  let previousMicroVerdicts: MicroVerdict[] = [];

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) break;

      // Selective prefetch: only data needed by current judges
      const dataNeeds = getDataNeedsForJudges(currentJudgeIds);
      let prefetchedData: PrefetchedContext;
      try {
        prefetchedData = await prefetchForMicroJudges(readOnlyTools, dataNeeds, signal, connector.fileKey);
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') break;
        log.warn({ err, slotId: slot.id }, 'Micro-judge prefetch failed');
        break;
      }

      // Task context for judges
      const taskContext =
        attempt === 1
          ? `The agent just completed a turn with these tools: ${[...new Set(turnToolNames)].join(', ')}`
          : `The agent attempted to fix issues from the previous judge verdict. Previous action items: ${lastVerdict?.actionItems.join('; ')}`;

      // Run micro-judges in parallel
      const microVerdicts = await runMicroJudgeBatch(
        infra,
        currentJudgeIds,
        prefetchedData,
        settings,
        taskContext,
        `judge-${slot.id}-${attempt}`,
        signal,
        callbacks.onProgress,
      );

      if (signal.aborted) break;

      // On retry, merge with previous passing verdicts
      let allVerdicts: MicroVerdict[];
      if (attempt > 1 && lastVerdict) {
        // Keep passing verdicts from previous attempt, add new retry results
        // If a retry returns error/timeout, preserve the original FAIL to avoid flipping verdict
        const retryMap = new Map<MicroJudgeId, MicroVerdict>(microVerdicts.map((v) => [v.judgeId, v]));
        const previousMap = new Map<MicroJudgeId, MicroVerdict>(previousMicroVerdicts.map((v) => [v.judgeId, v]));
        allVerdicts = activeJudgeIds.map((id): MicroVerdict => {
          const retried = retryMap.get(id);
          if (retried) {
            // If retry errored/timed out but previous was a definitive FAIL, keep the FAIL
            if (
              retried.status !== 'evaluated' &&
              previousMap.get(id)?.status === 'evaluated' &&
              !previousMap.get(id)?.pass
            ) {
              return previousMap.get(id)!;
            }
            return retried;
          }
          // Judge wasn't retried — use previous result or placeholder
          const prev = previousMap.get(id);
          if (prev) return prev;
          return {
            judgeId: id,
            pass: true,
            finding: 'Previously passed',
            evidence: '',
            actionItems: [],
            status: 'evaluated' as const,
            durationMs: 0,
          };
        });
      } else {
        allVerdicts = microVerdicts;
      }

      previousMicroVerdicts = allVerdicts;
      lastVerdict = aggregateVerdicts(allVerdicts, activeJudgeIds);
      callbacks.onVerdict(lastVerdict, attempt, maxAttempts);

      if (lastVerdict.verdict === 'PASS') {
        log.info({ slotId: slot.id, attempt, tier }, 'Judge PASS');
        break;
      }

      // FAIL — create remediation tasks directly from micro-verdicts (no string matching)
      if (slot.taskStore) {
        for (const mv of allVerdicts) {
          if (mv.status === 'evaluated' && !mv.pass) {
            for (const item of mv.actionItems) {
              slot.taskStore.create(item, `Judge remediation: ${mv.judgeId} (attempt ${attempt})`, undefined, {
                source: 'judge',
                criterion: mv.judgeId,
                judgeAttempt: attempt,
              });
            }
          }
        }
      }

      // FAIL — retry if enabled and attempts remain
      if (settings.autoRetry && attempt < maxAttempts) {
        log.info({ slotId: slot.id, attempt, maxAttempts, tier }, 'Judge FAIL — retrying failed criteria');
        callbacks.onRetryStart(attempt + 1, maxAttempts);

        // Selective retry: only re-run failed judges
        const failedJudgeIds = allVerdicts.filter((v) => v.status === 'evaluated' && !v.pass).map((v) => v.judgeId);
        currentJudgeIds = failedJudgeIds.length > 0 ? failedJudgeIds : currentJudgeIds;

        // Build retry prompt from action items
        const retryPrompt = `${JUDGE_RETRY_MARKER}\nThe quality judge found issues. Please fix:\n${lastVerdict.actionItems.map((a, i) => `${i + 1}. ${a}`).join('\n')}\n\nAfter fixing, take a screenshot to verify.`;

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

/**
 * Force re-run the judge on a slot, ignoring judgeMode settings.
 * Uses slot.lastTurnToolNames for tier determination.
 */
export async function forceRerunJudge(
  infra: AgentInfra,
  connector: ScopedConnector,
  slot: SessionSlot,
  settings: SubagentSettings,
  parentSignal: AbortSignal,
  callbacks: JudgeHarnessCallbacks,
): Promise<JudgeVerdict | null> {
  const toolNames = slot.lastTurnToolNames;
  if (!toolNames || toolNames.length === 0) {
    log.warn({ slotId: slot.id }, 'No lastTurnToolNames — cannot force re-run');
    return null;
  }

  // Pass overridden settings and a slot view without mutating the original slot
  const overriddenSettings = { ...settings, judgeMode: 'auto' as const };
  const slotView = Object.create(slot) as SessionSlot;
  slotView.judgeOverride = true;

  return runJudgeHarness(infra, connector, slotView, overriddenSettings, toolNames, parentSignal, callbacks);
}
