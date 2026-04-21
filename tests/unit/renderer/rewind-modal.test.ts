// @vitest-environment happy-dom

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);

let RewindModal: typeof import('../../../src/renderer/rewind-modal.js') = {} as never;

function mountDom() {
  document.body.innerHTML = `
    <button id="rewind-chip" class="rewind-chip hidden" title="Checkpoints" aria-label="Open checkpoints">
      <span class="rewind-icon" aria-hidden="true">◆</span>
      <span id="rewind-count">0</span>
    </button>
    <div id="rewind-overlay" class="rewind-overlay hidden" role="dialog" aria-labelledby="rewind-title" aria-hidden="true">
      <div class="rewind-panel">
        <header class="rewind-header">
          <h2 id="rewind-title">Checkpoints</h2>
          <button class="rewind-close" aria-label="Close">×</button>
        </header>
        <div class="rewind-banner hidden" id="rewind-banner" role="status"></div>
        <ul id="rewind-list" class="rewind-list"></ul>
        <footer class="rewind-footer">
          <button id="rewind-undo-btn" class="rewind-undo hidden">↩ Undo last rewind</button>
        </footer>
      </div>
    </div>
  `;
}

function makeApi() {
  return {
    checkpoint: {
      list: vi.fn(),
      restore: vi.fn(),
      undoRestore: vi.fn(),
    },
  };
}

beforeEach(() => {
  mountDom();
  // Generation-guard must be loaded first: rewind-modal reads
  // window.createGenerationGuard at IIFE evaluation time.
  delete require.cache[require.resolve('../../../src/renderer/generation-guard.js')];
  require('../../../src/renderer/generation-guard.js');
  delete require.cache[require.resolve('../../../src/renderer/rewind-modal.js')];
  RewindModal = require('../../../src/renderer/rewind-modal.js');
});

describe('rewind-modal', () => {
  it('hides the chip for files with zero checkpoints, shows it on checkpoint-added, and hides it again on a new empty file', async () => {
    const api = makeApi();
    let fileACount = 0;
    api.checkpoint.list.mockImplementation(async (fileKey: string) => {
      if (fileKey === 'file-a') {
        return fileACount === 0
          ? []
          : [
              {
                id: 'cp-1',
                fileKey,
                slotId: 'slot-1',
                turnIndex: 1,
                prompt: 'paint frame',
                timestamp: Date.now(),
                restorableCount: 1,
                nonRestorableCount: 0,
                executeTouched: false,
              },
            ];
      }
      if (fileKey === 'file-b') return [];
      return [
        {
          id: 'cp-1',
          fileKey,
          slotId: 'slot-1',
          turnIndex: 1,
          prompt: 'paint frame',
          timestamp: Date.now(),
          restorableCount: 1,
          nonRestorableCount: 0,
          executeTouched: false,
        },
      ];
    });

    const controller = RewindModal.initRewindController(api, document);
    const chip = document.getElementById('rewind-chip');
    const badge = document.getElementById('rewind-count');

    await controller.bindActiveFileKey('file-a');
    expect(chip?.classList.contains('hidden')).toBe(true);

    fileACount = 1;
    controller.handleCheckpointAdded('file-a', { id: 'cp-1', total: 1 });
    await Promise.resolve();
    await Promise.resolve();
    expect(chip?.classList.contains('hidden')).toBe(false);
    expect(badge?.textContent).toBe('1');

    await controller.bindActiveFileKey('file-b');
    expect(chip?.classList.contains('hidden')).toBe(true);
  });

  it('shows the chip with the current checkpoint count after binding an active file', async () => {
    const api = makeApi();
    api.checkpoint.list.mockResolvedValue([
      {
        id: 'cp-1',
        fileKey: 'file-1',
        slotId: 'slot-1',
        turnIndex: 1,
        prompt: 'paint frame',
        timestamp: Date.now(),
        restorableCount: 2,
        nonRestorableCount: 0,
        executeTouched: false,
      },
    ]);

    const controller = RewindModal.initRewindController(api, document);
    await controller.bindActiveFileKey('file-1');

    expect(document.getElementById('rewind-chip')?.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('rewind-count')?.textContent).toBe('1');
  });

  it('renders executeTouched checkpoints as non-restorable with a disabled restore button', async () => {
    const api = makeApi();
    api.checkpoint.list.mockResolvedValue([
      {
        id: 'cp-1',
        fileKey: 'file-1',
        slotId: 'slot-1',
        turnIndex: 1,
        prompt: 'ran figma_execute',
        timestamp: Date.now(),
        restorableCount: 0,
        nonRestorableCount: 1,
        executeTouched: true,
      },
    ]);

    const controller = RewindModal.initRewindController(api, document);
    await controller.bindActiveFileKey('file-1');
    await controller.open('file-1');

    const item = document.querySelector('.rewind-item');
    const restoreBtn = document.querySelector<HTMLButtonElement>('.rewind-restore');
    expect(item?.classList.contains('non-restorable')).toBe(true);
    expect(document.querySelector('.badge-non-restorable')?.textContent).toContain('Non-restorable');
    expect(restoreBtn?.disabled).toBe(true);
  });

  it('shows a toast when clicking a non-restorable rewind item', async () => {
    const api = makeApi();
    api.checkpoint.list.mockResolvedValue([
      {
        id: 'cp-1',
        fileKey: 'file-1',
        slotId: 'slot-1',
        turnIndex: 1,
        prompt: 'ran figma_execute',
        timestamp: Date.now(),
        restorableCount: 0,
        nonRestorableCount: 1,
        executeTouched: true,
      },
    ]);

    const controller = RewindModal.initRewindController(api, document);
    await controller.bindActiveFileKey('file-1');
    await controller.open('file-1');

    const item = document.querySelector<HTMLElement>('.rewind-item');
    item?.click();

    const toast = document.querySelector('.rewind-toast');
    expect(toast?.classList.contains('hidden')).toBe(false);
    expect(toast?.textContent).toMatch(/figma_execute.*non.*ripristinato/i);
  });

  it('shows a success toast and enables undo after a restore event', async () => {
    const api = makeApi();
    api.checkpoint.list.mockResolvedValue([
      {
        id: 'cp-1',
        fileKey: 'file-1',
        slotId: 'slot-1',
        turnIndex: 1,
        prompt: 'rename frame',
        timestamp: Date.now(),
        restorableCount: 1,
        nonRestorableCount: 0,
        executeTouched: false,
      },
    ]);

    const controller = RewindModal.initRewindController(api, document);
    await controller.bindActiveFileKey('file-1');
    controller.handleRestored('file-1', {
      success: true,
      restoredMutations: 1,
      skippedMutations: 0,
      undoToken: 'undo-1',
    });

    const toast = document.querySelector('.rewind-toast');
    const undoBtn = document.getElementById('rewind-undo-btn');
    expect(toast?.classList.contains('hidden')).toBe(false);
    expect(toast?.textContent).toContain('Restored 1 mutation');
    expect(undoBtn?.classList.contains('hidden')).toBe(false);
    expect(undoBtn?.textContent).toContain('Undo last rewind');
  });

  it('disables the chip and shows the plugin outdated tooltip for the active file', async () => {
    const api = makeApi();
    api.checkpoint.list.mockResolvedValue([]);

    const controller = RewindModal.initRewindController(api, document);
    await controller.bindActiveFileKey('file-1');
    controller.handlePluginOutdated('file-1');

    const chip = document.getElementById('rewind-chip') as HTMLButtonElement;
    expect(chip.classList.contains('disabled')).toBe(true);
    expect(chip.disabled).toBe(true);
    expect(chip.title).toContain('update the Figma plugin');
  });

  it('partial-restore response arms undo and surfaces the aborted mutation count', async () => {
    const api = makeApi();
    api.checkpoint.list.mockResolvedValue([
      {
        id: 'cp-1',
        fileKey: 'file-1',
        slotId: 'slot-1',
        turnIndex: 1,
        prompt: 'paint',
        timestamp: Date.now(),
        restorableCount: 1,
        nonRestorableCount: 0,
        executeTouched: false,
      },
    ]);
    // Simulate main returning partial failure: some inverses ran before an
    // executeTouched checkpoint aborted the scope.
    api.checkpoint.restore.mockResolvedValue({
      success: false,
      restoredMutations: 2,
      skippedMutations: 0,
      error: 'Checkpoint contains arbitrary code execution and cannot be restored.',
      undoToken: 'partial-token-abc',
    });

    const controller = RewindModal.initRewindController(api, document);
    await controller.bindActiveFileKey('file-1');
    await controller.open('file-1');
    const restoreBtn = document.querySelector<HTMLButtonElement>('.rewind-restore');
    expect(restoreBtn).not.toBeNull();
    restoreBtn!.click();
    // Click dispatches a microtask chain — yield until the async restore flow settles.
    for (let i = 0; i < 5; i++) await Promise.resolve();

    const undoBtn = document.getElementById('rewind-undo-btn');
    const toast = document.querySelector('.rewind-toast');
    expect(undoBtn?.classList.contains('hidden')).toBe(false);
    expect(undoBtn?.textContent).toContain('Undo last rewind');
    expect(toast?.classList.contains('error')).toBe(true);
    expect(toast?.textContent).toContain('Restored 2 mutations');
    expect(toast?.textContent).toMatch(/use Undo/i);
  });

  it('undo button is hidden while on a foreign tab and reappears when returning to the token file', async () => {
    const api = makeApi();
    api.checkpoint.list.mockResolvedValue([]);

    const controller = RewindModal.initRewindController(api, document);
    // Restore token was for file-a; user is currently on file-a.
    await controller!.bindActiveFileKey('file-a');
    controller!.handleRestored('file-a', {
      success: true,
      restoredMutations: 1,
      skippedMutations: 0,
      undoToken: 'tok-a',
    });
    const undoBtn = document.getElementById('rewind-undo-btn');
    expect(undoBtn?.classList.contains('hidden')).toBe(false);

    // Switch to file-b — button must hide, token stays alive in state.
    await controller!.bindActiveFileKey('file-b');
    expect(undoBtn?.classList.contains('hidden')).toBe(true);
    expect(controller!.__getState().undoToken).toBe('tok-a');

    // Switch back — button reappears without requiring a fresh restore.
    await controller!.bindActiveFileKey('file-a');
    expect(undoBtn?.classList.contains('hidden')).toBe(false);
  });

  it('undoLastRestore refuses to run when active file does not match the token', async () => {
    const api = makeApi();
    api.checkpoint.list.mockResolvedValue([]);
    api.checkpoint.undoRestore = vi.fn();

    const controller = RewindModal.initRewindController(api, document);
    await controller!.bindActiveFileKey('file-a');
    controller!.handleRestored('file-a', {
      success: true,
      restoredMutations: 1,
      skippedMutations: 0,
      undoToken: 'tok-a',
    });
    await controller!.bindActiveFileKey('file-b');

    // Simulate the keyboard shortcut or residual click on a re-exposed element.
    document.getElementById('rewind-undo-btn')?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(api.checkpoint.undoRestore).not.toHaveBeenCalled();
  });

  it('pruning notification is queued for inactive files and surfaced on next bind', async () => {
    const api = makeApi();
    api.checkpoint.list.mockResolvedValue([]);

    const controller = RewindModal.initRewindController(api, document);
    await controller!.bindActiveFileKey('file-a');

    // Pruning event arrives for file-b while user is on file-a → queued, no toast now.
    controller!.handleCheckpointPruned('file-b', { prunedCount: 2 });
    const toastInitial = document.querySelector('.rewind-toast');
    expect(toastInitial?.classList.contains('hidden')).toBe(true);

    // User switches to file-b → deferred notice fires with info tone.
    await controller!.bindActiveFileKey('file-b');
    const toast = document.querySelector('.rewind-toast');
    expect(toast?.classList.contains('hidden')).toBe(false);
    expect(toast?.classList.contains('info')).toBe(true);
    expect(toast?.textContent).toContain('2 checkpoints dropped');
  });

  it('pruning notification shows immediately when the active file matches', async () => {
    const api = makeApi();
    api.checkpoint.list.mockResolvedValue([]);

    const controller = RewindModal.initRewindController(api, document);
    await controller!.bindActiveFileKey('file-a');
    controller!.handleCheckpointPruned('file-a', { prunedCount: 1 });

    const toast = document.querySelector('.rewind-toast');
    expect(toast?.classList.contains('hidden')).toBe(false);
    expect(toast?.classList.contains('info')).toBe(true);
    expect(toast?.textContent).toContain('1 checkpoint dropped');
  });

  it('restore success surfaces skipReasons in the toast suffix', async () => {
    const api = makeApi();
    api.checkpoint.list.mockResolvedValue([]);

    const controller = RewindModal.initRewindController(api, document);
    await controller!.bindActiveFileKey('file-1');
    controller!.handleRestored('file-1', {
      success: true,
      restoredMutations: 2,
      skippedMutations: 3,
      undoToken: 'tok-1',
      skipReasons: { 'inverse-unavailable': 2, 'ws-timeout': 1 },
    });

    const toast = document.querySelector('.rewind-toast');
    expect(toast?.textContent).toContain('Restored 2 mutations');
    expect(toast?.textContent).toContain('Skipped 3 mutations');
    expect(toast?.textContent).toMatch(/auto-layout parent/);
    expect(toast?.textContent).toMatch(/probe timeout/);
  });

  it('bindActiveFileKey race: older in-flight loadSummaries does not overwrite newer list', async () => {
    const api = makeApi();
    const deferFileA = {
      resolve: (value: unknown) => {
        /* filled below */
      },
    };
    const deferFileB = {
      resolve: (value: unknown) => {
        /* filled below */
      },
    };
    api.checkpoint.list.mockImplementation((fileKey: string) => {
      if (fileKey === 'file-a') {
        return new Promise((res) => {
          deferFileA.resolve = res;
        });
      }
      return new Promise((res) => {
        deferFileB.resolve = res;
      });
    });

    const controller = RewindModal.initRewindController(api, document);
    const bindA = controller.bindActiveFileKey('file-a');
    const bindB = controller.bindActiveFileKey('file-b');

    // Resolve file-a (older) AFTER file-b (newer). Without the generation guard,
    // file-a's stale summaries would overwrite file-b's state.
    deferFileB.resolve([
      {
        id: 'cp-b',
        fileKey: 'file-b',
        slotId: 'slot-b',
        turnIndex: 1,
        prompt: 'B only',
        timestamp: Date.now(),
        restorableCount: 1,
        nonRestorableCount: 0,
        executeTouched: false,
      },
    ]);
    await bindB;

    deferFileA.resolve([
      {
        id: 'cp-a1',
        fileKey: 'file-a',
        slotId: 'slot-a',
        turnIndex: 1,
        prompt: 'A one',
        timestamp: Date.now(),
        restorableCount: 1,
        nonRestorableCount: 0,
        executeTouched: false,
      },
      {
        id: 'cp-a2',
        fileKey: 'file-a',
        slotId: 'slot-a',
        turnIndex: 2,
        prompt: 'A two',
        timestamp: Date.now(),
        restorableCount: 1,
        nonRestorableCount: 0,
        executeTouched: false,
      },
    ]);
    await bindA;

    const state = controller.__getState();
    expect(state.activeFileKey).toBe('file-b');
    expect(state.summaryCount).toBe(1);
    expect(document.getElementById('rewind-count')?.textContent).toBe('1');
  });

  it('three rapid tab switches: only the last bind wins, intermediate binds are discarded', async () => {
    const api = makeApi();
    const deferrals = new Map<string, (v: unknown) => void>();
    api.checkpoint.list.mockImplementation((fileKey: string) => {
      return new Promise((res) => {
        deferrals.set(fileKey, res);
      });
    });

    const controller = RewindModal.initRewindController(api, document);
    const bindA = controller!.bindActiveFileKey('file-a');
    const bindB = controller!.bindActiveFileKey('file-b');
    const bindC = controller!.bindActiveFileKey('file-c');

    // Resolve out of order: B first, A second, C last. Only C should stick.
    const makeSummary = (fileKey: string, prompt: string) => [
      {
        id: `cp-${fileKey}`,
        fileKey,
        slotId: `slot-${fileKey}`,
        turnIndex: 1,
        prompt,
        timestamp: Date.now(),
        restorableCount: 1,
        nonRestorableCount: 0,
        executeTouched: false,
      },
    ];

    deferrals.get('file-b')!(makeSummary('file-b', 'B'));
    await bindB;
    deferrals.get('file-a')!(makeSummary('file-a', 'A'));
    await bindA;
    deferrals.get('file-c')!([
      ...makeSummary('file-c', 'C1'),
      { ...makeSummary('file-c', 'C2')[0], id: 'cp-file-c-2', turnIndex: 2 },
    ]);
    await bindC;

    const state = controller!.__getState();
    expect(state.activeFileKey).toBe('file-c');
    expect(state.summaryCount).toBe(2);
  });
});
