import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStatePersistence, type PersistedSlot } from '../src/main/app-state-persistence.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `bottega-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeSlot(
  fileKey: string,
  fileName: string,
  queue: { id: string; text: string; addedAt: number }[] = [],
): PersistedSlot {
  return {
    fileKey,
    fileName,
    modelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
    promptQueue: queue,
  };
}

describe('AppStatePersistence', () => {
  let tmpDir: string;
  let statePath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    statePath = join(tmpDir, 'app-state.json');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('load', () => {
    it('returns null for missing file', () => {
      const persistence = new AppStatePersistence(statePath);
      expect(persistence.load()).toBeNull();
    });

    it('returns null for corrupt JSON', () => {
      writeFileSync(statePath, '{not valid json!!!', 'utf-8');
      const persistence = new AppStatePersistence(statePath);
      expect(persistence.load()).toBeNull();
    });

    it('returns null for valid JSON missing version field', () => {
      writeFileSync(statePath, JSON.stringify({ slots: [], savedAt: new Date().toISOString() }), 'utf-8');
      const persistence = new AppStatePersistence(statePath);
      expect(persistence.load()).toBeNull();
    });

    it('returns null for valid JSON missing slots array', () => {
      writeFileSync(statePath, JSON.stringify({ version: 1, savedAt: new Date().toISOString() }), 'utf-8');
      const persistence = new AppStatePersistence(statePath);
      expect(persistence.load()).toBeNull();
    });

    it('returns null when slots is not an array', () => {
      writeFileSync(statePath, JSON.stringify({ version: 1, slots: {}, savedAt: new Date().toISOString() }), 'utf-8');
      const persistence = new AppStatePersistence(statePath);
      expect(persistence.load()).toBeNull();
    });
  });

  describe('saveSync + load roundtrip', () => {
    it('preserves slots, queue, and activeSlotFileKey', () => {
      const persistence = new AppStatePersistence(statePath);
      const queue = [{ id: 'q1', text: 'Make it blue', addedAt: 1700000000000 }];
      const slots = [makeSlot('file-abc', 'My Design', queue)];
      const state = AppStatePersistence.createState('file-abc', slots);

      persistence.saveSync(state);

      const loaded = persistence.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.activeSlotFileKey).toBe('file-abc');
      expect(loaded!.slots).toHaveLength(1);
      expect(loaded!.slots[0].fileKey).toBe('file-abc');
      expect(loaded!.slots[0].fileName).toBe('My Design');
      expect(loaded!.slots[0].promptQueue).toHaveLength(1);
      expect(loaded!.slots[0].promptQueue[0].text).toBe('Make it blue');
    });

    it('preserves multiple slots with non-empty queues', () => {
      const persistence = new AppStatePersistence(statePath);
      const slots = [
        makeSlot('file-1', 'Design One', [{ id: 'a', text: 'Red background', addedAt: 1 }]),
        makeSlot('file-2', 'Design Two', [
          { id: 'b', text: 'Bold font', addedAt: 2 },
          { id: 'c', text: 'Add shadow', addedAt: 3 },
        ]),
        makeSlot('file-3', 'Design Three'),
      ];
      const state = AppStatePersistence.createState('file-2', slots);

      persistence.saveSync(state);

      const loaded = persistence.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.slots).toHaveLength(3);
      expect(loaded!.slots[1].promptQueue).toHaveLength(2);
      expect(loaded!.activeSlotFileKey).toBe('file-2');
    });

    it('preserves null activeSlotFileKey', () => {
      const persistence = new AppStatePersistence(statePath);
      const state = AppStatePersistence.createState(null, []);

      persistence.saveSync(state);

      const loaded = persistence.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.activeSlotFileKey).toBeNull();
    });

    it('preserves empty slots array', () => {
      const persistence = new AppStatePersistence(statePath);
      const state = AppStatePersistence.createState(null, []);

      persistence.saveSync(state);

      const loaded = persistence.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.slots).toEqual([]);
    });
  });

  describe('atomic write', () => {
    it('no .tmp file remains after saveSync', () => {
      const persistence = new AppStatePersistence(statePath);
      const state = AppStatePersistence.createState(null, [makeSlot('file-x', 'X')]);

      persistence.saveSync(state);

      expect(existsSync(`${statePath}.tmp`)).toBe(false);
      expect(existsSync(statePath)).toBe(true);
    });
  });

  describe('save (debounced)', () => {
    it('multiple calls within 500ms result in a single disk write', () => {
      const persistence = new AppStatePersistence(statePath);
      const state1 = AppStatePersistence.createState('file-1', [makeSlot('file-1', 'First')]);
      const state2 = AppStatePersistence.createState('file-2', [makeSlot('file-2', 'Second')]);
      const state3 = AppStatePersistence.createState('file-3', [makeSlot('file-3', 'Third')]);

      persistence.save(state1);
      persistence.save(state2);
      persistence.save(state3);

      vi.advanceTimersByTime(500);

      // Only one write happens; the last state wins
      const loaded = persistence.load();
      expect(loaded).not.toBeNull();
      expect(loaded!.activeSlotFileKey).toBe('file-3');
    });

    it('state is not on disk before timer fires', () => {
      const persistence = new AppStatePersistence(statePath);
      const state = AppStatePersistence.createState('file-a', [makeSlot('file-a', 'Alpha')]);

      persistence.save(state);

      // Timer has not fired yet
      expect(existsSync(statePath)).toBe(false);
    });

    it('state is on disk after advancing timers by 500ms', () => {
      const persistence = new AppStatePersistence(statePath);
      const state = AppStatePersistence.createState('file-a', [makeSlot('file-a', 'Alpha')]);

      persistence.save(state);
      vi.advanceTimersByTime(500);

      expect(existsSync(statePath)).toBe(true);
      const loaded = persistence.load();
      expect(loaded!.activeSlotFileKey).toBe('file-a');
    });
  });

  describe('save with builder function', () => {
    it('builder is called lazily when debounce fires, not at save() time', () => {
      const persistence = new AppStatePersistence(statePath);
      let buildCount = 0;
      const builder = () => {
        buildCount++;
        return AppStatePersistence.createState('file-lazy', [makeSlot('file-lazy', 'Lazy')]);
      };

      persistence.save(builder);
      persistence.save(builder);
      persistence.save(builder);

      // Builder not called yet — still debouncing
      expect(buildCount).toBe(0);

      vi.advanceTimersByTime(500);

      // Builder called exactly once when the timer fires
      expect(buildCount).toBe(1);
      const loaded = persistence.load();
      expect(loaded!.activeSlotFileKey).toBe('file-lazy');
    });
  });

  describe('cancelPendingSave', () => {
    it('prevents the pending debounced write', () => {
      const persistence = new AppStatePersistence(statePath);
      const state = AppStatePersistence.createState('file-z', [makeSlot('file-z', 'Zeta')]);

      persistence.save(state);
      persistence.cancelPendingSave();
      vi.advanceTimersByTime(500);

      expect(existsSync(statePath)).toBe(false);
    });
  });

  describe('saveSync bypasses debounce', () => {
    it('writes immediately even when a debounced save is pending', () => {
      const persistence = new AppStatePersistence(statePath);
      const debounced = AppStatePersistence.createState('file-debounced', [makeSlot('file-debounced', 'Debounced')]);
      const immediate = AppStatePersistence.createState('file-immediate', [makeSlot('file-immediate', 'Immediate')]);

      persistence.save(debounced);
      persistence.saveSync(immediate);

      // saveSync should have written immediately
      expect(existsSync(statePath)).toBe(true);
      const loaded = persistence.load();
      expect(loaded!.activeSlotFileKey).toBe('file-immediate');

      // Advancing timers should not trigger another write (pending was cancelled)
      vi.advanceTimersByTime(500);
      const loadedAfter = persistence.load();
      expect(loadedAfter!.activeSlotFileKey).toBe('file-immediate');
    });
  });

  describe('directory creation', () => {
    it('auto-creates directory if missing', () => {
      const deepPath = join(tmpDir, 'deep', 'nested', 'app-state.json');
      const persistence = new AppStatePersistence(deepPath);
      const state = AppStatePersistence.createState(null, [makeSlot('file-d', 'Deep')]);

      persistence.saveSync(state);

      expect(existsSync(deepPath)).toBe(true);
    });
  });

  describe('createState static helper', () => {
    it('produces correct structure', () => {
      const slots = [makeSlot('file-s', 'Static')];
      const state = AppStatePersistence.createState('file-s', slots);

      expect(state.version).toBe(1);
      expect(state.activeSlotFileKey).toBe('file-s');
      expect(state.slots).toBe(slots);
      expect(typeof state.savedAt).toBe('string');
      expect(() => new Date(state.savedAt)).not.toThrow();
    });

    it('version field is 1', () => {
      const state = AppStatePersistence.createState(null, []);
      expect(state.version).toBe(1);
    });
  });
});
