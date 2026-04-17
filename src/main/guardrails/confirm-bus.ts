/**
 * Guardrails IPC confirm bus — bidirectional request/response between
 * main and renderer. This is a new pattern for Bottega (all existing IPC
 * uses one-way safeSend); the surface is intentionally minimal:
 *
 *   main  → renderer    'guardrails:confirm-request'    (Pi SDK handler awaits)
 *   renderer → main     'guardrails:confirm-response'   (ipcMain.handle)
 *
 * Contract:
 *   - Timeout: 10s default, per-rule override via RuleMatch.confirmTimeoutMs; fail-closed (block).
 *   - No renderer / destroyed webContents: fail-closed.
 *   - External abort signal: fail-closed + cleanup.
 *   - Unknown requestId responses: silently dropped.
 */

import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import { createChildLogger } from '../../figma/logger.js';
import { safeSend } from '../safe-send.js';
import type { ConfirmDecision, ConfirmRequest, ConfirmResponse } from './types.js';

const log = createChildLogger({ component: 'guardrails-bus' });

export const CONFIRM_TIMEOUT_MS = 10_000;
/** Hard ceiling so a misconfigured rule can't stall a turn forever. */
export const CONFIRM_TIMEOUT_MAX_MS = 60_000;

interface PendingEntry {
  resolve: (decision: ConfirmDecision) => void;
  timer: NodeJS.Timeout;
  /** Cleanup hook — unregisters signal listener if one was attached. */
  cleanup: () => void;
}
const pending = new Map<string, PendingEntry>();

function finalize(requestId: string, decision: ConfirmDecision): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.cleanup();
  pending.delete(requestId);
  entry.resolve(decision);
}

let ipcRegistered = false;

/** Register the response handler on ipcMain. Idempotent; safe to call in tests. */
export function registerGuardrailsIpc(): void {
  if (ipcRegistered) return;
  ipcMain.handle('guardrails:confirm-response', (_ev, response: ConfirmResponse) => {
    if (!response || !pending.has(response.requestId)) return;
    finalize(response.requestId, response.decision === 'allow-once' ? 'allow-once' : 'block');
  });
  ipcRegistered = true;
}

/**
 * Send a confirm request to the renderer and await the decision.
 * Returns 'block' on any error (no renderer, destroyed webContents,
 * timeout, external abort). Pending entries are always cleaned up.
 */
export async function requestConfirm(
  wc: Electron.WebContents | null | undefined,
  req: Omit<ConfirmRequest, 'requestId' | 'timestamp'>,
  externalSignal?: AbortSignal,
): Promise<ConfirmDecision> {
  if (!wc || wc.isDestroyed()) {
    log.debug({ reason: 'no-webContents' }, 'guardrails: fail-closed (no renderer)');
    return 'block';
  }

  const requestId = randomUUID();
  const fullReq: ConfirmRequest = { ...req, requestId, timestamp: Date.now() };
  const ruleTimeout = req.match.confirmTimeoutMs;
  const effectiveTimeout =
    typeof ruleTimeout === 'number' && ruleTimeout > 0
      ? Math.min(ruleTimeout, CONFIRM_TIMEOUT_MAX_MS)
      : CONFIRM_TIMEOUT_MS;

  return new Promise<ConfirmDecision>((resolve) => {
    const timer = setTimeout(() => {
      if (!pending.has(requestId)) return;
      log.info({ requestId, ruleId: req.match.ruleId }, 'guardrails: timeout → block');
      finalize(requestId, 'block');
    }, effectiveTimeout);

    const onAbort = () => {
      if (!pending.has(requestId)) return;
      log.info({ requestId, ruleId: req.match.ruleId }, 'guardrails: aborted → block');
      finalize(requestId, 'block');
    };
    const cleanup = () => {
      externalSignal?.removeEventListener('abort', onAbort);
    };

    pending.set(requestId, { resolve, timer, cleanup });

    if (externalSignal) {
      if (externalSignal.aborted) {
        onAbort();
        return;
      }
      externalSignal.addEventListener('abort', onAbort, { once: true });
    }

    safeSend(wc, 'guardrails:confirm-request', fullReq);
  });
}

/** Test-only: drop all pending entries. */
export function __resetPendingForTests(): void {
  for (const { timer, cleanup } of pending.values()) {
    clearTimeout(timer);
    cleanup();
  }
  pending.clear();
}

/** Test-only: inspect pending size. */
export function __pendingSizeForTests(): number {
  return pending.size;
}
