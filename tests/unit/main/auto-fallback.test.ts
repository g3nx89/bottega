import { describe, expect, it } from 'vitest';
import { decideAutoFallback } from '../../../src/main/auto-fallback.js';

describe('F17: decideAutoFallback', () => {
  it('no_action when probe is ok', () => {
    expect(decideAutoFallback('gpt-5.4', 'ok', 'gpt-5.4-mini')).toEqual({ type: 'no_action', reason: 'probe_ok' });
  });

  it('no_action when probe is red but no last-good', () => {
    expect(decideAutoFallback('gpt-5.4', 'unauthorized', null)).toEqual({
      type: 'no_action',
      reason: 'no_last_good',
    });
    expect(decideAutoFallback('gpt-5.4', 'forbidden', undefined)).toEqual({
      type: 'no_action',
      reason: 'no_last_good',
    });
  });

  it('no_action when last-good equals current model', () => {
    expect(decideAutoFallback('gpt-5.4', 'forbidden', 'gpt-5.4')).toEqual({
      type: 'no_action',
      reason: 'same_model',
    });
  });

  it('fallback when probe red and last-good differs', () => {
    expect(decideAutoFallback('gpt-5.4-mini', 'unauthorized', 'gpt-5.4')).toEqual({
      type: 'fallback',
      from: 'gpt-5.4-mini',
      to: 'gpt-5.4',
      probeStatus: 'unauthorized',
    });
  });

  it('fallback also triggers on not_found / forbidden / rate_limit / error', () => {
    for (const status of ['not_found', 'forbidden', 'rate_limit', 'error'] as const) {
      const decision = decideAutoFallback('a', status, 'b');
      expect(decision.type).toBe('fallback');
      if (decision.type === 'fallback') expect(decision.probeStatus).toBe(status);
    }
  });
});
