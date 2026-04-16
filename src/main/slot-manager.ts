import { randomUUID } from 'node:crypto';
import { getModel } from '@mariozechner/pi-ai';
import type { AgentSessionRuntime, ToolDefinition } from '@mariozechner/pi-coding-agent';
import { createChildLogger } from '../figma/logger.js';
import type { FigmaWebSocketServer } from '../figma/websocket-server.js';
import {
  type AgentInfra,
  createFigmaAgentRuntimeForSlot,
  createScopedTools,
  DEFAULT_MODEL,
  DEFAULT_THINKING_LEVEL,
  type ModelConfig,
  resolveSdkModelId,
  type ThinkingLevel,
} from './agent.js';
import { type AppState, AppStatePersistence } from './app-state-persistence.js';
import type { AgentSessionLike } from './ipc-handlers.js';
import { PromptQueue } from './prompt-queue.js';
import { PromptSuggester } from './prompt-suggester.js';
import type { SessionStore } from './session-store.js';
import { abortActiveJudge } from './subagent/judge-harness.js';
import type { TaskStore } from './tasks/store.js';
import { hashFileKey, type UsageTracker } from './usage-tracker.js';

const log = createChildLogger({ component: 'slot-manager' });

export const MAX_SLOTS = 4;
export const UNBOUND_FILE_KEY = '__unbound__'; // nosemgrep: hard-coded-password — sentinel value, not a password

/** Per-turn analytics correlation state, grouped for clarity. */
export interface TurnTracking {
  turnIndex: number;
  currentPromptId: string | null;
  promptStartTime: number | null;
  lastCompletedPromptId: string | null;
  lastCompletedTurnIndex: number;
}

export interface SessionSlot extends TurnTracking {
  id: string;
  fileKey: string | null;
  fileName: string | null;
  runtime: AgentSessionRuntime;
  /** Getter returning `runtime.session` — derived so no manual sync is needed. */
  readonly session: AgentSessionLike;
  isStreaming: boolean;
  thinkingLevel: ThinkingLevel;
  modelConfig: ModelConfig;
  suggester: PromptSuggester;
  promptQueue: PromptQueue;
  scopedTools: ToolDefinition[];
  taskStore: TaskStore;
  createdAt: number;
  /** Mutable ref for the current provider — tools capture a closure over this for model-aware screenshot optimization. */
  _providerRef: { current: string };
  /** Judge toggle override: true = force on, false = force off, null = follow settings. */
  judgeOverride: boolean | null;
  /** Tool names from the last completed turn — used for force re-run judge. */
  lastTurnToolNames: string[];
  /**
   * Node IDs mutated/created during the last completed turn — used by the judge harness
   * to scope its screenshot to the target node instead of the whole canvas (UX-003).
   */
  lastTurnMutatedNodeIds: string[];
  /** Accumulates all tool names ever called in this session — used for conditional judge skipping. */
  sessionToolHistory: Set<string>;
  /** Last known input-token count for this slot (for restoring context bar after restart). B-026. */
  lastContextTokens?: number;
  /** F2: last promptId where the wrapper emitted a stream error — prevents double-logging empty_response. */
  lastStreamErrorPromptId?: string | null;
}

export interface SlotInfo {
  id: string;
  fileKey: string | null;
  fileName: string | null;
  isStreaming: boolean;
  isConnected: boolean;
  modelConfig: ModelConfig;
  queueLength: number;
  /** Last known input-token count, so the renderer's context bar reflects restored sessions. B-026. */
  lastContextTokens?: number;
}

export class SlotManager {
  private slots = new Map<string, SessionSlot>();
  private fileKeyIndex = new Map<string, string>(); // fileKey → slotId
  private _activeSlotId: string | null = null;
  private _recreateLocks = new Set<string>(); // prevent concurrent recreateSession per slot
  private _restoring = false; // suppress persistState during restoreFromDisk

  constructor(
    private infra: AgentInfra,
    private sessionStore: SessionStore,
    private appState: AppStatePersistence,
    private wsServer: FigmaWebSocketServer,
    private usageTracker?: UsageTracker,
  ) {}

  /** Try switchSession from SessionStore, fall back to newSession. */
  private async initSession(
    runtime: AgentSessionRuntime,
    fileKey: string | null,
    modelConfig?: ModelConfig,
  ): Promise<void> {
    if (fileKey) {
      const entry = this.sessionStore.get(fileKey);
      if (entry?.sessionPath) {
        try {
          await runtime.switchSession(entry.sessionPath);
          // Pi SDK switchSession restores the model from the session file,
          // which may differ from the requested config. Force-override so
          // the active model matches what the user selected / what the slot
          // was created with.
          if (modelConfig) await this.forceModel(runtime.session as AgentSessionLike, modelConfig);
          return;
        } catch (err) {
          log.warn({ err, fileKey }, 'switchSession failed, falling back to newSession');
        }
      }
    }
    await runtime.newSession();
  }

  /**
   * Force the session's active model to match the requested config.
   * Errors propagate: silent failure would leave the agent running the
   * restored-from-file model while the UI + telemetry report the new one.
   */
  private async forceModel(session: AgentSessionLike, modelConfig: ModelConfig): Promise<void> {
    const sdkModelId = resolveSdkModelId(modelConfig.modelId);
    const targetModel = getModel(modelConfig.provider as any, sdkModelId as any);
    if (targetModel && session.setModel) {
      await session.setModel(targetModel);
    }
  }

  async createSlot(fileKey?: string, fileName?: string, modelConfig?: ModelConfig): Promise<SessionSlot> {
    if (this.slots.size >= MAX_SLOTS) {
      throw new Error(`Maximum number of tabs (${MAX_SLOTS}) reached`);
    }
    if (fileKey) {
      const existing = this.getSlotByFileKey(fileKey);
      if (existing) {
        throw new Error(`Slot already exists for file ${fileKey}`);
      }
    }

    const effectiveModel = modelConfig || DEFAULT_MODEL;
    // Mutable ref: tools capture a closure over this; slot manager updates it on model switch
    const providerRef = { current: effectiveModel.provider };
    const { tools, taskStore } = createScopedTools(this.infra, fileKey || UNBOUND_FILE_KEY, () => providerRef.current);
    const runtime = await createFigmaAgentRuntimeForSlot(this.infra, tools, effectiveModel, fileKey);

    await this.initSession(runtime, fileKey ?? null, effectiveModel);

    const suggester = new PromptSuggester(this.infra.authStorage);

    const slot = {
      id: randomUUID(),
      fileKey: fileKey ?? null,
      fileName: fileName ?? null,
      runtime,
      isStreaming: false,
      thinkingLevel: DEFAULT_THINKING_LEVEL,
      modelConfig: effectiveModel,
      _providerRef: providerRef,
      suggester,
      promptQueue: new PromptQueue(),
      scopedTools: tools,
      taskStore,
      createdAt: Date.now(),
      turnIndex: 0,
      currentPromptId: null,
      promptStartTime: null,
      lastCompletedPromptId: null,
      lastCompletedTurnIndex: 0,
      judgeOverride: null,
      lastTurnToolNames: [],
      lastTurnMutatedNodeIds: [],
      sessionToolHistory: new Set<string>(),
    } as unknown as SessionSlot;
    Object.defineProperty(slot, 'session', {
      get(this: SessionSlot) {
        return this.runtime.session as AgentSessionLike;
      },
      enumerable: true,
      configurable: false,
    });

    this.slots.set(slot.id, slot);
    if (fileKey) this.fileKeyIndex.set(fileKey, slot.id);

    if (this._activeSlotId === null) {
      this._activeSlotId = slot.id;
    }

    if (!this._restoring) this.persistState();
    log.info({ slotId: slot.id, fileKey, fileName }, 'Slot created');
    this.usageTracker?.trackSlotCreated(fileKey || '', !!fileKey);
    this.usageTracker?.trackSessionCreated({
      slotId: slot.id,
      provider: effectiveModel.provider,
      modelId: effectiveModel.modelId,
      toolCount: tools.length,
      ...(fileKey && { fileKeyHash: hashFileKey(fileKey) }),
    });

    return slot;
  }

  getSlot(slotId: string): SessionSlot | undefined {
    return this.slots.get(slotId);
  }

  getSlotByFileKey(fileKey: string): SessionSlot | undefined {
    const slotId = this.fileKeyIndex.get(fileKey);
    return slotId ? this.slots.get(slotId) : undefined;
  }

  /** Get SlotInfo for a single slot (direct check, no Set construction). */
  getSlotInfo(slotId: string): SlotInfo | undefined {
    const slot = this.slots.get(slotId);
    if (!slot) return undefined;
    const isConnected = slot.fileKey !== null && this.wsServer.isFileConnected(slot.fileKey);
    return {
      id: slot.id,
      fileKey: slot.fileKey,
      fileName: slot.fileName,
      isStreaming: slot.isStreaming,
      isConnected,
      modelConfig: slot.modelConfig,
      queueLength: slot.promptQueue.length,
    };
  }

  async removeSlot(slotId: string): Promise<void> {
    const slot = this.slots.get(slotId);
    if (!slot) {
      throw new Error(`Slot not found: ${slotId}`);
    }

    abortActiveJudge(slotId);

    if (slot.isStreaming) {
      await slot.session.abort();
      slot.promptQueue.clear();
    }

    this.infra.queueManager.removeQueue(slot.fileKey || UNBOUND_FILE_KEY);
    this.slots.delete(slotId);
    if (slot.fileKey) this.fileKeyIndex.delete(slot.fileKey);

    if (this._activeSlotId === slotId) {
      const first = this.slots.keys().next();
      this._activeSlotId = first.done ? null : first.value;
    }

    this.persistState();
    log.info({ slotId, fileKey: slot.fileKey }, 'Slot removed');
    this.usageTracker?.trackSlotRemoved(slot.fileKey || '');
  }

  async recreateSession(slotId: string, modelConfig: ModelConfig): Promise<void> {
    const slot = this.slots.get(slotId);
    if (!slot) {
      throw new Error(`Slot not found: ${slotId}`);
    }
    abortActiveJudge(slotId);
    // Prevent concurrent recreateSession calls on the same slot (replaces removed switchQueue)
    if (this._recreateLocks.has(slotId)) {
      log.warn({ slotId }, 'recreateSession already in progress — skipping');
      return;
    }
    this._recreateLocks.add(slotId);
    try {
      if (slot.isStreaming) {
        await slot.session.abort();
        slot.isStreaming = false;
        slot.promptQueue.clear();
      }

      // Build + init the replacement BEFORE disposing the old runtime. If
      // construction throws (auth failure, missing model), the slot keeps
      // pointing at the working old runtime instead of a disposed one.
      const runtime = await createFigmaAgentRuntimeForSlot(
        this.infra,
        slot.scopedTools,
        modelConfig,
        slot.fileKey ?? undefined,
      );

      await this.initSession(runtime, slot.fileKey, modelConfig);

      const priorRuntime = slot.runtime;
      slot.runtime = runtime;
      slot.modelConfig = modelConfig;
      void priorRuntime.dispose().catch((err) => log.warn({ err, slotId }, 'runtime.dispose failed'));
      slot._providerRef.current = modelConfig.provider;
      slot.suggester = new PromptSuggester(this.infra.authStorage);
      if (slot.thinkingLevel !== DEFAULT_THINKING_LEVEL) {
        slot.session.setThinkingLevel?.(slot.thinkingLevel);
      }

      this.persistState();
      log.info({ slotId, modelConfig }, 'Session recreated');
      this.usageTracker?.trackSessionCreated({
        slotId,
        provider: modelConfig.provider,
        modelId: modelConfig.modelId,
        toolCount: slot.scopedTools.length,
        ...(slot.fileKey && { fileKeyHash: hashFileKey(slot.fileKey) }),
      });
    } finally {
      this._recreateLocks.delete(slotId);
    }
  }

  listSlots(): SlotInfo[] {
    const connectedKeys = this.getConnectedKeySet();
    return Array.from(this.slots.values()).map((slot) => this.slotToInfo(slot, connectedKeys));
  }

  setActiveSlot(slotId: string): void {
    if (!this.slots.has(slotId)) throw new Error(`Slot not found: ${slotId}`);
    this._activeSlotId = slotId;
    this.persistState();
  }

  get activeSlotId(): string | null {
    return this._activeSlotId;
  }

  get activeSlot(): SessionSlot | undefined {
    if (this._activeSlotId === null) return undefined;
    return this.slots.get(this._activeSlotId);
  }

  async restoreFromDisk(): Promise<number> {
    const state = this.appState.load();
    if (!state) return 0;

    // Suppress per-slot persistState during restore — persist once at the end.
    // Sequential restore avoids burst API calls to Pi SDK (session creation).
    this._restoring = true;
    let slotsCount = 0;
    let totalQueued = 0;
    try {
      for (const persisted of state.slots) {
        try {
          const slot = await this.createSlot(persisted.fileKey, persisted.fileName, persisted.modelConfig);
          slot.promptQueue.restore(persisted.promptQueue);
          // B-026: restore last known context token count so the UI doesn't show 0K on the restarted tab
          if (typeof persisted.lastContextTokens === 'number') {
            slot.lastContextTokens = persisted.lastContextTokens;
          }
          slotsCount++;
          totalQueued += persisted.promptQueue.length;
        } catch (err) {
          log.warn({ err }, 'Failed to restore slot — skipping');
        }
      }
    } finally {
      this._restoring = false;
    }

    if (state.activeSlotFileKey) {
      const activeSlot = this.getSlotByFileKey(state.activeSlotFileKey);
      if (activeSlot) {
        this._activeSlotId = activeSlot.id;
      }
    }

    if (slotsCount > 0) this.persistState();
    log.info({ slotsCount, totalQueued }, 'Slots restored from disk');
    this.usageTracker?.trackAppStateRestored(slotsCount, totalQueued);
    return slotsCount;
  }

  persistState(): void {
    this.appState.save(() => this.buildPersistedState());
  }

  persistStateSync(): void {
    this.appState.saveSync(this.buildPersistedState());
  }

  /** O(1) Set of connected file keys — avoids repeated linear scans. */
  private getConnectedKeySet(): Set<string | null> {
    return new Set(this.wsServer.getConnectedFiles().map((f) => f.fileKey));
  }

  private slotToInfo(slot: SessionSlot, connectedKeys: Set<string | null>): SlotInfo {
    return {
      id: slot.id,
      fileKey: slot.fileKey,
      fileName: slot.fileName,
      isStreaming: slot.isStreaming,
      isConnected: slot.fileKey !== null && connectedKeys.has(slot.fileKey),
      modelConfig: slot.modelConfig,
      queueLength: slot.promptQueue.length,
      lastContextTokens: slot.lastContextTokens,
    };
  }

  private buildPersistedState(): AppState {
    const activeSlot = this._activeSlotId ? this.slots.get(this._activeSlotId) : undefined;
    return AppStatePersistence.createState(
      activeSlot?.fileKey ?? null,
      Array.from(this.slots.values())
        .filter((s) => s.fileKey)
        .map((s) => ({
          fileKey: s.fileKey!,
          fileName: s.fileName || '',
          modelConfig: s.modelConfig,
          promptQueue: s.promptQueue.list(),
          lastContextTokens: s.lastContextTokens,
        })),
    );
  }
}
