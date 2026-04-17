/**
 * Extension-factory integration. Bypasses Pi SDK by invoking the registered
 * handlers directly — we only care that the factory wires the right flow
 * between rule evaluation, confirm-bus, and metrics.
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

type Handler = (event: any) => Promise<any> | any;

function fakePi() {
  const handlers = new Map<string, Handler>();
  return {
    on: (evt: string, h: Handler) => handlers.set(evt, h),
    fire: (evt: string, payload: any) => {
      const h = handlers.get(evt);
      return h ? h(payload) : undefined;
    },
    handlers,
  };
}

function makeMetrics() {
  return {
    recordGuardrailsEvaluated: vi.fn(),
    recordGuardrailsBlocked: vi.fn(),
    recordGuardrailsAllowed: vi.fn(),
  };
}

function makeDeps(overrides: Partial<Parameters<typeof createGuardrailsExtensionFactory>[0]> = {}) {
  const metrics = makeMetrics();
  const deps = {
    isEnabled: () => true,
    getWebContents: () => ({ isDestroyed: () => false }) as any,
    getConnector: () => null,
    getFileKey: () => 'f1',
    getSlotId: () => 'slot-1',
    metrics,
    ...overrides,
  };
  return { deps, metrics };
}

beforeEach(() => {
  requestConfirmMock.mockReset();
  __clearNodeInfoCacheForTests();
});

describe('createGuardrailsExtensionFactory', () => {
  it('no-op when disabled', async () => {
    const { deps, metrics } = makeDeps({ isEnabled: () => false });
    const pi = fakePi();
    createGuardrailsExtensionFactory(deps)(pi);
    const result = await pi.fire('tool_call', {
      toolName: 'figma_delete',
      input: { nodeIds: Array.from({ length: 10 }, (_, i) => String(i)) },
    });
    expect(result).toBeUndefined();
    expect(metrics.recordGuardrailsEvaluated).not.toHaveBeenCalled();
    expect(requestConfirmMock).not.toHaveBeenCalled();
  });

  it('ignores non-mutation tools', async () => {
    const { deps, metrics } = makeDeps();
    const pi = fakePi();
    createGuardrailsExtensionFactory(deps)(pi);
    await pi.fire('tool_call', { toolName: 'figma_screenshot', input: { nodeId: '1:2' } });
    expect(metrics.recordGuardrailsEvaluated).not.toHaveBeenCalled();
  });

  it('records "none" when no rule matches', async () => {
    const { deps, metrics } = makeDeps();
    const pi = fakePi();
    createGuardrailsExtensionFactory(deps)(pi);
    const result = await pi.fire('tool_call', {
      toolName: 'figma_set_fills',
      input: { nodeId: '1:2' },
    });
    expect(result).toBeUndefined();
    expect(metrics.recordGuardrailsEvaluated).toHaveBeenCalledWith('none');
    expect(requestConfirmMock).not.toHaveBeenCalled();
  });

  it('blocks when rule matches and user denies', async () => {
    const { deps, metrics } = makeDeps();
    requestConfirmMock.mockResolvedValueOnce('block');
    const pi = fakePi();
    createGuardrailsExtensionFactory(deps)(pi);
    const result = await pi.fire('tool_call', {
      toolName: 'figma_delete',
      input: { nodeIds: Array.from({ length: 10 }, (_, i) => String(i)) },
    });
    expect(result).toEqual({
      block: true,
      reason: expect.stringContaining('bulk-delete'),
    });
    expect(metrics.recordGuardrailsEvaluated).toHaveBeenCalledWith('bulk-delete');
    expect(metrics.recordGuardrailsBlocked).toHaveBeenCalledWith('bulk-delete');
  });

  it('allows when user accepts and records metric', async () => {
    const { deps, metrics } = makeDeps();
    requestConfirmMock.mockResolvedValueOnce('allow-once');
    const pi = fakePi();
    createGuardrailsExtensionFactory(deps)(pi);
    const result = await pi.fire('tool_call', {
      toolName: 'figma_delete',
      input: { nodeIds: Array.from({ length: 10 }, (_, i) => String(i)) },
    });
    expect(result).toBeUndefined();
    expect(metrics.recordGuardrailsAllowed).toHaveBeenCalledWith('bulk-delete');
  });

  it('dedupes same rule within one turn', async () => {
    const { deps, metrics } = makeDeps();
    requestConfirmMock.mockResolvedValueOnce('allow-once');
    const pi = fakePi();
    createGuardrailsExtensionFactory(deps)(pi);
    await pi.fire('agent_start', {});

    // First call triggers confirm
    await pi.fire('tool_call', {
      toolName: 'figma_delete',
      input: { nodeIds: Array.from({ length: 10 }, (_, i) => String(i)) },
    });
    expect(requestConfirmMock).toHaveBeenCalledTimes(1);
    expect(metrics.recordGuardrailsAllowed).toHaveBeenCalledTimes(1);

    // Second call same agent cycle, same rule → auto-allowed, no new confirm
    await pi.fire('tool_call', {
      toolName: 'figma_delete',
      input: { nodeIds: Array.from({ length: 8 }, (_, i) => `x${i}`) },
    });
    expect(requestConfirmMock).toHaveBeenCalledTimes(1);
    expect(metrics.recordGuardrailsAllowed).toHaveBeenCalledTimes(2);
  });

  it('clears dedup state on agent_start (next user request)', async () => {
    const { deps } = makeDeps();
    requestConfirmMock.mockResolvedValueOnce('allow-once').mockResolvedValueOnce('allow-once');
    const pi = fakePi();
    createGuardrailsExtensionFactory(deps)(pi);
    await pi.fire('agent_start', {});
    await pi.fire('tool_call', {
      toolName: 'figma_delete',
      input: { nodeIds: Array.from({ length: 10 }, (_, i) => String(i)) },
    });
    await pi.fire('agent_start', {});
    await pi.fire('tool_call', {
      toolName: 'figma_delete',
      input: { nodeIds: Array.from({ length: 10 }, (_, i) => String(i)) },
    });
    expect(requestConfirmMock).toHaveBeenCalledTimes(2);
  });

  it('turn_start does NOT reset dedup (regression guard)', async () => {
    // Confirms dedup scope is per agent_start, not per turn_start — an LLM
    // emitting multiple assistant messages during one user request must not
    // re-prompt the user.
    const { deps } = makeDeps();
    requestConfirmMock.mockResolvedValueOnce('allow-once');
    const pi = fakePi();
    createGuardrailsExtensionFactory(deps)(pi);
    await pi.fire('agent_start', {});
    await pi.fire('tool_call', {
      toolName: 'figma_execute',
      input: { code: 'a.remove(); b.remove();' },
    });
    // Simulate a new Pi SDK turn (next assistant response in same request)
    await pi.fire('turn_start', { turnIndex: 1 });
    await pi.fire('tool_call', {
      toolName: 'figma_execute',
      input: { code: 'c.remove(); d.remove();' },
    });
    // Still ONE confirm — turn_start did not touch dedup
    expect(requestConfirmMock).toHaveBeenCalledTimes(1);
  });

  it('fail-closed: exception in handler blocks tool (does NOT silently pass through)', async () => {
    const { deps } = makeDeps({
      // Force an exception at metrics.recordGuardrailsEvaluated
      metrics: {
        recordGuardrailsEvaluated: () => {
          throw new Error('boom');
        },
        recordGuardrailsAllowed: vi.fn(),
        recordGuardrailsBlocked: vi.fn(),
      },
    });
    const pi = fakePi();
    createGuardrailsExtensionFactory(deps)(pi);
    const result = await pi.fire('tool_call', {
      toolName: 'figma_delete',
      input: { nodeIds: Array.from({ length: 10 }, (_, i) => String(i)) },
    });
    expect(result).toMatchObject({
      block: true,
      reason: expect.stringContaining('errore interno'),
    });
  });
});
