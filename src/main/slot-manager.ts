import { randomUUID } from 'node:crypto';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { createChildLogger } from '../figma/logger.js';
import type { FigmaWebSocketServer } from '../figma/websocket-server.js';
import {
  type AgentInfra,
  createFigmaAgentForSlot,
  createScopedTools,
  DEFAULT_MODEL,
  DEFAULT_THINKING_LEVEL,
  type ModelConfig,
  type ThinkingLevel,
} from './agent.js';
import { type AppState, AppStatePersistence } from './app-state-persistence.js';
import type { AgentSessionLike } from './ipc-handlers.js';
import { PromptQueue } from './prompt-queue.js';
import { PromptSuggester } from './prompt-suggester.js';
import type { SessionStore } from './session-store.js';
import type { UsageTracker } from './usage-tracker.js';

const log = createChildLogger({ component: 'slot-manager' });

export const MAX_SLOTS = 4;
export const UNBOUND_FILE_KEY = '__unbound__';

export interface SessionSlot {
  id: string;
  fileKey: string | null;
  fileName: string | null;
  session: AgentSessionLike;
  isStreaming: boolean;
  thinkingLevel: ThinkingLevel;
  modelConfig: ModelConfig;
  suggester: PromptSuggester;
  promptQueue: PromptQueue;
  scopedTools: ToolDefinition[];
  createdAt: number;
}

export interface SlotInfo {
  id: string;
  fileKey: string | null;
  fileName: string | null;
  isStreaming: boolean;
  isConnected: boolean;
  modelConfig: ModelConfig;
  queueLength: number;
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
  private async initSession(session: AgentSessionLike, fileKey: string | null): Promise<void> {
    if (fileKey) {
      const entry = this.sessionStore.get(fileKey);
      if (entry?.sessionPath) {
        try {
          await session.switchSession(entry.sessionPath);
          return;
        } catch (err) {
          log.warn({ err, fileKey }, 'switchSession failed, falling back to newSession');
        }
      }
    }
    await session.newSession();
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
    const { tools } = createScopedTools(this.infra, fileKey || UNBOUND_FILE_KEY);
    const result = await createFigmaAgentForSlot(this.infra, tools, effectiveModel);
    const session = result.session as AgentSessionLike;

    await this.initSession(session, fileKey ?? null);

    const suggester = new PromptSuggester(this.infra.authStorage, this.infra.modelRegistry);

    const slot: SessionSlot = {
      id: randomUUID(),
      fileKey: fileKey ?? null,
      fileName: fileName ?? null,
      session,
      isStreaming: false,
      thinkingLevel: DEFAULT_THINKING_LEVEL,
      modelConfig: effectiveModel,
      suggester,
      promptQueue: new PromptQueue(),
      scopedTools: tools,
      createdAt: Date.now(),
    };

    this.slots.set(slot.id, slot);
    if (fileKey) this.fileKeyIndex.set(fileKey, slot.id);

    if (this._activeSlotId === null) {
      this._activeSlotId = slot.id;
    }

    if (!this._restoring) this.persistState();
    log.info({ slotId: slot.id, fileKey, fileName }, 'Slot created');
    this.usageTracker?.trackSlotCreated(fileKey || '', !!fileKey);

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
    const isConnected =
      slot.fileKey !== null && this.wsServer.getConnectedFiles().some((f) => f.fileKey === slot.fileKey);
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

      // Reuse existing scoped tools — fileKey doesn't change on model switch
      const result = await createFigmaAgentForSlot(this.infra, slot.scopedTools, modelConfig);
      const session = result.session as AgentSessionLike;

      await this.initSession(session, slot.fileKey);

      slot.session = session;
      slot.modelConfig = modelConfig;
      slot.suggester = new PromptSuggester(this.infra.authStorage, this.infra.modelRegistry);
      if (slot.thinkingLevel !== DEFAULT_THINKING_LEVEL) {
        session.setThinkingLevel?.(slot.thinkingLevel);
      }

      this.persistState();
      log.info({ slotId, modelConfig }, 'Session recreated');
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
        })),
    );
  }
}
