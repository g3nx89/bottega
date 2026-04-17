/**
 * LruTtlCache contract tests. Injected clock verifies TTL + FIFO eviction
 * without relying on real Date.now timing.
 */

import { describe, expect, it } from 'vitest';
import { LruTtlCache } from '../../../src/main/lru-ttl-cache.js';

function fakeClock(initial = 1000) {
  let t = initial;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('LruTtlCache', () => {
  it('stores and retrieves values', () => {
    const cache = new LruTtlCache<string, number>({ maxEntries: 3, defaultTtlMs: 1000 });
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.has('a')).toBe(true);
  });

  it('expires entries past TTL', () => {
    const clock = fakeClock();
    const cache = new LruTtlCache<string, number>({ maxEntries: 3, defaultTtlMs: 100, now: clock.now });
    cache.set('a', 1);
    clock.advance(50);
    expect(cache.get('a')).toBe(1);
    clock.advance(60);
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts oldest entry when full (FIFO insertion order)', () => {
    const cache = new LruTtlCache<string, number>({ maxEntries: 3, defaultTtlMs: 1000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // evicts 'a'
    expect(cache.has('a')).toBe(false);
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('does not thrash at exact cap boundary (H2 regression)', () => {
    const cache = new LruTtlCache<string, number>({ maxEntries: 2, defaultTtlMs: 10_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    // Re-setting an existing key must not evict anything unrelated
    cache.set('a', 10);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(10);
    expect(cache.get('b')).toBe(2);
  });

  it('sweeps expired entries first before FIFO eviction', () => {
    const clock = fakeClock();
    const cache = new LruTtlCache<string, number>({ maxEntries: 3, defaultTtlMs: 100, now: clock.now });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    clock.advance(150); // all expire
    cache.set('d', 4); // should sweep expired, not just evict 'a'
    expect(cache.size).toBe(1);
    expect(cache.get('d')).toBe(4);
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(false);
    expect(cache.has('c')).toBe(false);
  });

  it('delete removes key and clear empties', () => {
    const cache = new LruTtlCache<string, number>({ maxEntries: 3, defaultTtlMs: 1000 });
    cache.set('a', 1);
    cache.delete('a');
    expect(cache.has('a')).toBe(false);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('rejects maxEntries < 1', () => {
    expect(() => new LruTtlCache<string, number>({ maxEntries: 0, defaultTtlMs: 100 })).toThrow();
  });

  it('per-set TTL overrides default', () => {
    const clock = fakeClock();
    const cache = new LruTtlCache<string, number>({ maxEntries: 3, defaultTtlMs: 1000, now: clock.now });
    cache.set('a', 1, 50);
    clock.advance(60);
    expect(cache.get('a')).toBeUndefined();
  });
});
