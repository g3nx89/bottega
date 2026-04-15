import { describe, expect, it } from 'vitest';
import { messageForStreamError } from '../../../src/main/messages.js';

describe('F13: messageForStreamError', () => {
  it('401 → unauthorized hint with provider', () => {
    expect(messageForStreamError(401, 'anthropic', 'claude-sonnet-4-6')).toContain('re-login');
    expect(messageForStreamError(401, 'anthropic', 'claude-sonnet-4-6')).toContain('anthropic');
  });
  it('403 → forbidden hint with model', () => {
    const m = messageForStreamError(403, 'openai', 'gpt-5.4-mini');
    expect(m).toContain('gpt-5.4-mini');
    expect(m).toContain('not available');
  });
  it('404 → not recognized', () => {
    expect(messageForStreamError(404, 'openai', 'gpt-ghost')).toContain('not recognized');
  });
  it('429 with retry-after', () => {
    expect(messageForStreamError(429, 'anthropic', 'x', 12)).toContain('12s');
  });
  it('429 without retry-after', () => {
    expect(messageForStreamError(429, 'anthropic', 'x')).toContain('Rate limit');
  });
  it('5xx → provider unavailable', () => {
    expect(messageForStreamError(503, 'anthropic', 'x')).toContain('anthropic');
    expect(messageForStreamError(503, 'anthropic', 'x')).toContain('unavailable');
  });
  it('null / unknown → generic empty message', () => {
    expect(messageForStreamError(null, 'anthropic', 'x')).toContain('empty response');
  });
});
