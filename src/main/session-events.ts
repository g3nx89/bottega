/**
 * Session event routing — handles Pi SDK session events and routes them
 * to the renderer via IPC. Extracted from ipc-handlers.ts to reduce file size.
 */
import { randomUUID } from 'node:crypto';
import { createChildLogger } from '../figma/logger.js';
import { type AgentInfra, wrapPromptWithErrorCapture } from './agent.js';
import { categorizeToolName } from './compression/metrics.js';
import type { AgentSessionLike } from './ipc-handlers.js';
import { recordLastGood } from './last-known-good.js';
import { MSG_EMPTY_TURN_WARNING, MSG_REQUEST_FAILED_FALLBACK } from './messages.js';
import type { UsageTracker } from './remote-logger.js';
import { safeSend } from './safe-send.js';
import type { SessionSlot, SlotManager } from './slot-manager.js';
import { loadSubagentSettings } from './subagent/config.js';
import { abortActiveJudge, READ_ONLY_CATEGORIES, runJudgeHarness } from './subagent/judge-harness.js';

const log = createChildLogger({ component: 'session-events' });

export interface EventRouterDeps {
  slotManager: SlotManager;
  mainWindow: { webContents: Electron.WebContents };
  usageTracker?: UsageTracker;
  persistSlotSession: (slot: SessionSlot) => void;
  contextSizes: Record<string, number>;
  /** Agent infrastructure — needed to spawn judge subagents. */
  infra?: AgentInfra;
  /** Get ScopedConnector for a slot — needed for judge subagent tools. */
  getConnectorForSlot?: (slot: SessionSlot) => import('./scoped-connector.js').ScopedConnector | null;
}

/**
 * Initialize a new turn on the slot: assign promptId, increment turnIndex, track prompt.
 *
 * Also bumps the MetricsRegistry turnsStarted counter when an infra ref is
 * supplied — callers pass `deps.infra` when available.
 */
export function beginTurn(
  slot: SessionSlot,
  text: string,
  isFollowUp: boolean,
  usageTracker?: UsageTracker,
  infra?: AgentInfra,
): void {
  const promptId = randomUUID();
  slot.turnIndex += 1;
  slot.currentPromptId = promptId;
  slot.promptStartTime = Date.now();
  infra?.metricsRegistry?.recordTurnStart();
  usageTracker?.trackPrompt(text.length, isFollowUp, {
    promptId,
    slotId: slot.id,
    turnIndex: slot.turnIndex,
    content: text,
  });
}

export function createEventRouter(deps: EventRouterDeps) {
  const { slotManager, mainWindow, usageTracker, persistSlotSession, contextSizes } = deps;
  const toolStartTimes = new Map<string, number>();
  const subscribedSessions = new WeakSet<AgentSessionLike>();
  // Re-entrancy guard: prevents recursive handleAgentEnd when judge retry fires agent_end.
  // Also suppresses streaming events (text_delta, tool_start, etc.) during judge retry.
  const judgeInProgress = new Set<string>();
  const judgeAbortControllers = new Map<string, AbortController>();

  // ── Per-turn accumulators (keyed by slotId) ──
  const turnToolNames = new Map<string, string[]>();
  const turnResponseLength = new Map<string, number>();
  // UX-003: nodeIds mutated/created during this turn, used to scope the judge screenshot.
  const turnMutatedNodeIds = new Map<string, string[]>();

  /** Get prompt correlation context from the slot's current turn. */
  function turnContext(slot: SessionSlot): { promptId: string | undefined; slotId: string; turnIndex: number } {
    return {
      promptId: slot.currentPromptId ?? undefined,
      slotId: slot.id,
      turnIndex: slot.turnIndex,
    };
  }

  /**
   * Capture the slot's turn identity at this moment. The returned `isStale()`
   * returns true if the user has reset the session or started a new turn —
   * use it inside async .then/.catch handlers to drop IPC events that would
   * otherwise leak across turns (B-011 family).
   */
  function captureTurnGuard(slot: SessionSlot): { isStale: () => boolean } {
    const captured = slot.turnIndex;
    return { isStale: () => slot.turnIndex !== captured };
  }

  function handleMessageUpdate(wc: Electron.WebContents, slot: SessionSlot, event: any) {
    // Suppress streaming during judge retry — internal repair should not leak into chat
    if (judgeInProgress.has(slot.id)) return;
    if (event.assistantMessageEvent?.type === 'text_delta') {
      safeSend(wc, 'agent:text-delta', slot.id, event.assistantMessageEvent.delta);
      slot.suggester.appendAssistantText(event.assistantMessageEvent.delta);
      const prev = turnResponseLength.get(slot.id) ?? 0;
      turnResponseLength.set(slot.id, prev + event.assistantMessageEvent.delta.length);
    }
    if (event.assistantMessageEvent?.type === 'thinking_delta') {
      safeSend(wc, 'agent:thinking', slot.id, event.assistantMessageEvent.delta);
    }
  }

  // Store tool inputs for screenshot metadata (captured at start, used at end)
  const toolInputs = new Map<string, any>();

  /**
   * UX-003: Extract a node ID from a mutation tool's input shape. Mutation tools
   * in Bottega take one of: `nodeId` (string), `nodeIds` (string[]), or `parentId`
   * (string, for create-type tools like figma_render_jsx / figma_create_child /
   * figma_create_icon). Read-only tools like figma_screenshot are skipped by caller.
   *
   * For figma_execute: also scan the `code` string for getNodeByIdAsync("N:M")
   * patterns since execute has no structured nodeId field.
   */
  const NODE_ID_IN_CODE = /getNodeByIdAsync\s*\(\s*["'](\d+:\d+)["']\s*\)/g;
  function extractNodeIdsFromInput(input: any): string[] {
    if (!input || typeof input !== 'object') return [];
    const out: string[] = [];
    if (typeof input.nodeId === 'string' && input.nodeId) out.push(input.nodeId);
    if (Array.isArray(input.nodeIds)) {
      for (const id of input.nodeIds) if (typeof id === 'string' && id) out.push(id);
    }
    // parentId is a good fallback for create-* tools: scoping to the parent frame
    // shows the newly created child in context.
    if (typeof input.parentId === 'string' && input.parentId) out.push(input.parentId);
    // figma_execute: scan code string for node ID references
    if (typeof input.code === 'string' && input.code) {
      for (const match of input.code.matchAll(NODE_ID_IN_CODE)) {
        if (match[1]) out.push(match[1]);
      }
    }
    return out;
  }

  /**
   * UX-003: Extract created node IDs from a tool result's text content.
   * Bottega wraps results via `textResult(...)` which JSON-serializes plugin
   * responses. Create/clone/instantiate tools return `{ id: "N:M", ... }` or
   * `{ nodeId: "N:M", ... }` in their payload — match both.
   */
  const NODE_ID_IN_RESULT = /"(?:id|nodeId)"\s*:\s*"(\d+:\d+)"|(?:^|\s)node[=:](\d+:\d+)/gm;
  function extractNodeIdsFromResult(result: any): string[] {
    const content = result?.content;
    if (!Array.isArray(content)) return [];
    const out: string[] = [];
    for (const c of content) {
      if (c?.type !== 'text' || typeof c.text !== 'string') continue;
      for (const match of c.text.matchAll(NODE_ID_IN_RESULT)) {
        const id = match[1] ?? match[2]; // group 1 = JSON format, group 2 = text format (node=N:M)
        if (id && !out.includes(id)) out.push(id);
      }
    }
    return out;
  }

  function handleToolStart(wc: Electron.WebContents, slot: SessionSlot, event: any) {
    if (judgeInProgress.has(slot.id)) return;
    log.info({ tool: event.toolName, callId: event.toolCallId, slotId: slot.id }, 'Tool start');
    safeSend(wc, 'agent:tool-start', slot.id, event.toolName, event.toolCallId);
    toolStartTimes.set(event.toolCallId, Date.now());
    if (event.toolName === 'figma_screenshot' && event.toolInput) {
      toolInputs.set(event.toolCallId, event.toolInput);
    }
    // Track tool name for this turn
    const names = turnToolNames.get(slot.id) ?? [];
    names.push(event.toolName);
    turnToolNames.set(slot.id, names);

    // UX-003: capture nodeIds from mutation tool inputs (non read-only tools only)
    // so the judge harness can scope its screenshot to the affected nodes.
    if (!READ_ONLY_CATEGORIES.has(categorizeToolName(event.toolName))) {
      const ids = extractNodeIdsFromInput(event.toolInput);
      if (ids.length > 0) {
        const existing = turnMutatedNodeIds.get(slot.id) ?? [];
        existing.push(...ids);
        turnMutatedNodeIds.set(slot.id, existing);
      }
    }
  }

  function handleToolEnd(wc: Electron.WebContents, slot: SessionSlot, event: any) {
    if (judgeInProgress.has(slot.id)) return;
    const resultPreview = event.result?.content
      ? event.result.content.map((c: any) => ({
          type: c.type,
          ...(c.type === 'text' ? { text: (c.text || '').slice(0, 200) } : {}),
          ...(c.type === 'image' ? { hasData: !!c.data, dataLen: c.data?.length } : {}),
        }))
      : 'no content';
    log.info({ tool: event.toolName, callId: event.toolCallId, isError: event.isError, slotId: slot.id }, 'Tool end');
    log.debug({ tool: event.toolName, callId: event.toolCallId, resultContent: resultPreview }, 'Tool result detail');
    safeSend(wc, 'agent:tool-end', slot.id, event.toolName, event.toolCallId, !event.isError, event.result);

    const startTime = toolStartTimes.get(event.toolCallId);
    const durationMs = startTime ? Date.now() - startTime : 0;
    toolStartTimes.delete(event.toolCallId);
    const category = categorizeToolName(event.toolName);
    const ctx = turnContext(slot);

    if (event.isError) {
      usageTracker?.trackToolError(event.toolName, JSON.stringify(resultPreview), undefined, ctx);
    }

    // Screenshot metadata for analytics (prefer stored input from start event)
    const input = toolInputs.get(event.toolCallId) ?? event.toolInput;
    toolInputs.delete(event.toolCallId);
    const screenshotMeta =
      event.toolName === 'figma_screenshot'
        ? { nodeId: input?.nodeId, scale: input?.scale, format: input?.format }
        : undefined;

    usageTracker?.trackToolCall(event.toolName, category, !event.isError, durationMs, {
      ...ctx,
      screenshotMeta,
    });
    // Fase 4 / Option B: MetricsRegistry owns its own tool counter (independent
    // of UsageTracker, which is emit-only). Test harness reads this via
    // `test:get-metrics` to assert on tool call counts/errors/durations.
    deps.infra?.metricsRegistry?.recordToolCall(event.toolName, durationMs, !event.isError);

    if (
      event.toolName.startsWith('figma_generate_') ||
      event.toolName.startsWith('figma_edit_') ||
      event.toolName === 'figma_restore_image'
    ) {
      usageTracker?.trackImageGen(event.toolName.replace('figma_', ''), 'gemini', !event.isError, durationMs);
    }
    if (event.toolName === 'figma_screenshot' && !event.isError && event.result?.content) {
      const imageContent = event.result.content.find((c: any) => c.type === 'image');
      if (imageContent) safeSend(wc, 'agent:screenshot', slot.id, imageContent.data);
    }

    // Emit task list update after any task tool call
    if (event.toolName?.startsWith('task_') && slot.taskStore) {
      const tasks = slot.taskStore.list();
      safeSend(wc, 'task:updated', slot.id, tasks);
    }

    // UX-003: also capture node IDs produced by create-type tools (figma_create_child,
    // figma_render_jsx, figma_instantiate, figma_clone, figma_create_icon), which only
    // appear in the result payload, not the input.
    if (!event.isError && !READ_ONLY_CATEGORIES.has(category)) {
      const createdIds = extractNodeIdsFromResult(event.result);
      // (UX-003 diagnostic logging removed — nodeId extraction regex now handles both
      // JSON format {"nodeId":"N:M"} and text format "node=N:M")
      if (createdIds.length > 0) {
        const existing = turnMutatedNodeIds.get(slot.id) ?? [];
        existing.push(...createdIds);
        turnMutatedNodeIds.set(slot.id, existing);
      }
    }
  }

  function handleMessageEnd(wc: Electron.WebContents, slot: SessionSlot, event: any) {
    const msg = event.message;
    if (msg?.role === 'assistant' && msg.usage) {
      // input = non-cached tokens, cacheRead/cacheWrite = cached tokens
      // contextTokens = total input context (what fills the context window)
      const u = msg.usage;
      const contextTokens = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);

      // Always track tokens and context level — even during judge retries
      const contextWindow = contextSizes[slot.modelConfig.modelId] || 200_000;
      const fillPercent = Math.min(100, (contextTokens / contextWindow) * 100);
      usageTracker?.trackContextLevel({
        inputTokens: contextTokens,
        outputTokens: u.output,
        totalTokens: u.totalTokens,
        contextWindow,
        fillPercent,
        slotId: slot.id,
        turnIndex: slot.turnIndex,
        modelId: slot.modelConfig.modelId,
      });

      // Skip UI updates during judge retries — hidden turns should not update the chat
      if (judgeInProgress.has(slot.id)) return;

      // B-026: track last context tokens on the slot so it can be persisted + restored.
      slot.lastContextTokens = contextTokens;
      const usage = { input: contextTokens, output: u.output, total: u.totalTokens };
      log.info(
        {
          slotId: slot.id,
          turnIndex: slot.turnIndex,
          contextTokens,
          raw: {
            input: u.input,
            cacheRead: u.cacheRead,
            cacheWrite: u.cacheWrite,
            output: u.output,
            totalTokens: u.totalTokens,
          },
        },
        'Context usage update',
      );
      safeSend(wc, 'agent:usage', slot.id, usage);
    }
  }

  /** Emit turn_end metrics and reset per-turn accumulators. */
  function finalizeTurn(slot: SessionSlot): void {
    if (!slot.currentPromptId) return; // idempotent — already finalized
    deps.infra?.metricsRegistry?.recordTurnEnd();
    const toolNames = turnToolNames.get(slot.id) ?? [];
    const responseCharLength = turnResponseLength.get(slot.id) ?? 0;
    const responseDurationMs = slot.promptStartTime ? Date.now() - slot.promptStartTime : 0;

    usageTracker?.trackTurnEnd({
      promptId: slot.currentPromptId,
      slotId: slot.id,
      turnIndex: slot.turnIndex,
      responseCharLength,
      responseDurationMs,
      toolCallCount: toolNames.length,
      toolNames: [...new Set(toolNames)],
      hasAction: toolNames.length > 0,
    });

    // F17: record this model as last-known-good for its provider when the turn
    // produced meaningful output (text or tool calls). Pure empty turns (errors)
    // don't update the record.
    if (responseCharLength > 0 || toolNames.length > 0) {
      try {
        recordLastGood(slot.modelConfig.provider, slot.modelConfig.modelId);
      } catch (err) {
        log.warn({ err }, 'Failed to record last-known-good model');
      }
    }

    // Preserve last completed turn for feedback correlation
    slot.lastCompletedPromptId = slot.currentPromptId;
    slot.lastCompletedTurnIndex = slot.turnIndex;

    // Reset per-turn state
    turnToolNames.delete(slot.id);
    turnResponseLength.delete(slot.id);
    turnMutatedNodeIds.delete(slot.id);
    slot.currentPromptId = null;
    slot.promptStartTime = null;
  }

  async function handleAgentEnd(wc: Electron.WebContents, slot: SessionSlot) {
    if (!slot.isStreaming) return;
    // Re-entrancy guard: judge retry fires agent_end recursively — skip nested calls
    if (judgeInProgress.has(slot.id)) return;

    const toolNames = turnToolNames.get(slot.id) ?? [];
    // UX-003: dedupe and prioritize CREATED node IDs (from tool results) over
    // parent IDs (from tool inputs). Parent IDs like "0:1" (page root) scope
    // the screenshot to the entire canvas, which defeats scoped evaluation.
    // Strategy: filter out page-level IDs ("0:N" pattern = top-level pages),
    // then dedupe. If all IDs are page-level, keep them as fallback.
    const rawNodeIds = [...new Set(turnMutatedNodeIds.get(slot.id) ?? [])];
    const nonPageIds = rawNodeIds.filter((id) => !id.startsWith('0:'));
    const mutatedNodeIds = nonPageIds.length > 0 ? nonPageIds : rawNodeIds;

    // Save tool names for force re-run — only overwrite when turn had tools,
    // so subsequent no-tool turns don't clear the list needed by re-judge
    if (toolNames.length > 0) {
      slot.lastTurnToolNames = [...toolNames];
      slot.lastTurnMutatedNodeIds = mutatedNodeIds;
      for (const t of toolNames) slot.sessionToolHistory.add(t);
    }

    // Auto-judge: run BEFORE finalizeTurn so retry turns get proper turn tracking
    if (deps.infra && deps.getConnectorForSlot) {
      const settings = loadSubagentSettings();
      // Fail-safe: trigger for everything except pure read-only turns
      const hasMutations = toolNames.some((n) => !READ_ONLY_CATEGORIES.has(categorizeToolName(n)));
      // Check judgeOverride and judgeMode
      const shouldRun = slot.judgeOverride === true || (slot.judgeOverride !== false && settings.judgeMode === 'auto');
      // Fase 4: emit skipped reasons before any structural skip so the metric
      // makes the no-mutations / disabled / no-connector branches observable.
      if (!shouldRun) {
        deps.infra.metricsRegistry?.recordJudgeSkipped('disabled');
      } else if (!hasMutations) {
        deps.infra.metricsRegistry?.recordJudgeSkipped('no-mutations');
      }
      if (shouldRun) {
        const connector = deps.getConnectorForSlot(slot);
        if (!connector && hasMutations) {
          deps.infra.metricsRegistry?.recordJudgeSkipped('no-connector');
          // B-018: Judge was requested but we have no connector (slot.fileKey missing or WS disconnected).
          // Previously this was silently skipped. Now we log and notify the renderer so the user
          // understands why the Quality Check footer never appeared.
          log.warn(
            { slotId: slot.id, fileKey: slot.fileKey, judgeOverride: slot.judgeOverride },
            'Judge skipped: no connector (fileKey missing or WS disconnected)',
          );
          safeSend(wc, 'judge:skipped', slot.id, 'no-connector');
        }
        if (connector && hasMutations) {
          judgeInProgress.add(slot.id);
          deps.infra.metricsRegistry?.recordJudgeTriggered();
          const judgeStart = Date.now();
          try {
            safeSend(wc, 'judge:running', slot.id);
            // Store controller for external abort (e.g., user closes slot)
            const judgeController = new AbortController();
            judgeAbortControllers.set(slot.id, judgeController);
            const finalVerdict = await runJudgeHarness(
              deps.infra,
              connector,
              slot,
              settings,
              toolNames,
              mutatedNodeIds,
              judgeController.signal,
              {
                onProgress: (event) => safeSend(wc, 'subagent:status', slot.id, event),
                onVerdict: (v, attempt, max) => {
                  safeSend(wc, 'judge:verdict', slot.id, v, attempt, max);
                  // Judge FAIL creates remediation tasks directly in TaskStore — notify renderer
                  if (v.verdict === 'FAIL' && slot.taskStore?.size > 0) {
                    safeSend(wc, 'task:updated', slot.id, slot.taskStore.list());
                  }
                  usageTracker?.trackJudgeVerdict({
                    batchId: slot.id,
                    verdict: v.verdict,
                    attempt,
                    maxAttempts: max,
                    failedCriteria: v.criteria.filter((c) => !c.pass).map((c) => c.name),
                    durationMs: Date.now() - judgeStart,
                  });
                },
                onRetryStart: (attempt, max) => safeSend(wc, 'judge:retry-start', slot.id, attempt, max),
              },
            );
            // Metric records ONLY the terminal outcome (after all retries resolved),
            // so verdictCounts reflect "how did this turn end up" — the value Fase 3
            // baselines diff against. Per-attempt history lives in usageTracker above.
            if (finalVerdict) {
              deps.infra?.metricsRegistry?.recordJudgeVerdict(finalVerdict.verdict);
            }
          } catch (err) {
            log.warn({ err, slotId: slot.id }, 'Judge harness error in agent_end');
          } finally {
            judgeInProgress.delete(slot.id);
            judgeAbortControllers.delete(slot.id);
          }
        }
      }
    }

    // Re-check after async judge await: user may have aborted while judge was running
    if (!slot.isStreaming) return;

    // Empty-turn detection: no text and no tool calls means the API call likely failed silently
    const responseLength = turnResponseLength.get(slot.id) ?? 0;
    const toolNamesForCheck = turnToolNames.get(slot.id) ?? [];
    if (responseLength === 0 && toolNamesForCheck.length === 0) {
      safeSend(wc, 'agent:text-delta', slot.id, MSG_EMPTY_TURN_WARNING);
      // F2: emit empty_response only when no llm_stream_error was logged for this promptId
      const errored = slot.lastStreamErrorPromptId && slot.lastStreamErrorPromptId === slot.currentPromptId;
      if (!errored && slot.currentPromptId) {
        const durationMs = slot.promptStartTime ? Date.now() - slot.promptStartTime : 0;
        usageTracker?.trackEmptyResponse?.({
          provider: slot.modelConfig.provider,
          modelId: slot.modelConfig.modelId,
          reason: durationMs < 2000 ? 'suspected_auth' : 'unknown',
          durationMs,
          promptId: slot.currentPromptId,
          slotId: slot.id,
          turnIndex: slot.turnIndex,
        });
      }
    }
    // Clear per-turn error marker regardless of empty/non-empty outcome
    if (slot.lastStreamErrorPromptId === slot.currentPromptId) {
      slot.lastStreamErrorPromptId = null;
    }

    finalizeTurn(slot);
    const next = slot.promptQueue.dequeue();
    if (next) {
      beginTurn(slot, next.text, true, usageTracker, deps.infra);
      // B-021: queued prompts must also feed the suggester, otherwise follow-up
      // chips never appear after a dequeued turn (direct prompts already track this).
      slot.suggester.trackUserPrompt(next.text);
      slot.suggester.resetAssistantText();
      deps.infra?.setWorkflowContext?.(next.text, slot.fileKey ?? '');

      safeSend(wc, 'queue:updated', slot.id, slot.promptQueue.list());
      safeSend(wc, 'agent:queued-prompt-start', slot.id, next.text);
      usageTracker?.trackPromptDequeued(slot.promptQueue.length);
      persistSlotSession(slot);
      slotManager.persistState();
      // B-011 variant on the error path: drop the error if the session has
      // been reset while prompt() was running, otherwise we'd pollute the new
      // chat with the previous turn's failure.
      const guard = captureTurnGuard(slot);
      wrapPromptWithErrorCapture(slot.session, next.text, slot.modelConfig, usageTracker, {
        promptId: slot.currentPromptId ?? undefined,
        slotId: slot.id,
        turnIndex: slot.turnIndex,
      }).catch((err: any) => {
        log.error({ err, slotId: slot.id }, 'Queued prompt failed');
        if (err?.name !== 'AbortError') slot.lastStreamErrorPromptId = slot.currentPromptId;
        if (guard.isStale()) {
          log.debug({ slotId: slot.id, currentTurn: slot.turnIndex }, 'Suppressing queued-prompt error: turn changed');
          return;
        }
        finalizeTurn(slot);
        slot.isStreaming = false;
        slot.promptQueue.clear();
        safeSend(wc, 'agent:text-delta', slot.id, `\n\nError: ${err.message || MSG_REQUEST_FAILED_FALLBACK}`);
        safeSend(wc, 'agent:end', slot.id);
        safeSend(wc, 'queue:updated', slot.id, []);
      });
    } else {
      slot.isStreaming = false;
      safeSend(wc, 'agent:end', slot.id);
      persistSlotSession(slot);
      slotManager.persistState();

      // B-011: drop suggestions if the session was reset while suggest() ran.
      const suggestGuard = captureTurnGuard(slot);
      const suggestStart = Date.now();
      slot.suggester
        .suggest(slot.modelConfig)
        .then((suggestions) => {
          usageTracker?.trackSuggestionsGenerated(suggestions.length, Date.now() - suggestStart);
          if (suggestions.length > 0 && !suggestGuard.isStale()) {
            safeSend(wc, 'agent:suggestions', slot.id, suggestions);
          }
          slot.suggester.resetAssistantText();
        })
        .catch((err) => {
          log.warn({ err, slotId: slot.id }, 'Failed to generate suggestions');
          slot.suggester.resetAssistantText();
        });
    }
  }

  const eventHandlers: Record<string, (wc: Electron.WebContents, slot: SessionSlot, event: any) => void> = {
    message_update: handleMessageUpdate,
    tool_execution_start: handleToolStart,
    tool_execution_end: handleToolEnd,
    message_end: handleMessageEnd,
    agent_end: (wc, slot) => {
      handleAgentEnd(wc, slot).catch((err) => log.error({ err, slotId: slot.id }, 'agent_end handler error'));
    },
    auto_compaction_start: (wc, slot) => safeSend(wc, 'agent:compaction', slot.id, true),
    auto_compaction_end: (wc, slot) => {
      safeSend(wc, 'agent:compaction', slot.id, false);
      usageTracker?.trackCompaction(0, 0);
    },
    auto_retry_start: (wc, slot) => safeSend(wc, 'agent:retry', slot.id, true),
    auto_retry_end: (wc, slot) => safeSend(wc, 'agent:retry', slot.id, false),
  };

  /**
   * Subscribe to a slot's session events and route them to the renderer.
   * Called once per slot (after creation or restore), and again after model switch.
   *
   * Pi SDK's subscribe() has no unsubscribe API. When a model switch replaces
   * slot.session, the old listener becomes a no-op via the stale-event guard.
   */
  return {
    subscribeToSlot(slot: SessionSlot): void {
      if (subscribedSessions.has(slot.session)) return;
      subscribedSessions.add(slot.session);
      // Keep the task extension factory's store ref in sync with the active slot
      deps.infra?.setActiveTaskStore?.(slot.taskStore);
      const wc = mainWindow.webContents;
      const boundSession = slot.session;
      slot.session.subscribe((event: any) => {
        if (slot.session !== boundSession || !slotManager.getSlot(slot.id)) return;
        eventHandlers[event.type]?.(wc, slot, event);
      });
    },
    /** Clean up per-turn accumulators for a slot (e.g. after a failed prompt). */
    finalizeTurn,
    /**
     * Fase 4: expose the in-progress judge set as a read-only view so the
     * MetricsRegistry snapshot can include `judge.inProgressSlotIds` without
     * leaking module-level state.
     */
    getJudgeInProgress: (): ReadonlySet<string> => judgeInProgress,
    /** Abort any running judge for a slot (called from user abort). Delegates to judge-harness. */
    abortJudge(slotId: string): void {
      // Abort via parent signal (stored controller from session-events)
      const ctrl = judgeAbortControllers.get(slotId);
      if (ctrl) {
        ctrl.abort();
        judgeAbortControllers.delete(slotId);
      }
      // Also abort via internal judge mechanism
      abortActiveJudge(slotId);
    },
  };
}
