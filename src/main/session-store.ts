import os from 'node:os';
import path from 'node:path';
import { createChildLogger } from '../figma/logger.js';
import { atomicWriteJsonSync, readJsonOrQuarantine } from './fs-utils.js';

const log = createChildLogger({ component: 'session-store' });

export interface FileSessionEntry {
  sessionPath: string;
  fileName: string;
  lastAccessed: string; // ISO timestamp
}

export type FileSessionMap = Record<string, FileSessionEntry>;

const DEFAULT_STORE_PATH = path.join(os.homedir(), '.bottega', 'file-sessions.json');

/**
 * Persists the mapping between Figma fileKeys and their Pi SDK session paths.
 * Enables session restore when the same file reconnects after app restart.
 */
export class SessionStore {
  private storePath: string;
  /** Live reference — load() returns this, mutators modify in place. */
  private cache: FileSessionMap | null = null;

  constructor(
    storePath?: string,
    private maxEntries = 100,
  ) {
    this.storePath = storePath || DEFAULT_STORE_PATH;
    this.prune();
  }

  /** Read the mapping from disk (cached after first read). Returns the live cache reference. */
  private load(): FileSessionMap {
    if (this.cache) return this.cache;
    const parsed = readJsonOrQuarantine<FileSessionMap>(
      this.storePath,
      (v): v is FileSessionMap => !!v && typeof v === 'object' && !Array.isArray(v),
    );
    this.cache = parsed ?? {};
    return this.cache;
  }

  /** Atomically write the mapping to disk. */
  private save(): void {
    if (!this.cache) return;
    try {
      atomicWriteJsonSync(this.storePath, this.cache);
    } catch (err) {
      log.warn({ err, path: this.storePath }, 'Failed to write session store');
    }
  }

  get(fileKey: string): FileSessionEntry | null {
    return this.load()[fileKey] ?? null;
  }

  set(fileKey: string, sessionPath: string, fileName: string): void {
    this.load()[fileKey] = {
      sessionPath,
      fileName,
      lastAccessed: new Date().toISOString(),
    };
    this.save();
  }

  remove(fileKey: string): void {
    delete this.load()[fileKey];
    this.save();
  }

  touch(fileKey: string): void {
    const entry = this.load()[fileKey];
    if (entry) {
      entry.lastAccessed = new Date().toISOString();
      this.save();
    }
  }

  /** Remove oldest entries beyond the configured limit, sorted by lastAccessed. */
  prune(maxEntries = this.maxEntries): void {
    const map = this.load();
    const keys = Object.keys(map);
    if (keys.length <= maxEntries) return;

    keys.sort((a, b) => (map[a]!.lastAccessed || '').localeCompare(map[b]!.lastAccessed || ''));

    const toRemove = keys.slice(0, keys.length - maxEntries);
    for (const key of toRemove) {
      delete map[key];
    }
    this.save();
    log.info({ removed: toRemove.length, remaining: maxEntries }, 'Pruned stale session mappings');
  }

  invalidateCache(): void {
    this.cache = null;
  }
}
