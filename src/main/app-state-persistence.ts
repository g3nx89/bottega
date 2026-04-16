import os from 'node:os';
import path from 'node:path';
import { createChildLogger } from '../figma/logger.js';
import { atomicWriteJsonSync, readJsonOrQuarantine } from './fs-utils.js';

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
  /** Idempotency flag: legacy dated model IDs migrated to the new family names. */
  _migratedModelIds?: boolean;
}

/**
 * Anthropic retired dated model IDs (e.g. claude-sonnet-4-20250514) in favor of
 * family IDs (claude-sonnet-4-6). Users with stale app-state files still point
 * at the dated IDs and get `getModel() === undefined` at session start.
 * Migrate in place on load so the next save normalizes to the new IDs.
 */
const LEGACY_MODEL_ID_MAP: Record<string, string> = {
  'claude-sonnet-4-20250514': 'claude-sonnet-4-6',
  'claude-opus-4-20250514': 'claude-opus-4-6',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-6',
  'claude-opus-4-5-20250929': 'claude-opus-4-6',
};

export function migrateLegacyModelIds(state: AppState): AppState {
  if (state._migratedModelIds) return state;
  let migratedCount = 0;
  const slots = state.slots.map((slot) => {
    const replacement = LEGACY_MODEL_ID_MAP[slot.modelConfig?.modelId];
    if (!replacement) return slot;
    migratedCount++;
    return { ...slot, modelConfig: { ...slot.modelConfig, modelId: replacement } };
  });
  if (migratedCount > 0) {
    log.info({ count: migratedCount }, 'Migrated legacy model IDs');
  }
  return { ...state, slots, _migratedModelIds: true };
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

  /** Read state from disk. Corrupt files are quarantined; returns null to start fresh. */
  load(): AppState | null {
    const state = readJsonOrQuarantine<AppState>(
      this.statePath,
      (v): v is AppState =>
        !!v && typeof v === 'object' && typeof (v as any).version === 'number' && Array.isArray((v as any).slots),
    );
    if (!state) return null;
    return migrateLegacyModelIds(state);
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
