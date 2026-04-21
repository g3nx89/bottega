import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RewindStore } from '../../../../src/main/rewind/store.js';
import type { Checkpoint } from '../../../../src/main/rewind/types.js';

function makeCheckpoint(id: string, fileKey = 'file-1', turnIndex = 1): Checkpoint {
  return {
    id,
    fileKey,
    sessionId: 'session-1',
    slotId: 'slot-1',
    turnIndex,
    prompt: `prompt-${id}`,
    mutations: [
      {
        tool: 'figma_set_fills',
        input: { nodeId: '1:2' },
        nodeIds: ['1:2'],
        preState: { fills: [{ type: 'SOLID', color: '#fff' }] },
        kind: 'inverse-op',
        capturedAt: Date.now(),
      },
    ],
    executeTouched: false,
    timestamp: Date.now(),
    restorableCount: 1,
    nonRestorableCount: 0,
  };
}

describe('RewindStore', () => {
  let root: string;
  let prevQuarantineRoot: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'rewind-store-'));
    prevQuarantineRoot = process.env.BOTTEGA_QUARANTINE_ROOT;
  });

  afterEach(() => {
    if (prevQuarantineRoot === undefined) delete process.env.BOTTEGA_QUARANTINE_ROOT;
    else process.env.BOTTEGA_QUARANTINE_ROOT = prevQuarantineRoot;
  });

  it('append persists payload and index to disk', async () => {
    const store = new RewindStore(root);
    const checkpoint = makeCheckpoint('cp-1');

    await store.append('file-1', checkpoint);

    const indexPath = path.join(root, 'file-1', 'index.json');
    const payloadPath = path.join(root, 'file-1', 'checkpoints', 'cp-1.json');
    const index = JSON.parse(readFileSync(indexPath, 'utf8'));
    const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));

    expect(index.entries).toHaveLength(1);
    expect(index.entries[0]).toMatchObject({ id: 'cp-1', turnIndex: 1, fileKey: 'file-1' });
    expect(payload).toMatchObject({ id: 'cp-1', sessionId: 'session-1', mutations: [{ tool: 'figma_set_fills' }] });
  });

  it('prunes to 20 entries and unlinks stale payloads from disk', async () => {
    const metrics = {
      recordRewindCaptured: vi.fn(),
      recordRewindSkipped: vi.fn(),
      recordRewindCheckpointCreated: vi.fn(),
      recordRewindPruned: vi.fn(),
      recordRewindPluginProbeFailed: vi.fn(),
      recordRewindProbeDeferred: vi.fn(),
      recordRewindRestoreStarted: vi.fn(),
      recordRewindRestoreCompleted: vi.fn(),
      recordRewindRestoreFailed: vi.fn(),
      recordRewindUndoRestore: vi.fn(),
    };
    const store = new RewindStore(root, 20, metrics);

    for (let i = 0; i < 25; i += 1) {
      await store.append('file-1', makeCheckpoint(`cp-${i}`, 'file-1', i + 1));
    }

    const summaries = store.listSummaries('file-1');
    expect(summaries).toHaveLength(20);
    expect(metrics.recordRewindPruned).toHaveBeenCalledTimes(5);
    expect(metrics.recordRewindPruned).toHaveBeenNthCalledWith(1, 1);
    expect(() => readFileSync(path.join(root, 'file-1', 'checkpoints', 'cp-0.json'), 'utf8')).toThrow();
    expect(JSON.parse(readFileSync(path.join(root, 'file-1', 'index.json'), 'utf8')).entries).toHaveLength(20);
  });

  it('quarantines corrupt index files and starts fresh', () => {
    process.env.BOTTEGA_QUARANTINE_ROOT = path.join(root, 'quarantine');
    const indexPath = path.join(root, 'file-1', 'index.json');
    mkdirSync(path.dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, '{not-json', 'utf8');

    const store = new RewindStore(root);
    expect(store.listSummaries('file-1')).toEqual([]);

    const quarantineEntries = readdirSync(process.env.BOTTEGA_QUARANTINE_ROOT!);
    expect(quarantineEntries.length).toBeGreaterThan(0);
  });

  it('serializes concurrent appends on the same fileKey without losing entries', async () => {
    const store = new RewindStore(root);

    await Promise.all([
      store.append('file-1', makeCheckpoint('cp-a', 'file-1', 1)),
      store.append('file-1', makeCheckpoint('cp-b', 'file-1', 2)),
    ]);

    const index = JSON.parse(readFileSync(path.join(root, 'file-1', 'index.json'), 'utf8'));
    expect(index.entries.map((entry: { id: string }) => entry.id).sort()).toEqual(['cp-a', 'cp-b']);
    expect(JSON.parse(readFileSync(path.join(root, 'file-1', 'checkpoints', 'cp-a.json'), 'utf8')).id).toBe('cp-a');
    expect(JSON.parse(readFileSync(path.join(root, 'file-1', 'checkpoints', 'cp-b.json'), 'utf8')).id).toBe('cp-b');
  });

  it('listSummaries returns only summary fields, not full checkpoint payloads', async () => {
    const store = new RewindStore(root);
    await store.append('file-1', makeCheckpoint('cp-1'));

    const [summary] = store.listSummaries('file-1');
    expect(summary).toMatchObject({ id: 'cp-1', restorableCount: 1, executeTouched: false });
    expect(summary).not.toHaveProperty('mutations');
    expect(summary).not.toHaveProperty('sessionId');
  });
});
