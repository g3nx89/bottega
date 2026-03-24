import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../src/main/session-store.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `bottega-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('SessionStore', () => {
  let tmpDir: string;
  let storePath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    storePath = join(tmpDir, 'file-sessions.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should return null for unknown fileKey', () => {
    const store = new SessionStore(storePath);
    expect(store.get('unknown-key')).toBeNull();
  });

  it('should set and get a mapping', () => {
    const store = new SessionStore(storePath);
    store.set('file-abc', '/sessions/session1.jsonl', 'MyDesign.fig');

    const entry = store.get('file-abc');
    expect(entry).not.toBeNull();
    expect(entry!.sessionPath).toBe('/sessions/session1.jsonl');
    expect(entry!.fileName).toBe('MyDesign.fig');
    expect(entry!.lastAccessed).toBeTruthy();
  });

  it('should persist to disk and survive new instance', () => {
    const store1 = new SessionStore(storePath);
    store1.set('file-abc', '/sessions/s1.jsonl', 'Design.fig');

    // Create a new store instance (simulates app restart)
    const store2 = new SessionStore(storePath);
    const entry = store2.get('file-abc');
    expect(entry).not.toBeNull();
    expect(entry!.sessionPath).toBe('/sessions/s1.jsonl');
  });

  it('should overwrite existing mapping on set', () => {
    const store = new SessionStore(storePath);
    store.set('file-abc', '/sessions/old.jsonl', 'Design.fig');
    store.set('file-abc', '/sessions/new.jsonl', 'Design.fig');

    expect(store.get('file-abc')!.sessionPath).toBe('/sessions/new.jsonl');
  });

  it('should remove a mapping', () => {
    const store = new SessionStore(storePath);
    store.set('file-abc', '/sessions/s1.jsonl', 'Design.fig');
    store.remove('file-abc');

    expect(store.get('file-abc')).toBeNull();
  });

  it('should update lastAccessed on touch', () => {
    const store = new SessionStore(storePath);
    store.set('file-abc', '/sessions/s1.jsonl', 'Design.fig');
    const before = store.get('file-abc')!.lastAccessed;

    store.touch('file-abc');
    const after = store.get('file-abc')!.lastAccessed;

    expect(after >= before).toBe(true);
  });

  it('should handle touch on non-existent key gracefully', () => {
    const store = new SessionStore(storePath);
    expect(() => store.touch('missing')).not.toThrow();
  });

  it('should handle corrupted JSON file gracefully', () => {
    writeFileSync(storePath, '{not valid json!!!', 'utf-8');
    const store = new SessionStore(storePath);
    // Should start fresh without throwing
    expect(store.get('anything')).toBeNull();
    // Should be able to write new data
    store.set('file-abc', '/s.jsonl', 'F.fig');
    expect(store.get('file-abc')!.sessionPath).toBe('/s.jsonl');
  });

  it('should create directory if it does not exist', () => {
    const deepPath = join(tmpDir, 'deep', 'nested', 'file-sessions.json');
    const store = new SessionStore(deepPath);
    store.set('file-abc', '/s.jsonl', 'F.fig');

    expect(existsSync(deepPath)).toBe(true);
    const raw = JSON.parse(readFileSync(deepPath, 'utf-8'));
    expect(raw['file-abc'].sessionPath).toBe('/s.jsonl');
  });

  it('should invalidate cache so next read goes to disk', () => {
    const store = new SessionStore(storePath);
    store.set('file-abc', '/s1.jsonl', 'F.fig');

    // Modify file behind the store's back
    const raw = JSON.parse(readFileSync(storePath, 'utf-8'));
    raw['file-abc'].sessionPath = '/modified.jsonl';
    writeFileSync(storePath, JSON.stringify(raw), 'utf-8');

    // Without invalidation, cache returns old value
    expect(store.get('file-abc')!.sessionPath).toBe('/s1.jsonl');

    // After invalidation, reads from disk
    store.invalidateCache();
    expect(store.get('file-abc')!.sessionPath).toBe('/modified.jsonl');
  });

  describe('prune', () => {
    it('should not prune when under limit', () => {
      const store = new SessionStore(storePath, 50);
      store.set('a', '/a.jsonl', 'A.fig');
      store.set('b', '/b.jsonl', 'B.fig');

      store.prune(50);
      expect(store.get('a')).not.toBeNull();
      expect(store.get('b')).not.toBeNull();
    });

    it('should prune oldest entries when over limit', () => {
      const store = new SessionStore(storePath, 999); // high limit so constructor prune is no-op

      // Create entries with known timestamps
      const map: Record<string, any> = {};
      for (let i = 0; i < 5; i++) {
        map[`file-${i}`] = {
          sessionPath: `/s${i}.jsonl`,
          fileName: `F${i}.fig`,
          lastAccessed: new Date(2024, 0, i + 1).toISOString(), // Jan 1-5
        };
      }
      writeFileSync(storePath, JSON.stringify(map), 'utf-8');
      store.invalidateCache();

      store.prune(3); // keep only 3 newest

      // file-0 (Jan 1) and file-1 (Jan 2) should be removed (oldest)
      expect(store.get('file-0')).toBeNull();
      expect(store.get('file-1')).toBeNull();
      // file-2, file-3, file-4 should remain
      expect(store.get('file-2')).not.toBeNull();
      expect(store.get('file-3')).not.toBeNull();
      expect(store.get('file-4')).not.toBeNull();
    });

    it('should auto-prune on construction', () => {
      // Prepopulate with 5 entries
      const map: Record<string, any> = {};
      for (let i = 0; i < 5; i++) {
        map[`file-${i}`] = {
          sessionPath: `/s${i}.jsonl`,
          fileName: `F${i}.fig`,
          lastAccessed: new Date(2024, 0, i + 1).toISOString(),
        };
      }
      writeFileSync(storePath, JSON.stringify(map), 'utf-8');

      // Constructor with maxEntries=3 should auto-prune
      const store = new SessionStore(storePath, 3);
      expect(store.get('file-0')).toBeNull();
      expect(store.get('file-1')).toBeNull();
      expect(store.get('file-4')).not.toBeNull();
    });
  });
});
