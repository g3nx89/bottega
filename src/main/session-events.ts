/**
 * Session event routing — handles Pi SDK session events and routes them
 * to the renderer via IPC. Extracted from ipc-handlers.ts to reduce file size.
 */
import { createChildLogger } from '../figma/logger.js';
import { categorizeToolName } from './compression/metrics.js';
import type { AgentSessionLike } from './ipc-handlers.js';
import { MSG_REQUEST_FAILED_FALLBACK } from './messages.js';
import type { UsageTracker } from './remote-logger.js';
import { safeSend } from './safe-send.js';
import type { SessionSlot, SlotManager } from './slot-manager.js';

const log = createChildLogger({ component: 'session-events' });

export interface EventRouterDeps {
  slotManager: SlotManager;
  mainWindow: { webContents: Electron.WebContents };
  usageTracker?: UsageTracker;
  persistSlotSession: (slot: SessionSlot) => void;
}

export function createEventRouter(deps: EventRouterDeps) {
  const { slotManager, mainWindow, usageTracker, persistSlotSession } = deps;
  const toolStartTimes = new Map<string, number>();
  const subscribedSessions = new WeakSet<AgentSessionLike>();

  function handleMessageUpdate(wc: Electron.WebContents, slot: SessionSlot, event: any) {
    if (event.assistantMessageEvent?.type === 'text_delta') {
      safeSend(wc, 'agent:text-delta', slot.id, event.assistantMessageEvent.delta);
      slot.suggester.appendAssistantText(event.assistantMessageEvent.delta);
    }
    if (event.assistantMessageEvent?.type === 'thinking_delta') {
      safeSend(wc, 'agent:thinking', slot.id, event.assistantMessageEvent.delta);
    }
  }

  function handleToolStart(wc: Electron.WebContents, slot: SessionSlot, event: any) {
    log.info({ tool: event.toolName, callId: event.toolCallId, slotId: slot.id }, 'Tool start');
    safeSend(wc, 'agent:tool-start', slot.id, event.toolName, event.toolCallId);
    toolStartTimes.set(event.toolCallId, Date.now());
  }

  function handleToolEnd(wc: Electron.WebContents, slot: SessionSlot, event: any) {
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
    if (event.isError) {
      usageTracker?.trackToolError(event.toolName, JSON.stringify(resultPreview), undefined);
    }
    usageTracker?.trackToolCall(event.toolName, category, !event.isError, durationMs);

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
    const msg = event.message;
    if (msg?.role === 'assistant' && msg.usage) {
      safeSend(wc, 'agent:usage', slot.id, {
        input: msg.usage.input,
        output: msg.usage.output,
        total: msg.usage.totalTokens,
      });
    }
  }

  function handleAgentEnd(wc: Electron.WebContents, slot: SessionSlot) {
    if (!slot.isStreaming) return;
    const next = slot.promptQueue.dequeue();
    if (next) {
      safeSend(wc, 'queue:updated', slot.id, slot.promptQueue.list());
      safeSend(wc, 'agent:queued-prompt-start', slot.id, next.text);
      usageTracker?.trackPromptDequeued(slot.promptQueue.length);
      persistSlotSession(slot);
      slotManager.persistState();
      slot.session.prompt(next.text).catch((err: any) => {
        log.error({ err, slotId: slot.id }, 'Queued prompt failed');
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
    agent_end: (wc, slot) => handleAgentEnd(wc, slot),
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
  return function subscribeToSlot(slot: SessionSlot): void {
    if (subscribedSessions.has(slot.session)) return;
    subscribedSessions.add(slot.session);
    const wc = mainWindow.webContents;
    const boundSession = slot.session;
    slot.session.subscribe((event: any) => {
      if (slot.session !== boundSession || !slotManager.getSlot(slot.id)) return;
      eventHandlers[event.type]?.(wc, slot, event);
    });
  };
}
