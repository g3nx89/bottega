/**
 * Tier 0 — Rewind IPC end-to-end (no Anthropic API, no Figma)
 *
 * Validates the full real IPC surface registered by src/main/rewind/ipc.ts
 * and the test-IPC in src/main/rewind/test-ipc.ts, without an LLM turn.
 *
 * These tests complement the UAT modal specs (DOM-level) and the unit/playbook
 * specs (in-process) by exercising the Electron boot → preload → ipcMain path
 * for real: `window.api.checkpoint.*` calls cross the process boundary.
 *
 * Scope limits (documented in-session):
 *   • No agent turn → seed checkpoints carry mutations=[] (test-IPC limitation)
 *     so checkpoint:restore on seeded checkpoints always returns success=false.
 *     Restore with real mutations is covered at unit level (rewind-playbook +
 *     restore.test.ts) because the test-IPC surface cannot inject mutation
 *     snapshots today, and adding that to src/ is out of scope for this spec.
 *   • Figma plugin probe flow is exercised only in the "deferred" branch (no
 *     file connected). The "completed" branch requires real Figma Desktop.
 */

import { rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { launchApp } from '../../helpers/launch.mjs';

/** @type {import('@playwright/test').ElectronApplication | undefined} */
let app;
/** @type {import('@playwright/test').Page | undefined} */
let win;
/** @type {string | undefined} */
let stateDir;

test.beforeEach(async () => {
  ({ app, window: win, stateDir } = await launchApp({
    env: {
      BOTTEGA_AGENT_TEST: '1',
      BOTTEGA_TEST_MOCK_AUTH: '1',
      BOTTEGA_SKIP_RESTORE: '1',
    },
  }));
  await win.evaluate(() => window.api.__testResetMetrics());
});

test.afterEach(async () => {
  if (win) {
    try {
      await win.evaluate(() => window.api.__testResetMetrics());
    } catch {}
  }
  if (app) await app.close();
  app = undefined;
  win = undefined;
  if (stateDir) rmSync(stateDir, { recursive: true, force: true });
  stateDir = undefined;
});

test.describe('tier0 — rewind IPC end-to-end', () => {
  test('boot wires the rewind metrics surface without failed probes', async () => {
    // Architectural limitation: probe only runs on Pi SDK session start (via
    // the rewind extension-factory hook). Without an LLM turn we cannot trigger
    // probeStarted/probeDeferred — those belong to an agent-level LLM test.
    // What we CAN verify at boot is that the metrics surface is wired (the keys
    // exist, counters start at zero) and no pluginProbeFailed fires from init.
    await win.evaluate(async () => {
      await window.api.createTab('tier0-boot-file', 'Boot');
    });

    const metrics = await win.evaluate(() => window.api.__testGetMetrics());
    expect(metrics.rewind).toMatchObject({
      captured: 0,
      skipped: 0,
      created: 0,
      pruned: 0,
      pluginProbeFailed: 0,
      probeDeferred: expect.any(Number),
      restoreStarted: 0,
      restoreCompleted: 0,
      restoreFailed: 0,
      undoRestore: { success: 0, noToken: 0, expired: 0 },
    });
  });

  test('checkpoint:list returns seeded summaries via real IPC', async () => {
    await win.evaluate(async () => {
      await window.api.createTab('tier0-list-file', 'List');
      await window.api.__testSeedRewindCheckpoint({
        fileKey: 'tier0-list-file',
        prompt: 'first',
        turnIndex: 1,
      });
      await window.api.__testSeedRewindCheckpoint({
        fileKey: 'tier0-list-file',
        prompt: 'second',
        turnIndex: 2,
      });
    });

    const summaries = await win.evaluate(() =>
      window.api.checkpoint.list('tier0-list-file'),
    );
    expect(summaries).toHaveLength(2);
    const prompts = summaries.map((s) => s.prompt).sort();
    expect(prompts).toEqual(['first', 'second']);
  });

  test('checkpoint:preview returns the full checkpoint record', async () => {
    await win.evaluate(async () => {
      await window.api.createTab('tier0-preview-file', 'Preview');
    });
    const seed = await win.evaluate(() =>
      window.api.__testSeedRewindCheckpoint({
        fileKey: 'tier0-preview-file',
        prompt: 'preview me',
        restorableCount: 3,
        nonRestorableCount: 1,
        turnIndex: 7,
      }),
    );

    const preview = await win.evaluate(
      async ([fileKey, id]) => window.api.checkpoint.preview(fileKey, id),
      ['tier0-preview-file', seed.id],
    );

    expect(preview).toMatchObject({
      id: seed.id,
      fileKey: 'tier0-preview-file',
      prompt: 'preview me',
      restorableCount: 3,
      nonRestorableCount: 1,
      turnIndex: 7,
      // Test-IPC seed cannot inject real mutations — empty array confirms the
      // architectural limitation surfaced in the spec header.
      mutations: [],
    });
  });

  test('checkpoint:restore on a seeded empty-mutation checkpoint reports success=false', async () => {
    await win.evaluate(async () => {
      await window.api.createTab('tier0-restore-file', 'Restore');
    });
    const seed = await win.evaluate(() =>
      window.api.__testSeedRewindCheckpoint({ fileKey: 'tier0-restore-file' }),
    );

    const result = await win.evaluate(
      async ([fileKey, id]) =>
        window.api.checkpoint.restore(fileKey, id, 'to-checkpoint'),
      ['tier0-restore-file', seed.id],
    );

    // Real manager runs; zero restorable mutations → success=false, no token.
    expect(result.success).toBe(false);
    expect(result.restoredMutations).toBe(0);
    expect(result.undoToken ?? null).toBeNull();

    // Verify the RewindManager is wired to the MetricsRegistry in test mode
    // (previously broken: `new RewindManager({ wsServer })` passed no `metrics`,
    // so all rewind counters stayed at 0 even for real activity).
    const metrics = await win.evaluate(() => window.api.__testGetMetrics());
    expect(metrics.rewind.restoreStarted).toBeGreaterThanOrEqual(1);
    // applyCheckpoint with 0 mutations returns success=false without an error
    // field, so manager falls through to recordRewindRestoreCompleted(0, 0).
    // The completed counter increments regardless of success — it tracks
    // "restore attempt finished without throwing", not "restore succeeded".
    expect(metrics.rewind.restoreCompleted).toBeGreaterThanOrEqual(1);
  });

  test('checkpoint:clear removes all checkpoints for a fileKey', async () => {
    await win.evaluate(async () => {
      await window.api.createTab('tier0-clear-file', 'Clear');
      await window.api.__testSeedRewindCheckpoint({ fileKey: 'tier0-clear-file', prompt: 'a' });
      await window.api.__testSeedRewindCheckpoint({ fileKey: 'tier0-clear-file', prompt: 'b' });
    });

    const before = await win.evaluate(() =>
      window.api.checkpoint.list('tier0-clear-file'),
    );
    expect(before).toHaveLength(2);

    await win.evaluate(() => window.api.checkpoint.clear('tier0-clear-file'));

    const after = await win.evaluate(() =>
      window.api.checkpoint.list('tier0-clear-file'),
    );
    expect(after).toHaveLength(0);
  });

  test('IPC validation rejects malformed fileKey and returns a structured error', async () => {
    // `validateFileKey` throws; the handler catches and returns a failure envelope.
    const restoreBad = await win.evaluate(() =>
      window.api.checkpoint.restore('../escape', '11111111-2222-3333-4444-555555555555', 'to-checkpoint'),
    );
    expect(restoreBad).toMatchObject({
      success: false,
      error: expect.stringMatching(/invalid fileKey/i),
      restoredMutations: 0,
    });

    const undoBad = await win.evaluate(() =>
      window.api.checkpoint.undoRestore('tier0-probe-file', 'not-a-uuid'),
    );
    expect(undoBad).toMatchObject({
      success: false,
      error: expect.stringMatching(/invalid undoToken/i),
    });
  });

  test('multi-tab isolation: checkpoint:list is scoped per fileKey', async () => {
    await win.evaluate(async () => {
      await window.api.createTab('tier0-iso-a', 'A');
      await window.api.createTab('tier0-iso-b', 'B');
      await window.api.__testSeedRewindCheckpoint({ fileKey: 'tier0-iso-a', prompt: 'on A' });
    });

    const onA = await win.evaluate(() => window.api.checkpoint.list('tier0-iso-a'));
    const onB = await win.evaluate(() => window.api.checkpoint.list('tier0-iso-b'));
    expect(onA).toHaveLength(1);
    expect(onA[0].prompt).toBe('on A');
    expect(onB).toHaveLength(0);
  });
});
