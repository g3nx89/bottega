/**
 * confirm-bus.ts — main ↔ renderer IPC round-trip for guardrails.
 *
 * We mock `electron` so `ipcMain.handle` is captured and we can drive
 * the handler directly, and `safe-send` so we can assert outbound
 * messages. Logger is muted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type HandlerFn = (event: any, response: any) => void;
const ipcHandlers = new Map<string, HandlerFn>();
const safeSendCalls: Array<{ channel: string; payload: any }> = [];

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: HandlerFn) => ipcHandlers.set(channel, handler),
  },
}));

vi.mock('../../../../src/main/safe-send.js', () => ({
  safeSend: (_wc: any, channel: string, payload: any) => {
    safeSendCalls.push({ channel, payload });
  },
}));

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import {
  __pendingSizeForTests,
  __resetPendingForTests,
  CONFIRM_TIMEOUT_MAX_MS,
  CONFIRM_TIMEOUT_MS,
  registerGuardrailsIpc,
  requestConfirm,
} from '../../../../src/main/guardrails/confirm-bus.js';

function fakeWc(destroyed = false): Electron.WebContents {
  return {
    isDestroyed: () => destroyed,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function baseReq() {
  return {
    slotId: 's1',
    match: {
      ruleId: 'bulk-delete' as const,
      description: 'Deleting 10 nodes',
      toolName: 'figma_delete',
      affectedLabel: '10 nodes',
      input: { nodeIds: Array.from({ length: 10 }, (_, i) => String(i)) },
      confirmTimeoutMs: undefined as number | undefined,
    },
  };
}

beforeEach(() => {
  registerGuardrailsIpc();
  safeSendCalls.length = 0;
  __resetPendingForTests();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  __resetPendingForTests();
});

describe('requestConfirm', () => {
  it('fail-closed when webContents is null', async () => {
    const res = await requestConfirm(null, baseReq());
    expect(res).toBe('block');
  });

  it('fail-closed when webContents is destroyed', async () => {
    const res = await requestConfirm(fakeWc(true), baseReq());
    expect(res).toBe('block');
  });

  it('sends confirm-request to renderer via safeSend', async () => {
    const wc = fakeWc();
    // Fire and resolve via IPC handler
    const p = requestConfirm(wc, baseReq());
    expect(safeSendCalls).toHaveLength(1);
    expect(safeSendCalls[0]?.channel).toBe('guardrails:confirm-request');
    const requestId = safeSendCalls[0]?.payload?.requestId;
    expect(typeof requestId).toBe('string');
    // Renderer responds → main resolves
    const handler = ipcHandlers.get('guardrails:confirm-response')!;
    handler({}, { requestId, decision: 'allow-once' });
    await expect(p).resolves.toBe('allow-once');
  });

  it('resolves block when renderer responds with block', async () => {
    const p = requestConfirm(fakeWc(), baseReq());
    const requestId = safeSendCalls[0]?.payload?.requestId;
    ipcHandlers.get('guardrails:confirm-response')!({}, { requestId, decision: 'block' });
    await expect(p).resolves.toBe('block');
  });

  it('silently drops unknown requestId responses', async () => {
    const p = requestConfirm(fakeWc(), baseReq());
    ipcHandlers.get('guardrails:confirm-response')!(
      {},
      {
        requestId: 'nope',
        decision: 'allow-once',
      },
    );
    // Pending entry still around, not resolved
    expect(__pendingSizeForTests()).toBe(1);
    // Timeout to clean up
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS + 1);
    await expect(p).resolves.toBe('block');
  });

  it('fail-closed on timeout', async () => {
    const p = requestConfirm(fakeWc(), baseReq());
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS + 10);
    await expect(p).resolves.toBe('block');
    expect(__pendingSizeForTests()).toBe(0);
  });

  it('fail-closed when external signal aborts', async () => {
    const ac = new AbortController();
    const p = requestConfirm(fakeWc(), baseReq(), ac.signal);
    ac.abort();
    await expect(p).resolves.toBe('block');
    expect(__pendingSizeForTests()).toBe(0);
  });

  it('fail-closed immediately when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const p = requestConfirm(fakeWc(), baseReq(), ac.signal);
    await expect(p).resolves.toBe('block');
  });

  it('cleans up pending map after resolve', async () => {
    const p = requestConfirm(fakeWc(), baseReq());
    const requestId = safeSendCalls[0]?.payload?.requestId;
    ipcHandlers.get('guardrails:confirm-response')!({}, { requestId, decision: 'allow-once' });
    await p;
    expect(__pendingSizeForTests()).toBe(0);
  });

  it('coerces unknown decision string to block', async () => {
    const p = requestConfirm(fakeWc(), baseReq());
    const requestId = safeSendCalls[0]?.payload?.requestId;
    ipcHandlers.get('guardrails:confirm-response')!({}, { requestId, decision: 'yolo' });
    await expect(p).resolves.toBe('block');
  });

  it('honors RuleMatch.confirmTimeoutMs override', async () => {
    const req = baseReq();
    req.match.confirmTimeoutMs = 25_000;
    const p = requestConfirm(fakeWc(), req);
    // Default timeout (10s) must not fire early when override is higher.
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS + 10);
    expect(__pendingSizeForTests()).toBe(1);
    // Override (25s) still active; advance past it.
    vi.advanceTimersByTime(25_000 - CONFIRM_TIMEOUT_MS + 10);
    await expect(p).resolves.toBe('block');
    expect(__pendingSizeForTests()).toBe(0);
  });

  it('clamps override above CONFIRM_TIMEOUT_MAX_MS ceiling', async () => {
    const req = baseReq();
    req.match.confirmTimeoutMs = CONFIRM_TIMEOUT_MAX_MS + 120_000;
    const p = requestConfirm(fakeWc(), req);
    // At the ceiling the timer fires, even though override asked for much longer.
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MAX_MS + 10);
    await expect(p).resolves.toBe('block');
  });

  it('ignores non-positive override (falls back to default timeout)', async () => {
    const req = baseReq();
    req.match.confirmTimeoutMs = 0;
    const p = requestConfirm(fakeWc(), req);
    vi.advanceTimersByTime(CONFIRM_TIMEOUT_MS + 10);
    await expect(p).resolves.toBe('block');
  });
});
