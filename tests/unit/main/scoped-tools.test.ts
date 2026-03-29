import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/mock'), getAppPath: vi.fn().mockReturnValue('/mock') },
  ipcMain: { handle: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() }),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { createScopedTools } from '../../../src/main/agent.js';
import { DesignSystemCache } from '../../../src/main/compression/design-system-cache.js';
import { OperationQueueManager } from '../../../src/main/operation-queue-manager.js';
import { ScopedConnector } from '../../../src/main/scoped-connector.js';
import { createFigmaTools } from '../../../src/main/tools/index.js';
import { createMockConfigManager, createMockFigmaAPI, createMockWsServer } from '../../helpers/mock-connector.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function createMockInfra() {
  const wsServer = createMockWsServer();
  const figmaAPI = createMockFigmaAPI();
  const queueManager = new OperationQueueManager();
  const designSystemCache = new DesignSystemCache(() => 60000);
  const configManager = createMockConfigManager();

  return {
    wsServer,
    figmaAPI,
    queueManager,
    getImageGenerator: undefined,
    designSystemCache,
    configManager,
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createScopedTools', () => {
  let infra: ReturnType<typeof createMockInfra>;

  beforeEach(() => {
    infra = createMockInfra();
  });

  it('returns a tools array with length > 0', () => {
    const { tools } = createScopedTools(infra, 'file-abc');
    expect(tools.length).toBeGreaterThan(0);
  });

  it('returns a ScopedConnector instance with the given fileKey', () => {
    const { connector } = createScopedTools(infra, 'file-abc');
    expect(connector).toBeInstanceOf(ScopedConnector);
    expect(connector.fileKey).toBe('file-abc');
  });

  it('different fileKeys produce connectors with different fileKeys', () => {
    const { connector: c1 } = createScopedTools(infra, 'file-aaa');
    const { connector: c2 } = createScopedTools(infra, 'file-bbb');
    expect(c1.fileKey).toBe('file-aaa');
    expect(c2.fileKey).toBe('file-bbb');
    expect(c1).not.toBe(c2);
  });

  it('returns the same number of tools as createFigmaTools with the same deps', () => {
    const { tools } = createScopedTools(infra, 'file-abc');
    // createFigmaTools without getImageGenerator — same config
    const reference = createFigmaTools({
      connector: new ScopedConnector(infra.wsServer, 'file-abc'),
      figmaAPI: infra.figmaAPI,
      operationQueue: infra.queueManager.getQueue('ref-file'),
      wsServer: infra.wsServer,
      getImageGenerator: undefined,
      designSystemCache: infra.designSystemCache,
      configManager: infra.configManager,
    });
    expect(tools.length).toBe(reference.length);
  });

  it('tools include expected tool names (figma_execute, figma_screenshot, figma_status)', () => {
    const { tools } = createScopedTools(infra, 'file-abc');
    const names = tools.map((t: any) => t.name);
    expect(names).toContain('figma_execute');
    expect(names).toContain('figma_screenshot');
    expect(names).toContain('figma_status');
  });

  it('the queueManager creates a queue for the given fileKey', () => {
    expect(infra.queueManager.has('file-xyz')).toBe(false);
    createScopedTools(infra, 'file-xyz');
    expect(infra.queueManager.has('file-xyz')).toBe(true);
  });

  it('multiple calls with the same fileKey reuse the same OperationQueue instance', () => {
    createScopedTools(infra, 'file-shared');
    const q1 = infra.queueManager.getQueue('file-shared');
    createScopedTools(infra, 'file-shared');
    const q2 = infra.queueManager.getQueue('file-shared');
    expect(q1).toBe(q2);
  });

  it('every returned tool has an execute method (abort-check wrapper applied)', () => {
    const { tools } = createScopedTools(infra, 'file-abc');
    for (const tool of tools) {
      expect(typeof (tool as any).execute).toBe('function');
    }
  });

  it('aborts execution when signal is already aborted', async () => {
    const { tools } = createScopedTools(infra, 'file-abc');
    const tool = tools.find((t: any) => t.name === 'figma_execute') as any;

    const abortController = new AbortController();
    abortController.abort();

    await expect(
      tool.execute('call-abort', { code: 'test()' }, abortController.signal, undefined, undefined),
    ).rejects.toThrow('Aborted');
  });
});
