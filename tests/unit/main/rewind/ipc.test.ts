import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

describe('registerRewindIpc', () => {
  it('registers all checkpoint IPC handlers', async () => {
    const { registerRewindIpc } = await import('../../../../src/main/rewind/ipc.js');
    const handle = vi.fn();
    registerRewindIpc(
      { handle } as never,
      {
        listCheckpoints: vi.fn(),
        previewCheckpoint: vi.fn(),
        restoreCheckpoint: vi.fn(),
        undoRestore: vi.fn(),
        clearCheckpoints: vi.fn(),
      } as never,
    );

    expect(handle.mock.calls.map((call) => call[0])).toEqual([
      'checkpoint:list',
      'checkpoint:preview',
      'checkpoint:restore',
      'checkpoint:undo-restore',
      'checkpoint:clear',
    ]);
  });

  it('is idempotent when registered twice', async () => {
    const { registerRewindIpc } = await import('../../../../src/main/rewind/ipc.js');
    const handle = vi.fn();
    const manager = {
      listCheckpoints: vi.fn(),
      previewCheckpoint: vi.fn(),
      restoreCheckpoint: vi.fn(),
      undoRestore: vi.fn(),
      clearCheckpoints: vi.fn(),
    };

    registerRewindIpc({ handle } as never, manager as never);
    registerRewindIpc({ handle } as never, manager as never);

    expect(handle).toHaveBeenCalledTimes(5);
  });
});
