/**
 * Playbook integration for guardrails. Wires a REAL Pi SDK AgentSession
 * (via bottega-test-session harness) with the REAL guardrails extension
 * factory + REAL rules. The confirm-bus is mocked to return scripted
 * decisions, and figma_delete is mocked to simulate tool execution.
 *
 * These tests verify the end-to-end flow through the agent runtime:
 * tool_call → rules → confirm → block/allow → tool_result.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGuardrailsExtensionFactory } from '../../../src/main/guardrails/extension-factory.js';
import { __clearNodeInfoCacheForTests } from '../../../src/main/guardrails/rules.js';
import { MetricsRegistry } from '../../../src/main/metrics-registry.js';
import { type BottegaTestSession, createBottegaTestSession } from '../../helpers/bottega-test-session.js';
import { calls, says, when } from '../../helpers/playbook.js';

// Mock the confirm-bus module at the import level — the extension factory
// imports requestConfirm from here and we want it to return scripted values
// without spinning up Electron ipcMain.
const requestConfirmMock = vi.fn();
vi.mock('../../../src/main/guardrails/confirm-bus.js', () => ({
  requestConfirm: (...args: any[]) => requestConfirmMock(...args),
  registerGuardrailsIpc: vi.fn(),
}));

let t: BottegaTestSession | null = null;
let registry: MetricsRegistry;

function buildGuardrailsFactory() {
  return createGuardrailsExtensionFactory({
    isEnabled: () => true,
    getWebContents: () => ({ isDestroyed: () => false }) as any,
    getConnector: () => null,
    getFileKey: () => 'test-file-key',
    getSlotId: () => 'test-slot',
    metrics: {
      recordGuardrailsEvaluated: (r) => registry.recordGuardrailsEvaluated(r),
      recordGuardrailsBlocked: (r) => registry.recordGuardrailsBlocked(r),
      recordGuardrailsAllowed: (r) => registry.recordGuardrailsAllowed(r),
    },
  });
}

beforeEach(() => {
  registry = new MetricsRegistry();
  requestConfirmMock.mockReset();
  __clearNodeInfoCacheForTests();
});

afterEach(() => {
  t?.dispose();
  t = null;
});

describe('Playbook — guardrails end-to-end', () => {
  // Rule A in production matches figma_execute with multiple .remove() calls
  // (bulk node removal via plugin-API code). The scenarios below drive that path
  // because figma_delete itself operates on a single nodeId.
  const BULK_CODE = `
    const ids = ["1:1","1:2","1:3"];
    for (const id of ids) {
      const n = await figma.getNodeByIdAsync(id);
      if (n) n.remove();
    }
    // second .remove() call triggers the bulk pattern
    const x = await figma.getNodeByIdAsync("1:4");
    if (x) x.remove();
  `;

  it('Scenario 1: BLOCK on bulk-delete stops figma_execute', async () => {
    requestConfirmMock.mockResolvedValueOnce('block');
    const execMock = vi.fn(() => JSON.stringify({ success: true }));
    t = await createBottegaTestSession({
      mockTools: { figma_execute: execMock as any },
      extraExtensionFactories: [buildGuardrailsFactory()],
    });

    await t.run(when('wipe some nodes', [calls('figma_execute', { code: BULK_CODE }), says('Done')]));

    const toolResults = t.events.toolResultsFor('figma_execute');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].isError).toBe(true);
    expect(toolResults[0].text).toContain('bulk-delete');
    expect(execMock).not.toHaveBeenCalled();

    const snap = registry.snapshot({
      slotManager: { listSlots: () => [], getSlot: () => undefined },
      wsServer: { getConnectedFiles: () => [], getActiveFileKey: () => null },
      getJudgeInProgress: () => new Set(),
    } as any);
    expect(snap.guardrails.byRule['bulk-delete']).toEqual({ evaluated: 1, blocked: 1, allowed: 0 });
  });

  it('Scenario 2: ALLOW passes the execute call through to the mocked handler', async () => {
    requestConfirmMock.mockResolvedValueOnce('allow-once');
    const execMock = vi.fn(() => JSON.stringify({ success: true, removed: 4 }));
    t = await createBottegaTestSession({
      mockTools: { figma_execute: execMock as any },
      extraExtensionFactories: [buildGuardrailsFactory()],
    });

    await t.run(when('wipe some nodes', [calls('figma_execute', { code: BULK_CODE }), says('Done')]));

    const toolResults = t.events.toolResultsFor('figma_execute');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0].isError).toBe(false);
    expect(execMock).toHaveBeenCalledTimes(1);

    const snap = registry.snapshot({
      slotManager: { listSlots: () => [], getSlot: () => undefined },
      wsServer: { getConnectedFiles: () => [], getActiveFileKey: () => null },
      getJudgeInProgress: () => new Set(),
    } as any);
    expect(snap.guardrails.byRule['bulk-delete']).toEqual({ evaluated: 1, blocked: 0, allowed: 1 });
  });

  it('Scenario 3: dedup within same turn — confirm fires once, auto-allow on retry', async () => {
    requestConfirmMock.mockResolvedValueOnce('allow-once');
    const execMock = vi.fn(() => JSON.stringify({ success: true }));
    t = await createBottegaTestSession({
      mockTools: { figma_execute: execMock as any },
      extraExtensionFactories: [buildGuardrailsFactory()],
    });

    await t.run(
      when('wipe some nodes', [
        calls('figma_execute', { code: BULK_CODE }),
        calls('figma_execute', { code: BULK_CODE.replace(/1:/g, '2:') }),
        says('Done.'),
      ]),
    );

    expect(requestConfirmMock).toHaveBeenCalledTimes(1);
    expect(t.events.toolResultsFor('figma_execute')).toHaveLength(2);
    expect(execMock).toHaveBeenCalledTimes(2);

    const snap = registry.snapshot({
      slotManager: { listSlots: () => [], getSlot: () => undefined },
      wsServer: { getConnectedFiles: () => [], getActiveFileKey: () => null },
      getJudgeInProgress: () => new Set(),
    } as any);
    expect(snap.guardrails.byRule['bulk-delete']).toEqual({ evaluated: 2, blocked: 0, allowed: 2 });
  });

  it('Scenario 4: turn reset clears dedup — new turn prompts again', async () => {
    requestConfirmMock.mockResolvedValue('allow-once');
    const execMock = vi.fn(() => JSON.stringify({ success: true }));
    t = await createBottegaTestSession({
      mockTools: { figma_execute: execMock as any },
      extraExtensionFactories: [buildGuardrailsFactory()],
    });

    await t.run(
      when('first turn delete', [calls('figma_execute', { code: BULK_CODE }), says('Done 1')]),
      when('second turn delete', [calls('figma_execute', { code: BULK_CODE.replace(/1:/g, '3:') }), says('Done 2')]),
    );

    expect(requestConfirmMock).toHaveBeenCalledTimes(2);
  });

  it('Scenario 5: non-matching tool passes silently (noMatch metric)', async () => {
    const fillsMock = vi.fn(() => JSON.stringify({ success: true }));
    t = await createBottegaTestSession({
      mockTools: { figma_set_fills: fillsMock as any },
      extraExtensionFactories: [buildGuardrailsFactory()],
    });

    await t.run(
      when('paint node blue', [
        calls('figma_set_fills', { nodeId: '1:2', fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 1 } }] }),
        says('Painted.'),
      ]),
    );

    expect(requestConfirmMock).not.toHaveBeenCalled();
    expect(t.events.toolResultsFor('figma_set_fills')).toHaveLength(1);

    const snap = registry.snapshot({
      slotManager: { listSlots: () => [], getSlot: () => undefined },
      wsServer: { getConnectedFiles: () => [], getActiveFileKey: () => null },
      getJudgeInProgress: () => new Set(),
    } as any);
    expect(snap.guardrails.evaluated).toBe(1);
    expect(snap.guardrails.noMatch).toBe(1);
    expect(snap.guardrails.byRule).toEqual({});
  });
});
