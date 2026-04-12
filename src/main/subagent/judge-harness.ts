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
import { computeDowngradedJudges } from './judge-severity.js';
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

const DEFAULT_JUDGE_TIMEOUT_MS = 600_000;

/** Max action items included in retry task context to prevent prompt bloat. */
const MAX_TASK_CONTEXT_ITEMS = 5;

/** Stop iterating after this many consecutive attempts with no improvement. */
const MAX_CONSECUTIVE_NO_IMPROVEMENT = 2;

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

/** Build task context string for judge evaluation — progressive on retries. */
export function buildTaskContext(
  attempt: number,
  maxAttempts: number,
  turnToolNames: string[],
  lastVerdict: JudgeVerdict | null,
): string {
  if (attempt === 1) {
    return `The agent just completed a turn with these tools: ${[...new Set(turnToolNames)].join(', ')}`;
  }
  const items = lastVerdict?.actionItems.slice(0, MAX_TASK_CONTEXT_ITEMS).join('; ') ?? '';
  const overflow =
    (lastVerdict?.actionItems.length ?? 0) > MAX_TASK_CONTEXT_ITEMS
      ? ` (and ${(lastVerdict?.actionItems.length ?? 0) - MAX_TASK_CONTEXT_ITEMS} more)`
      : '';
  return `Retry evaluation ${attempt}/${maxAttempts}. The agent was asked to fix: ${items}${overflow}. Previous verdict: ${lastVerdict?.summary ?? 'FAIL'}. Evaluate whether the fixes were actually applied — if the same issues persist, the agent's fix attempt failed.`;
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
 * Determine activation tier based on complexity — estimated from structural tool call count.
 * - standard: 1-4 structural calls → core quality judges (completeness, alignment, visual_hierarchy, design_quality)
 * - full: 5+ structural calls → all judges including naming, componentization, consistency
 * - visual: styling-only (no structural) → styling-relevant subset
 * - narrow: rename or token-only changes
 *
 * Note: the old 'minimal' tier (1 judge) was removed because it provided
 * insufficient quality signal — most creation turns used 1-2 structural tools
 * and only got a completeness check, missing alignment/hierarchy/quality issues.
 */
const NAMING_ONLY_TOOLS = new Set(['figma_rename']);

export function determineTier(turnToolNames: string[]): ActivationTier {
  let structuralCount = 0;
  let hasVisual = false;

  for (const t of turnToolNames) {
    const cat = categorizeToolName(t);
    if (cat === 'execute' || STRUCTURAL_TOOLS.has(t)) structuralCount++;
    else if (NAMING_ONLY_TOOLS.has(t)) continue;
    else if (cat === 'mutation' || cat === 'ds') hasVisual = true;
  }

  // Complexity-based: standard for any creation, full for complex multi-element designs
  if (structuralCount >= 5) return 'full';
  if (structuralCount >= 1) return 'standard';

  // No structural tools — check for visual-only or narrow
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
  /**
   * UX-003: node IDs mutated/created by the turn under evaluation. The first ID
   * is passed to `figma_screenshot` during prefetch so the judge sees only the
   * target node instead of the whole canvas. Pass `[]` if nothing specific.
   */
  turnMutatedNodeIds: string[],
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

  // Skip token_compliance unless tokens have been explicitly set up in this session.
  // figma_lint alone does NOT mean tokens exist — it's a discovery tool.
  const hasSetupTokens = [...slot.sessionToolHistory].some(
    (t) => t === 'figma_setup_tokens' || t === 'figma_bind_variable',
  );
  if (!hasSetupTokens) {
    disabledJudges.add('token_compliance' as MicroJudgeId);
  }

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
  let previousFailCount = Infinity;
  let consecutiveNoImprovement = 0;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (signal.aborted) break;

      // Selective prefetch: only data needed by current judges
      const dataNeeds = getDataNeedsForJudges(currentJudgeIds);
      // UX-003: pick the first mutated nodeId as the screenshot target. When the
      // turn touched multiple nodes we still scope to the first one — the judge
      // prompts explicitly mention this limitation so findings are always framed
      // relative to the target node.
      const targetNodeId = turnMutatedNodeIds[0];
      let prefetchedData: PrefetchedContext;
      try {
        prefetchedData = await prefetchForMicroJudges(
          readOnlyTools,
          dataNeeds,
          signal,
          connector.fileKey,
          targetNodeId,
          connector,
        );
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') break;
        log.warn({ err, slotId: slot.id }, 'Micro-judge prefetch failed');
        break;
      }

      // Task context for judges — progressive on retries so judges know what was attempted
      const taskContext = buildTaskContext(attempt, maxAttempts, turnToolNames, lastVerdict);

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
      // Compute severity-based downgrade: minor evidence findings become suggestions,
      // not blockers. This keeps judges honest but makes retry more effective — the
      // agent focuses on ONE major issue instead of three issues at once.
      const downgraded = computeDowngradedJudges(currentJudgeIds, prefetchedData.judgeEvidence);
      lastVerdict = aggregateVerdicts(allVerdicts, activeJudgeIds, downgraded);
      callbacks.onVerdict(lastVerdict, attempt, maxAttempts);

      if (lastVerdict.verdict === 'PASS') {
        log.info({ slotId: slot.id, attempt, tier }, 'Judge PASS');
        break;
      }

      // Track convergence: is the number of failures decreasing?
      const currentFailCount = allVerdicts.filter((v) => v.status === 'evaluated' && !v.pass).length;
      if (attempt > 1) {
        if (currentFailCount >= previousFailCount) {
          consecutiveNoImprovement++;
          if (consecutiveNoImprovement >= MAX_CONSECUTIVE_NO_IMPROVEMENT) {
            log.info(
              { slotId: slot.id, attempt, currentFailCount, previousFailCount, tier },
              'Judge FAIL — no convergence, stopping retries',
            );
            break;
          }
        } else {
          consecutiveNoImprovement = 0; // improving — reset counter
        }
      }
      previousFailCount = currentFailCount;
      log.info(
        {
          slotId: slot.id,
          attempt,
          maxAttempts,
          tier,
          failCount: currentFailCount,
          failedCriteria: lastVerdict.criteria.filter((c) => !c.pass).map((c) => c.name),
        },
        'Judge FAIL',
      );

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

        // Build enriched retry prompt with node IDs, tool hints, and progressive context
        const retryPrompt = buildRetryPrompt(allVerdicts, {
          attempt: attempt + 1,
          maxAttempts,
          previousSummary: lastVerdict?.summary,
        });

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

// ── Tool hint map for enriched retry prompts ────────────────────────
const CRITERION_TOOL_HINTS: Record<string, string> = {
  alignment: 'Use figma_move, figma_auto_layout, or figma_set_layout_sizing to fix positioning.',
  token_compliance: 'Use figma_bind_variable(nodeId, variableName, property) to bind tokens.',
  visual_hierarchy: 'Use figma_set_text_style to adjust font size/weight for hierarchy.',
  completeness: 'Use figma_create_child or figma_render_jsx to add missing elements.',
  consistency: 'Use figma_batch_set_fills or figma_batch_transform for uniform styling.',
  naming:
    'Use figma_batch_rename(entries: [{nodeId, newName}]) to rename all default-named nodes in one call. Also use figma_auto_layout on frames with 2+ children that lack layoutMode.',
  componentization: 'Use figma_create_component to convert frames to reusable components.',
  design_quality:
    'Use figma_flatten_layers to reduce nesting, figma_set_text_style for typography, figma_set_fills with bindTo for token-bound colors.',
};

/** Extract node IDs from judge evidence text (format: "nodeId:128:445" or "id: 128:445") */
export function extractNodeIds(evidence: string): string[] {
  const ids: string[] = [];
  const patterns = [/nodeId[:\s]+(\d+:\d+)/gi, /\bid[:\s]+(\d+:\d+)/gi, /\((\d+:\d+)\)/g];
  for (const pat of patterns) {
    let m: RegExpExecArray | null = pat.exec(evidence);
    while (m !== null) {
      if (!ids.includes(m[1]!)) ids.push(m[1]!);
      m = pat.exec(evidence);
    }
  }
  return ids;
}

/** Optional retry context — provided together or not at all. */
export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  previousSummary?: string;
}

/** Build enriched retry prompt with node IDs and tool suggestions from judge evidence. */
export function buildRetryPrompt(allVerdicts: MicroVerdict[], retry?: RetryContext): string {
  // Separate structural from styling issues for priority ordering
  const STRUCTURAL_CRITERIA = new Set(['completeness', 'alignment', 'visual_hierarchy']);

  // Group items by criterion, preserving structural-first priority order.
  const criterionOrder: MicroJudgeId[] = [];
  const itemsByCriterion = new Map<MicroJudgeId, string[]>();

  for (const mv of allVerdicts) {
    if (mv.status !== 'evaluated' || mv.pass) continue;

    const nodeIds = extractNodeIds(mv.evidence);
    const nodeHint = nodeIds.length > 0 ? ` Affected nodes: ${nodeIds.join(', ')}.` : '';
    const toolHint = CRITERION_TOOL_HINTS[mv.judgeId] || '';

    const items: string[] = [];
    for (const item of mv.actionItems) {
      items.push(`[${mv.judgeId}] ${item}${nodeHint}\n   → ${toolHint}`);
    }
    if (items.length > 0) {
      itemsByCriterion.set(mv.judgeId, items);
      criterionOrder.push(mv.judgeId);
    }
  }

  // Sort: structural criteria first, then styling
  criterionOrder.sort((a, b) => {
    const aStruct = STRUCTURAL_CRITERIA.has(a) ? 0 : 1;
    const bStruct = STRUCTURAL_CRITERIA.has(b) ? 0 : 1;
    return aStruct - bStruct;
  });

  // Focus retry on the SINGLE highest-priority CRITERION (all its items).
  // Asking the agent to fix multiple criteria at once reduces convergence rate.
  const focusCriterion = criterionOrder[0];
  const focusedItems = focusCriterion ? (itemsByCriterion.get(focusCriterion) ?? []) : [];
  const totalItems = [...itemsByCriterion.values()].reduce((sum, items) => sum + items.length, 0);
  const remainingCount = totalItems - focusedItems.length;

  if (focusedItems.length === 0) {
    return `${JUDGE_RETRY_MARKER}\nThe quality judge found minor issues but no specific action items. Take a screenshot to verify current state.`;
  }

  const attemptInfo = retry ? `\n(Retry attempt ${retry.attempt}/${retry.maxAttempts})` : '';
  const previousInfo = retry?.previousSummary
    ? `\nPrevious evaluation: ${retry.previousSummary}. The previous fix did NOT fully resolve the issues — try a different approach for recurring items.`
    : '';

  const remainingNote =
    remainingCount > 0 ? `\n(${remainingCount} more items will be addressed in later iterations)` : '';

  const itemsText = focusedItems.map((item, i) => `${i + 1}. ${item}`).join('\n\n');
  const toolWord = focusedItems.length === 1 ? 'the suggested tool' : 'the suggested tools';
  return `${JUDGE_RETRY_MARKER}${attemptInfo}${previousInfo}\nFirst take a screenshot to see the current state, then fix ${focusedItems.length === 1 ? 'this issue' : 'these issues'} using ${toolWord}:\n\n${itemsText}${remainingNote}\n\nAfter all fixes, take ONE final screenshot to verify.`;
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

  // UX-003: re-use the last turn's captured mutation nodeIds so a manual
  // re-run still scopes the screenshot correctly.
  const mutatedNodeIds = slot.lastTurnMutatedNodeIds ?? [];

  return runJudgeHarness(
    infra,
    connector,
    slotView,
    overriddenSettings,
    toolNames,
    mutatedNodeIds,
    parentSignal,
    callbacks,
  );
}
