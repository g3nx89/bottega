/**
 * F17: Pure decision logic for launch-time auto-fallback.
 * Extracted from index.ts so it can be unit-tested without Electron / slotManager.
 */

import type { ProbeStatus } from './model-probe.js';

export type FallbackDecision =
  | { type: 'no_action'; reason: 'probe_ok' | 'no_last_good' | 'same_model' }
  | { type: 'fallback'; from: string; to: string; probeStatus: ProbeStatus };

/**
 * Decide whether a slot should be auto-switched.
 *
 * - probe 'ok' → no_action/probe_ok
 * - no lastGood → no_action/no_last_good
 * - lastGood equals current → no_action/same_model (already using it)
 * - otherwise → fallback
 */
export function decideAutoFallback(
  currentModelId: string,
  probeStatus: ProbeStatus,
  lastGoodModelId: string | null | undefined,
): FallbackDecision {
  if (probeStatus === 'ok') return { type: 'no_action', reason: 'probe_ok' };
  if (!lastGoodModelId) return { type: 'no_action', reason: 'no_last_good' };
  if (lastGoodModelId === currentModelId) return { type: 'no_action', reason: 'same_model' };
  return { type: 'fallback', from: currentModelId, to: lastGoodModelId, probeStatus };
}
