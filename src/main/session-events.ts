/**
 * Session event routing — handles Pi SDK session events and routes them
 * to the renderer via IPC. Extracted from ipc-handlers.ts to reduce file size.
 */
import { randomUUID } from 'node:crypto';
import { createChildLogger } from '../figma/logger.js';
import type { AgentInfra } from './agent.js';
import { categorizeToolName } from './compression/metrics.js';
import type { AgentSessionLike } from './ipc-handlers.js';
import { MSG_EMPTY_TURN_WARNING, MSG_REQUEST_FAILED_FALLBACK } from './messages.js';
import type { UsageTracker } from './remote-logger.js';
import { safeSend } from './safe-send.js';
import type { SessionSlot, SlotManager } from './slot-manager.js';
import { loadSubagentSettings } from './subagent/config.js';
import { abortActiveJudge, runJudgeHarness } from './subagent/judge-harness.js';

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

/** Initialize a new turn on the slot: assign promptId, increment turnIndex, track prompt. */
export function beginTurn(slot: SessionSlot, text: string, isFollowUp: boolean, usageTracker?: UsageTracker): void {
  const promptId = randomUUID();
  slot.turnIndex += 1;
  slot.currentPromptId = promptId;
  slot.promptStartTime = Date.now();
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

  // ── Per-turn accumulators (keyed by slotId) ──
  const turnToolNames = new Map<string, string[]>();
  const turnResponseLength = new Map<string, number>();

  /** Get prompt correlation context from the slot's current turn. */
  function turnContext(slot: SessionSlot): { promptId: string | undefined; slotId: string; turnIndex: number } {
    return {
      promptId: slot.currentPromptId ?? undefined,
      slotId: slot.id,
      turnIndex: slot.turnIndex,
    };
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
  }

  function handleMessageEnd(wc: Electron.WebContents, slot: SessionSlot, event: any) {
    if (judgeInProgress.has(slot.id)) return;
    const msg = event.message;
    if (msg?.role === 'assistant' && msg.usage) {
      // input = non-cached tokens, cacheRead/cacheWrite = cached tokens
      // contextTokens = total input context (what fills the context window)
      const u = msg.usage;
      const contextTokens = (u.input || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
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

      // Track context fill level on Axiom
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
    }
  }

  /** Emit turn_end metrics and reset per-turn accumulators. */
  function finalizeTurn(slot: SessionSlot): void {
    if (!slot.currentPromptId) return; // idempotent — already finalized
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

    // Preserve last completed turn for feedback correlation
    slot.lastCompletedPromptId = slot.currentPromptId;
    slot.lastCompletedTurnIndex = slot.turnIndex;

    // Reset per-turn state
    turnToolNames.delete(slot.id);
    turnResponseLength.delete(slot.id);
    slot.currentPromptId = null;
    slot.promptStartTime = null;
  }

  async function handleAgentEnd(wc: Electron.WebContents, slot: SessionSlot) {
    if (!slot.isStreaming) return;
    // Re-entrancy guard: judge retry fires agent_end recursively — skip nested calls
    if (judgeInProgress.has(slot.id)) return;

    const toolNames = turnToolNames.get(slot.id) ?? [];

    // Auto-judge: run BEFORE finalizeTurn so retry turns get proper turn tracking
    if (deps.infra && deps.getConnectorForSlot) {
      const settings = loadSubagentSettings();
      if (settings.judgeMode === 'auto') {
        const connector = deps.getConnectorForSlot(slot);
        // Check mutation precondition before emitting judge:running to avoid bogus UI state
        const hasMutations = toolNames.some((n) => {
          const cat = categorizeToolName(n);
          return cat === 'mutation';
        });
        if (connector && hasMutations) {
          judgeInProgress.add(slot.id);
          const judgeStart = Date.now();
          try {
            safeSend(wc, 'judge:running', slot.id);
            const verdict = await runJudgeHarness(
              deps.infra,
              connector,
              slot,
              settings,
              toolNames,
              new AbortController().signal,
              {
                onProgress: (event) => safeSend(wc, 'subagent:status', slot.id, event),
                onVerdict: (v, attempt, max) => safeSend(wc, 'judge:verdict', slot.id, v, attempt, max),
                onRetryStart: (attempt, max) => safeSend(wc, 'judge:retry-start', slot.id, attempt, max),
              },
            );
            if (verdict) {
              usageTracker?.trackJudgeVerdict({
                batchId: slot.id,
                verdict: verdict.verdict,
                attempt: 1,
                maxAttempts: settings.autoRetry ? settings.maxRetries + 1 : 1,
                failedCriteria: verdict.criteria.filter((c) => !c.pass).map((c) => c.name),
                durationMs: Date.now() - judgeStart,
              });
            }
          } catch (err) {
            log.warn({ err, slotId: slot.id }, 'Judge harness error in agent_end');
          } finally {
            judgeInProgress.delete(slot.id);
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
    }

    finalizeTurn(slot);
    const next = slot.promptQueue.dequeue();
    if (next) {
      beginTurn(slot, next.text, true, usageTracker);

      safeSend(wc, 'queue:updated', slot.id, slot.promptQueue.list());
      safeSend(wc, 'agent:queued-prompt-start', slot.id, next.text);
      usageTracker?.trackPromptDequeued(slot.promptQueue.length);
      persistSlotSession(slot);
      slotManager.persistState();
      slot.session.prompt(next.text).catch((err: any) => {
        log.error({ err, slotId: slot.id }, 'Queued prompt failed');
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
      const suggestStart = Date.now();
      slot.suggester
        .suggest(slot.modelConfig)
        .then((suggestions) => {
          usageTracker?.trackSuggestionsGenerated(suggestions.length, Date.now() - suggestStart);
          if (suggestions.length > 0) safeSend(wc, 'agent:suggestions', slot.id, suggestions);
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
      const wc = mainWindow.webContents;
      const boundSession = slot.session;
      slot.session.subscribe((event: any) => {
        if (slot.session !== boundSession || !slotManager.getSlot(slot.id)) return;
        eventHandlers[event.type]?.(wc, slot, event);
      });
    },
    /** Clean up per-turn accumulators for a slot (e.g. after a failed prompt). */
    finalizeTurn,
    /** Abort any running judge for a slot (called from user abort). Delegates to judge-harness. */
    abortJudge(slotId: string): void {
      abortActiveJudge(slotId);
    },
  };
}
