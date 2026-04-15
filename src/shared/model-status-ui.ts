/**
 * Canonical UI mapping for F9/F10 model probe status.
 *
 * The renderer (`src/renderer/settings.js`) inlines this logic for zero-bundle
 * cost in the DOM layer; this module exists so the mapping is unit-testable
 * and documented as the single source of truth. Divergence between the two is
 * a regression — flagged by `model-status-ui.test.ts`.
 */

export type ProbeStatusUi = 'ok' | 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limit' | 'error' | 'unknown';

/** F9: green/yellow/red dot for the picker. */
export function statusDot(status: ProbeStatusUi): '🟢' | '🟡' | '🔴' {
  if (status === 'ok') return '🟢';
  if (status === 'unauthorized' || status === 'forbidden' || status === 'not_found') return '🔴';
  return '🟡';
}

/** F10: red statuses correspond to disabled picker entries. */
export function isDisabledStatus(status: ProbeStatusUi): boolean {
  return status === 'unauthorized' || status === 'forbidden' || status === 'not_found';
}
