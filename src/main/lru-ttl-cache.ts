/**
 * LRU-TTL cache with insertion-order FIFO eviction.
 *
 * Each entry has a TTL; `get()` returns undefined for expired entries and
 * deletes them lazily. When `size` reaches `maxEntries`, `set()` first sweeps
 * expired entries and then evicts oldest-inserted until there is headroom for
 * the new insert. `size > maxEntries - 1` reservation avoids the thrash path
 * where naive `>= maxEntries` evicts on every insert at the cap boundary.
 *
 * Meant for small-to-medium caches sized in the hundreds. Not a replacement
 * for a general-purpose LRU with tunable sweep cadence.
 */

export interface LruTtlCacheOptions {
  /** Hard cap on entries. Oldest entries are evicted FIFO when exceeded. */
  maxEntries: number;
  /** Default TTL in ms if not overridden on `set()`. */
  defaultTtlMs: number;
  /** Clock override for tests. */
  now?: () => number;
}

interface Entry<V> {
  value: V;
  expires: number;
}

export class LruTtlCache<K, V> {
  private readonly map = new Map<K, Entry<V>>();
  private readonly maxEntries: number;
  private readonly defaultTtlMs: number;
  private readonly now: () => number;

  constructor(options: LruTtlCacheOptions) {
    if (options.maxEntries < 1) throw new Error('maxEntries must be >= 1');
    this.maxEntries = options.maxEntries;
    this.defaultTtlMs = options.defaultTtlMs;
    this.now = options.now ?? (() => Date.now());
  }

  get size(): number {
    return this.map.size;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  set(key: K, value: V, ttlMs?: number): void {
    const now = this.now();
    if (this.map.has(key)) this.map.delete(key); // re-insert at back for proper FIFO
    this.trim(now);
    this.map.set(key, { value, expires: now + (ttlMs ?? this.defaultTtlMs) });
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  private trim(now: number): void {
    if (this.map.size < this.maxEntries) return;
    for (const [k, entry] of this.map) {
      if (entry.expires <= now) this.map.delete(k);
    }
    while (this.map.size > this.maxEntries - 1) {
      const firstKey = this.map.keys().next().value;
      if (firstKey === undefined) break;
      this.map.delete(firstKey);
    }
  }
}
