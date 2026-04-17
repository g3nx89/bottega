/**
 * Integration test — wires the REAL rules module + REAL state machine +
 * REAL MetricsRegistry through the extension factory. Only the IPC
 * confirm-bus is mocked (we cannot spin up Electron ipcMain in vitest).
 *
 * Asserts the end-to-end metric snapshot matches what a full turn would
 * produce. Complements the unit-level extension-factory.test.ts which
 * mocks the metrics side.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

const requestConfirmMock = vi.fn();
vi.mock('../../../../src/main/guardrails/confirm-bus.js', () => ({
  requestConfirm: (...args: any[]) => requestConfirmMock(...args),
  registerGuardrailsIpc: vi.fn(),
}));

import { createGuardrailsExtensionFactory } from '../../../../src/main/guardrails/extension-factory.js';
import { __clearNodeInfoCacheForTests } from '../../../../src/main/guardrails/rules.js';
import { MetricsRegistry } from '../../../../src/main/metrics-registry.js';

type Handler = (event: any) => Promise<any> | any;

function fakePi() {
  const handlers = new Map<string, Handler>();
  return {
    on: (evt: string, h: Handler) => handlers.set(evt, h),
    fire: (evt: string, payload: any) => {
      const h = handlers.get(evt);
      return h ? h(payload) : undefined;
    },
  };
}

function makeSnapshotDeps(registry: MetricsRegistry) {
  return {
    slotManager: { listSlots: () => [], getSlot: () => undefined } as any,
    wsServer: {
      getConnectedFiles: () => [],
      getActiveFileKey: () => null,
    } as any,
    getJudgeInProgress: () => new Set<string>(),
    registry,
  };
}

beforeEach(() => {
  requestConfirmMock.mockReset();
  __clearNodeInfoCacheForTests();
});

describe('guardrails × metrics — end-to-end snapshot', () => {
  it('BLOCK scenario produces correct byRule counters', async () => {
    const registry = new MetricsRegistry();
    requestConfirmMock.mockResolvedValueOnce('block');
    const factory = createGuardrailsExtensionFactory({
      isEnabled: () => true,
      getWebContents: () => ({ isDestroyed: () => false }) as any,
      getConnector: () => null,
      getFileKey: () => 'f1',
      getSlotId: () => 's1',
      metrics: {
        recordGuardrailsEvaluated: (r) => registry.recordGuardrailsEvaluated(r),
        recordGuardrailsBlocked: (r) => registry.recordGuardrailsBlocked(r),
        recordGuardrailsAllowed: (r) => registry.recordGuardrailsAllowed(r),
      },
    });
    const pi = fakePi();
    factory(pi);

    await pi.fire('agent_start', {});
    const result = await pi.fire('tool_call', {
      toolName: 'figma_delete',
      input: { nodeIds: Array.from({ length: 12 }, (_, i) => String(i)) },
    });

    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bulk-delete'),
    });

    const snap = registry.snapshot(makeSnapshotDeps(registry) as any);
    expect(snap.guardrails.evaluated).toBe(1);
    expect(snap.guardrails.noMatch).toBe(0);
    expect(snap.guardrails.byRule['bulk-delete']).toEqual({
      evaluated: 1,
      blocked: 1,
      allowed: 0,
    });
  });

  it('ALLOW + auto-allow (dedup) records both as allowed', async () => {
    const registry = new MetricsRegistry();
    requestConfirmMock.mockResolvedValueOnce('allow-once');
    const factory = createGuardrailsExtensionFactory({
      isEnabled: () => true,
      getWebContents: () => ({ isDestroyed: () => false }) as any,
      getConnector: () => null,
      getFileKey: () => 'f1',
      getSlotId: () => 's1',
      metrics: {
        recordGuardrailsEvaluated: (r) => registry.recordGuardrailsEvaluated(r),
        recordGuardrailsBlocked: (r) => registry.recordGuardrailsBlocked(r),
        recordGuardrailsAllowed: (r) => registry.recordGuardrailsAllowed(r),
      },
    });
    const pi = fakePi();
    factory(pi);

    await pi.fire('agent_start', {});
    // First call — user accepts
    await pi.fire('tool_call', {
      toolName: 'figma_delete',
      input: { nodeIds: Array.from({ length: 10 }, (_, i) => String(i)) },
    });
    // Second call same turn — auto-allowed
    await pi.fire('tool_call', {
      toolName: 'figma_delete',
      input: { nodeIds: Array.from({ length: 20 }, (_, i) => String(i)) },
    });

    const snap = registry.snapshot(makeSnapshotDeps(registry) as any);
    // Two evaluations, one triggered confirm, both ended allowed
    expect(snap.guardrails.evaluated).toBe(2);
    expect(snap.guardrails.byRule['bulk-delete']).toEqual({
      evaluated: 2,
      blocked: 0,
      allowed: 2,
    });
    expect(requestConfirmMock).toHaveBeenCalledTimes(1);
  });

  it('probe failure in Rule B increments probeFailed metric (distinct from noMatch)', async () => {
    const registry = new MetricsRegistry();
    const throwingConnector = {
      executeCodeViaUI: vi.fn(async () => {
        throw new Error('bridge disconnected');
      }),
    } as any;
    const factory = createGuardrailsExtensionFactory({
      isEnabled: () => true,
      getWebContents: () => ({ isDestroyed: () => false }) as any,
      getConnector: () => throwingConnector,
      getFileKey: () => 'f1',
      getSlotId: () => 's1',
      metrics: {
        recordGuardrailsEvaluated: (r) => registry.recordGuardrailsEvaluated(r),
        recordGuardrailsBlocked: (r) => registry.recordGuardrailsBlocked(r),
        recordGuardrailsAllowed: (r) => registry.recordGuardrailsAllowed(r),
        recordGuardrailsProbeFailed: () => registry.recordGuardrailsProbeFailed(),
      },
    });
    const pi = fakePi();
    factory(pi);

    await pi.fire('agent_start', {});
    await pi.fire('tool_call', {
      toolName: 'figma_set_fills',
      input: { nodeId: '1:2', fills: [] },
    });

    const snap = registry.snapshot(makeSnapshotDeps(registry) as any);
    expect(snap.guardrails.probeFailed).toBeGreaterThanOrEqual(1);
    // Rule B fails open on probe error → treated as noMatch by the rule itself.
    expect(snap.guardrails.noMatch).toBe(1);
    expect(snap.guardrails.byRule).toEqual({});
  });

  it('no-match calls populate noMatch only', async () => {
    const registry = new MetricsRegistry();
    const factory = createGuardrailsExtensionFactory({
      isEnabled: () => true,
      getWebContents: () => ({ isDestroyed: () => false }) as any,
      getConnector: () => null,
      getFileKey: () => 'f1',
      getSlotId: () => 's1',
      metrics: {
        recordGuardrailsEvaluated: (r) => registry.recordGuardrailsEvaluated(r),
        recordGuardrailsBlocked: (r) => registry.recordGuardrailsBlocked(r),
        recordGuardrailsAllowed: (r) => registry.recordGuardrailsAllowed(r),
      },
    });
    const pi = fakePi();
    factory(pi);

    await pi.fire('tool_call', { toolName: 'figma_set_fills', input: { nodeId: '1:2' } });
    const snap = registry.snapshot(makeSnapshotDeps(registry) as any);
    expect(snap.guardrails.evaluated).toBe(1);
    expect(snap.guardrails.noMatch).toBe(1);
    expect(snap.guardrails.byRule).toEqual({});
    expect(requestConfirmMock).not.toHaveBeenCalled();
  });
});
