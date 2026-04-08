import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChildLogger } from '../figma/logger.js';
import { atomicWriteJsonSync } from './fs-utils.js';

const log = createChildLogger({ component: 'app-state' });

export interface PersistedSlot {
  fileKey: string;
  fileName: string;
  modelConfig: { provider: string; modelId: string };
  promptQueue: { id: string; text: string; addedAt: number }[];
  /** Last known input-token count. Restored so the context bar reflects the saved state. B-026. */
  lastContextTokens?: number;
}

export interface AppState {
  version: number;
  savedAt: string;
  activeSlotFileKey: string | null;
  slots: PersistedSlot[];
}

const CURRENT_VERSION = 1;
const DEFAULT_STATE_PATH = path.join(os.homedir(), '.bottega', 'app-state.json');
const DEBOUNCE_MS = 500;

export class AppStatePersistence {
  private statePath: string;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingState: AppState | (() => AppState) | null = null;

  constructor(statePath?: string) {
    this.statePath = statePath || DEFAULT_STATE_PATH;
  }

  /** Read state from disk. Returns null if file doesn't exist or is corrupt. */
  load(): AppState | null {
    try {
      const raw = readFileSync(this.statePath, 'utf-8');
      const parsed = JSON.parse(raw) as AppState;
      // Basic validation
      if (!parsed || typeof parsed.version !== 'number' || !Array.isArray(parsed.slots)) {
        log.warn({ path: this.statePath }, 'Invalid app state file — ignoring');
        return null;
      }
      return parsed;
    } catch (err) {
      log.warn({ err, path: this.statePath }, 'Failed to read app state — starting fresh');
      return null;
    }
  }

  /** Save state to disk (debounced 500ms). Multiple calls within the window → single write. */
  save(stateOrBuilder: AppState | (() => AppState)): void {
    this.pendingState = stateOrBuilder;
    if (this.debounceTimer) return; // already scheduled
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      if (this.pendingState) {
        const state = typeof this.pendingState === 'function' ? this.pendingState() : this.pendingState;
        this.writeToDisk(state);
        this.pendingState = null;
      }
    }, DEBOUNCE_MS);
  }

  /** Force immediate save — bypasses debounce. Use for app shutdown. */
  saveSync(state: AppState): void {
    this.cancelPendingSave();
    this.writeToDisk(state);
  }

  /** Cancel any pending debounced save. */
  cancelPendingSave(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      this.pendingState = null;
    }
  }

  /** Create an AppState snapshot from current data. */
  static createState(activeSlotFileKey: string | null, slots: PersistedSlot[]): AppState {
    return {
      version: CURRENT_VERSION,
      savedAt: new Date().toISOString(),
      activeSlotFileKey,
      slots,
    };
  }

  /** Atomic write: write to .tmp then rename. */
  private writeToDisk(state: AppState): void {
    try {
      atomicWriteJsonSync(this.statePath, state);
      log.debug({ slots: state.slots.length }, 'App state saved');
    } catch (err) {
      log.warn({ err, path: this.statePath }, 'Failed to write app state');
    }
  }
}
