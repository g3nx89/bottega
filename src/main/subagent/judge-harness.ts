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
import type { JudgeEvidence } from './judge-evidence.js';
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
  let executeCount = 0;

  for (const t of turnToolNames) {
    const cat = categorizeToolName(t);
    if (STRUCTURAL_TOOLS.has(t)) {
      structuralCount++;
    } else if (cat === 'execute') {
      // figma_execute is used for both structural (create) and non-structural (modify)
      // operations. Count only the first one as structural — subsequent calls are
      // typically property modifications (padding, fills, corner radius) which don't
      // indicate design complexity. This prevents tier inflation from modify-heavy turns.
      executeCount++;
      if (executeCount <= 1) structuralCount++;
    } else if (NAMING_ONLY_TOOLS.has(t)) {
    } else if (cat === 'mutation' || cat === 'ds') {
      hasVisual = true;
    }
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
      let targetNodeId = turnMutatedNodeIds[0];

      // Fallback: when turnMutatedNodeIds is empty (e.g., figma_execute without
      // getNodeByIdAsync in code), try to get the current Figma selection. Without
      // a targetNodeId the evidence pipeline is disabled and the severity system
      // cannot function — all criteria stay blocking, causing false FAIL verdicts.
      if (!targetNodeId && dataNeeds.has('judgeEvidence')) {
        try {
          const selectionId = await connector.executeCodeViaUI(
            'return figma.currentPage.selection[0]?.id ?? null',
            5_000,
          );
          if (typeof selectionId === 'string' && selectionId.includes(':')) {
            targetNodeId = selectionId;
            log.info({ slotId: slot.id, targetNodeId }, 'Fallback targetNodeId from Figma selection');
          }
        } catch {
          // Best-effort — if selection lookup fails, proceed without evidence
        }
      }
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
      if (downgraded.size > 0) {
        log.info(
          { slotId: slot.id, attempt, downgradedJudges: [...downgraded] },
          'Severity downgrade: minor findings become suggestions',
        );
      }
      lastVerdict = aggregateVerdicts(allVerdicts, activeJudgeIds, downgraded);
      callbacks.onVerdict(lastVerdict, attempt, maxAttempts);

      if (lastVerdict.verdict === 'PASS') {
        log.info(
          { slotId: slot.id, attempt, tier, downgradedCriteria: downgraded.size > 0 ? [...downgraded] : undefined },
          'Judge PASS',
        );
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
          downgradedCriteria: downgraded.size > 0 ? [...downgraded] : undefined,
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

        // Build enriched retry prompt with node IDs, tool hints, evidence values, and progressive context.
        // Pass componentAnalysis so retry prompt can extract nodeIds directly from withinScreen
        // rather than depending on LLM evidence text (which is unreliable).
        const retryPrompt = buildRetryPrompt(
          allVerdicts,
          { attempt: attempt + 1, maxAttempts, previousSummary: lastVerdict?.summary },
          prefetchedData.judgeEvidence,
          prefetchedData.componentAnalysis,
        );

        // Observability: log that a retry prompt is being injected, plus the node IDs
        // extracted from ComponentAnalysis (if any). This bypasses the normal usage:prompt
        // event logger (which only fires for user-initiated prompts).
        const retryNodeIds =
          prefetchedData.componentAnalysis?.withinScreen.flatMap((g) => g.nodeIds).filter(Boolean) ?? [];
        log.info(
          {
            slotId: slot.id,
            attempt: attempt + 1,
            maxAttempts,
            failedCriteria: allVerdicts.filter((v) => v.status === 'evaluated' && !v.pass).map((v) => v.judgeId),
            nodeIds: retryNodeIds.slice(0, 10),
            promptLength: retryPrompt.length,
            hasChecklist: retryPrompt.includes('DIRECT ACTION CHECKLIST'),
            promptPreview: retryPrompt.slice(0, 1200),
          },
          'Judge retry prompt injected',
        );

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
  consistency:
    'Use figma_execute to set paddingTop/Bottom/Left/Right and itemSpacing to uniform values across sibling nodes. Use figma_set_corner_radius for uniform radii. Check the evidence values to determine the correct target value.',
  naming:
    'Use figma_batch_rename(entries: [{nodeId, newName}]) to rename all default-named nodes in one call. Also use figma_auto_layout on frames with 2+ children that lack layoutMode.',
  componentization:
    'CRITICAL: Do NOT re-render or recreate these frames — they already exist with correct visuals. ' +
    'EXTRACT a component from the FIRST existing frame, then REPLACE the others with instances. ' +
    'Exact workflow: ' +
    '1) figma_create_component({fromFrameId: "FIRST_NODE_ID"}) — converts the first existing frame IN PLACE to a reusable component. ' +
    '2) For each other node ID: record its (x, y, parentId) via figma_get_file_data, then figma_delete(nodeId), ' +
    'then figma_instantiate({nodeId: componentId, parentId, x, y}) at the same position — pass nodeId (the componentId from step 1), NOT componentKey, for local components. ' +
    '3) figma_set_instance_properties on each instance to override text to match the original content. ' +
    'DO NOT call figma_render_jsx or figma_generate_image during this retry — all visual content already exists. ' +
    'Preserve existing image fills by using the instance/property swap, not re-rendering.',
  design_quality:
    'Use figma_flatten_layers to reduce nesting, figma_set_text_style for typography, figma_set_fills with bindTo for token-bound colors.',
};

/**
 * Extract node IDs from judge evidence text. Supports multiple formats:
 * - nodeId: 128:445 / id: 128:445
 * - (128:445)
 * - JSON arrays: "nodeIds": ["128:445", ...]
 * - Quoted bare IDs: "128:445"
 */
export function extractNodeIds(evidence: string): string[] {
  const ids: string[] = [];
  const patterns = [/nodeId[:\s]+(\d+:\d+)/gi, /\bid[:\s]+(\d+:\d+)/gi, /\((\d+:\d+)\)/g, /"(\d+:\d+)"/g];
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

/**
 * Build enriched retry prompt with node IDs, tool suggestions, and numeric evidence.
 * @param evidence Optional pre-computed evidence — when provided, numeric facts are
 *   appended for evidence-backed criteria so the agent knows the exact values to target.
 * @param componentAnalysis Optional ComponentAnalysis — when provided, nodeIds for
 *   componentization findings are extracted directly from withinScreen, bypassing
 *   the unreliable LLM evidence text.
 */
export function buildRetryPrompt(
  allVerdicts: MicroVerdict[],
  retry?: RetryContext,
  evidence?: JudgeEvidence | null,
  componentAnalysis?: { withinScreen: Array<{ nodeNames: string[]; nodeIds: string[]; count: number }> } | null,
): string {
  // Separate structural from styling issues for priority ordering
  const STRUCTURAL_CRITERIA = new Set(['completeness', 'alignment', 'visual_hierarchy']);

  // Group items by criterion, preserving structural-first priority order.
  const criterionOrder: MicroJudgeId[] = [];
  const itemsByCriterion = new Map<MicroJudgeId, string[]>();

  // For componentization, extract nodeIds directly from ComponentAnalysis (most reliable).
  // Falls back to extractNodeIds() on evidence text for other criteria.
  const componentizationNodeIds = componentAnalysis?.withinScreen.flatMap((g) => g.nodeIds).filter(Boolean) ?? [];

  for (const mv of allVerdicts) {
    if (mv.status !== 'evaluated' || mv.pass) continue;

    const nodeIds =
      mv.judgeId === 'componentization' && componentizationNodeIds.length > 0
        ? componentizationNodeIds
        : extractNodeIds(mv.evidence);
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

  // Append numeric evidence for the focused criterion so the agent knows exact values.
  let evidenceNote = '';
  if (evidence && focusCriterion) {
    const slice = evidence[focusCriterion as keyof JudgeEvidence];
    if (slice && typeof slice === 'object' && 'findings' in (slice as any)) {
      const findings = (slice as any).findings;
      if (Array.isArray(findings) && findings.length > 0) {
        const summaryLines = findings.slice(0, 3).map((f: any) => {
          const names = f.nodeNames ? ` (${f.nodeNames.join(', ')})` : '';
          const vals = Array.isArray(f.values) ? f.values.join(', ') : '';
          return `  ${f.property ?? f.axis ?? 'offset'}: [${vals}]${names}`;
        });
        evidenceNote = `\n\nEvidence (exact values from Figma):\n${summaryLines.join('\n')}`;
      }
    }
  }

  const itemsText = focusedItems.map((item, i) => `${i + 1}. ${item}`).join('\n\n');
  const toolWord = focusedItems.length === 1 ? 'the suggested tool' : 'the suggested tools';

  // Componentization: inject an explicit per-nodeId imperative checklist at the top.
  // Agent research (v7) showed the agent was creating component definitions but not
  // instantiating them. A concrete, numbered tool-call sequence with actual node IDs
  // is more effective than abstract workflow descriptions.
  let componentizationChecklist = '';
  if (focusCriterion === 'componentization' && componentAnalysis && componentAnalysis.withinScreen.length > 0) {
    const biggestGroup = [...componentAnalysis.withinScreen].sort((a, b) => b.count - a.count)[0]!;
    const ids = biggestGroup.nodeIds.filter(Boolean);
    if (ids.length >= 2) {
      const [firstId, ...restIds] = ids;
      const instantiateSteps = restIds
        .slice(0, 6) // cap to avoid overwhelming the prompt
        .map(
          (id, idx) =>
            `  ${idx + 2}. figma_delete('${id}') then figma_instantiate({ nodeId: componentId, /* same x,y,parentId as ${id} was */ })`,
        )
        .join('\n');
      componentizationChecklist = `\n\n**DIRECT ACTION CHECKLIST** (${restIds.length + 2} steps — execute ALL in order, DO NOT skip any):\n\n  STEP 1: figma_create_component({ fromFrameId: '${firstId}' })\n         This CONVERTS frame '${firstId}' into a reusable COMPONENT. Save the returned componentId (it's a LOCAL component — use nodeId, NOT componentKey).\n\n${instantiateSteps}\n\n  STEP ${restIds.length + 2}: After all ${restIds.length} instances exist, use figma_set_instance_properties on each one to restore the original text content (look at current node names for hints).\n\n**WHY ALL STEPS MATTER**: A component with zero instances does NOT satisfy componentization. The judge needs to see [1 COMPONENT + ${restIds.length} INSTANCE nodes] — not [${restIds.length + 1} FRAME nodes]. Skipping the figma_instantiate calls WILL fail the retry.\n\n**DO NOTs**: Do NOT call figma_render_jsx. Do NOT call figma_generate_image. Do NOT call figma_execute with component.createInstance() — use figma_instantiate({ nodeId }) instead. The nodes [${ids.join(', ')}] already exist with correct visuals. Just convert + replace.`;
    }
  }

  // Structure: MARKER, checklist (if any) FIRST to maximize visibility,
  // then itemsText for context, then evidence. Agent reads top-down — the
  // specific tool-call sequence must appear before any abstract wording.
  const header = componentizationChecklist
    ? `${JUDGE_RETRY_MARKER}${attemptInfo}${previousInfo}${componentizationChecklist}\n\nAdditional context for this retry:\n\n${itemsText}`
    : `${JUDGE_RETRY_MARKER}${attemptInfo}${previousInfo}\nFirst take a screenshot to see the current state, then fix ${focusedItems.length === 1 ? 'this issue' : 'these issues'} using ${toolWord}:\n\n${itemsText}`;
  return `${header}${evidenceNote}${remainingNote}\n\nAfter all fixes, take ONE final screenshot to verify.`;
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
