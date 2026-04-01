/**
 * UsageTracker — structured usage analytics for remote diagnostics.
 *
 * Emits typed events via pino logger. All methods are no-op when
 * diagnostics are disabled (zero overhead). Uses a private emit()
 * helper to reduce boilerplate.
 */

import crypto from 'node:crypto';
import os from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type pino from 'pino';
import type { DiagnosticsConfig } from '../shared/diagnostics-config.js';
import type { SystemInfo } from './diagnostics.js';
import { captureSettings, captureVitals, type SettingsRefs } from './vitals.js';

const HEARTBEAT_INTERVAL_MS = 10_000; // 10 seconds
const HOME = os.homedir();

/** Hash Figma file keys before sending to Axiom (privacy). 64-bit truncation. */
export function hashFileKey(fileKey: string): string {
  return crypto.createHash('sha256').update(fileKey).digest('hex').slice(0, 16);
}

/** Redact home directory from file paths. */
function redactPaths(text: string): string {
  return text.replaceAll(HOME, '~');
}

/** Redact sensitive patterns from error messages. Exported for testing. */
export function redactMessage(msg: string): string {
  return redactPaths(msg)
    .replace(/(?:sk-|key-|token-|xoxb-|xoxp-|xapp-|ghp_|gsk_|glpat-|npm_|figd_|AIza)[a-zA-Z0-9_-]{10,}/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}

/** Conditionally spread promptId/slotId/turnIndex when present. */
function spreadTurnContext(ctx?: { promptId?: string; slotId?: string; turnIndex?: number }): Record<string, unknown> {
  if (!ctx) return {};
  return {
    ...(ctx.promptId && { promptId: ctx.promptId }),
    ...(ctx.slotId && { slotId: ctx.slotId }),
    ...(ctx.turnIndex != null && { turnIndex: ctx.turnIndex }),
  };
}

export class UsageTracker {
  private logger: pino.Logger;
  private config: DiagnosticsConfig;
  private refs: SettingsRefs;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private eld: ReturnType<typeof monitorEventLoopDelay> | null = null;
  private figmaConnected = false;
  private rendererResponsive = true;

  constructor(logger: pino.Logger, config: DiagnosticsConfig, refs: SettingsRefs) {
    this.logger = logger;
    this.config = config;
    this.refs = refs;
  }

  get enabled(): boolean {
    return this.config.sendDiagnostics;
  }

  /** Emit a usage event. No-op when disabled. Vitals can be attached inline for error events. */
  private emit(event: string, data: Record<string, unknown> = {}, includeVitals = false): void {
    if (!this.enabled) return;
    const payload = includeVitals ? { ...data, vitals: captureVitals(this.eld ?? undefined) } : data;
    this.logger.info({ event, ...payload });
  }

  // ── Heartbeat ────────────────────────

  startHeartbeat(): void {
    if (!this.enabled) return;

    this.eld = monitorEventLoopDelay({ resolution: 20 });
    this.eld.enable();

    this.heartbeatTimer = setInterval(() => {
      this.emitHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    this.heartbeatTimer.unref();
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.eld) {
      this.eld.disable();
      this.eld = null;
    }
  }

  private emitHeartbeat(): void {
    this.emit('usage:heartbeat', {
      ...captureVitals(this.eld ?? undefined),
      figmaWsConnected: this.figmaConnected,
      rendererResponsive: this.rendererResponsive,
    });
    this.eld?.reset();
  }

  // ── State setters ────────────────────

  setFigmaConnected(connected: boolean): void {
    this.figmaConnected = connected;
  }

  setRendererResponsive(responsive: boolean): void {
    this.rendererResponsive = responsive;
  }

  // ── Lifecycle events ─────────────────

  trackAppLaunch(systemInfo: SystemInfo, startupMs: number, isFirstLaunchAfterUpdate: boolean): void {
    this.emit('usage:app_launch', {
      system: {
        anonymousId: this.config.anonymousId,
        appVersion: systemInfo.app.version,
        electronVersion: systemInfo.app.electron,
        nodeVersion: systemInfo.app.node,
        os: systemInfo.os.platform,
        osRelease: systemInfo.os.release,
        arch: systemInfo.os.arch,
        cpuModel: systemInfo.cpu.model,
        cpuCores: systemInfo.cpu.cores,
        totalRamGB: systemInfo.ram.totalGB,
        diskTotalGB: systemInfo.disk.totalGB,
        locale: systemInfo.locale,
        timezone: systemInfo.timezone,
      },
      settings: captureSettings(this.refs),
      startupMs,
      isFirstLaunchAfterUpdate,
    });
  }

  trackSessionStart(model: { provider: string; modelId: string }, contextSize: number): void {
    this.emit('usage:session_start', { model, contextSize });
  }

  trackSessionEnd(data: {
    durationMs: number;
    totalToolCalls: number;
    tokensInput: number;
    tokensOutput: number;
    tokensSaved: number;
    compactionTriggered: boolean;
  }): void {
    this.emit('usage:session_end', data);
  }

  trackAppQuit(uptimeSeconds: number, sessionsCompleted: number): void {
    this.emit('usage:app_quit', { uptimeSeconds, sessionsCompleted }, true);
  }

  // ── Agent interaction events ─────────

  trackPrompt(
    charLength: number,
    isFollowUp: boolean,
    context?: { promptId: string; slotId: string; turnIndex: number; content: string },
  ): void {
    this.emit('usage:prompt', {
      charLength,
      isFollowUp,
      ...spreadTurnContext(context),
      ...(context?.content && { contentPreview: context.content.slice(0, 500) }),
    });
  }

  trackToolCall(
    toolName: string,
    category: string,
    success: boolean,
    durationMs: number,
    context?: {
      promptId?: string;
      slotId?: string;
      turnIndex?: number;
      screenshotMeta?: { nodeId?: string; scale?: number; format?: string };
    },
  ): void {
    this.emit('usage:tool_call', {
      toolName,
      category,
      success,
      durationMs,
      ...spreadTurnContext(context),
      ...(context?.screenshotMeta && { screenshotMeta: context.screenshotMeta }),
    });
  }

  trackTurnEnd(data: {
    promptId: string;
    slotId: string;
    turnIndex: number;
    responseCharLength: number;
    responseDurationMs: number;
    toolCallCount: number;
    toolNames: string[];
    hasAction: boolean;
  }): void {
    this.emit('usage:turn_end', data);
  }

  trackToolError(
    toolName: string,
    errorMessage: string,
    errorCode?: string,
    context?: { promptId?: string; slotId?: string; turnIndex?: number },
  ): void {
    this.emit('usage:tool_error', {
      toolName,
      errorMessage: redactMessage(errorMessage),
      errorCode,
      ...spreadTurnContext(context),
    });
  }

  trackAgentError(errorType: string, message: string): void {
    this.emit('usage:agent_error', { errorType, message: redactMessage(message) });
  }

  trackContextLevel(data: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    contextWindow: number;
    fillPercent: number;
    slotId: string;
    turnIndex: number;
    modelId: string;
  }): void {
    this.emit('usage:context_level', data);
  }

  trackCompaction(tokensBefore: number, tokensAfter: number): void {
    this.emit('usage:compaction', { tokensBefore, tokensAfter, tokensSaved: tokensBefore - tokensAfter });
  }

  // ── Settings change events ───────────

  trackModelSwitch(before: { provider: string; modelId: string }, after: { provider: string; modelId: string }): void {
    this.emit('usage:model_switch', { before, after });
  }

  trackThinkingChange(before: string, after: string): void {
    this.emit('usage:thinking_change', { before, after });
  }

  trackCompressionProfileChange(before: string, after: string): void {
    this.emit('usage:compression_profile_change', { before, after });
  }

  // ── Figma events ─────────────────────

  trackFigmaConnected(fileKey: string, connectTimeMs: number): void {
    this.emit('usage:figma_connected', { fileKeyHash: hashFileKey(fileKey), connectTimeMs });
  }

  trackFigmaDisconnected(reason?: string, connectionDurationMs?: number): void {
    this.emit('usage:figma_disconnected', { reason, connectionDurationMs });
  }

  trackFigmaPluginInstalled(success: boolean): void {
    this.emit('usage:figma_plugin_installed', { success });
  }

  // ── Image generation events ──────────

  trackImageGen(imageType: string, model: string, success: boolean, durationMs: number): void {
    this.emit('usage:image_gen', { imageType, model, success, durationMs });
  }

  // ── Feedback events ──────────────────

  trackFeedback(data: {
    sentiment: 'positive' | 'negative';
    issueType?: string;
    details?: string;
    promptId?: string;
    slotId?: string;
    turnIndex?: number;
  }): void {
    this.emit('usage:feedback', {
      ...data,
      ...(data.details && { details: redactMessage(data.details) }),
    });
  }

  // ── Suggestion events ────────────────

  trackSuggestionsGenerated(count: number, durationMs: number): void {
    this.emit('usage:suggestions_generated', { count, durationMs });
  }

  trackSuggestionClicked(suggestionIndex: number): void {
    this.emit('usage:suggestion_clicked', { suggestionIndex });
  }

  // ── Error events (with inline vitals) ─

  trackUncaughtException(error: { name: string; message: string; stack?: string }): void {
    this.emit(
      'usage:uncaught_exception',
      { errorName: error.name, errorMessage: redactMessage(error.message), stack: redactPaths(error.stack ?? '') },
      true,
    );
  }

  trackUnhandledRejection(error: { name?: string; code?: string; message?: string }): void {
    this.emit(
      'usage:unhandled_rejection',
      { errorName: error.name, errorCode: error.code, errorMessage: redactMessage(error.message ?? '') },
      true,
    );
  }

  trackRendererCrash(reason: string, exitCode: number): void {
    this.emit('usage:renderer_crash', { reason, exitCode }, true);
  }

  // ── Multi-tab events ──────────────────

  trackSlotCreated(fileKey: string, automatic: boolean): void {
    this.emit('usage:slot_created', { fileKeyHash: hashFileKey(fileKey), automatic });
  }

  trackSlotRemoved(fileKey: string): void {
    this.emit('usage:slot_removed', { fileKeyHash: hashFileKey(fileKey) });
  }

  trackPromptEnqueued(queueLength: number): void {
    this.emit('usage:prompt_enqueued', { queueLength });
  }

  trackPromptDequeued(queueLength: number): void {
    this.emit('usage:prompt_dequeued', { queueLength });
  }

  trackPromptQueueEdited(): void {
    this.emit('usage:prompt_queue_edited', {});
  }

  trackPromptQueueCancelled(): void {
    this.emit('usage:prompt_queue_cancelled', {});
  }

  trackAppStateRestored(slotsCount: number, totalQueuedPrompts: number): void {
    this.emit('usage:app_state_restored', { slotsCount, totalQueuedPrompts });
  }

  trackOperationProgress(data: {
    operationId: string;
    percent: number;
    message: string;
    itemsProcessed?: number;
    totalItems?: number;
  }): void {
    this.emit('usage:operation_progress', data);
  }
}
