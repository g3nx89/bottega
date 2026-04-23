/**
 * Tests for `serializeLoggedError` — the pure error serializer that pino's
 * `err` serializer delegates to. Directly exercising the pure helper keeps
 * these tests fast + deterministic (no transport spin-up).
 */
import { describe, expect, it } from 'vitest';

import { annotateError, HttpError } from '../../../src/figma/errors.js';
import { serializeLoggedError } from '../../../src/figma/logger.js';

describe('serializeLoggedError', () => {
  it('scrubs registered secret from message', () => {
    const secret = 'figd_registeredsecret1234';
    const err = new Error(`leaked ${secret} here`);
    const out = serializeLoggedError(err, [secret]);
    expect(out.message).toBe('leaked [REDACTED] here');
  });

  it('scrubs registered secret from stack', () => {
    const secret = 'figd_stackleaked12345678';
    const err = new Error('x');
    err.stack = `Error: x\n    at handler (${secret})`;
    const out = serializeLoggedError(err, [secret]);
    expect(out.stack).not.toContain(secret);
    expect(out.stack).toContain('[REDACTED]');
  });

  it('scrubs figd_ token pattern even without register', () => {
    const err = new Error('oops figd_patternonly_123456789');
    const out = serializeLoggedError(err, []);
    expect(out.message).toContain('[REDACTED]');
    expect(out.message).not.toContain('figd_patternonly');
  });

  it('scrubs Bearer header echoes in message', () => {
    const err = new Error('Authorization: Bearer abcdefghijklmnop0123456');
    const out = serializeLoggedError(err, []);
    expect(out.message).toContain('[REDACTED]');
  });

  it('adds error_meta block for HttpError', () => {
    const err = new HttpError('boom', {
      status: 403,
      meta: { category: 'auth', is_retryable: false },
    });
    const out = serializeLoggedError(err, []);
    expect(out.error_meta).toMatchObject({
      category: 'auth',
      http_status: 403,
      is_retryable: false,
    });
  });

  it('omits error_meta for plain Error without annotate', () => {
    const out = serializeLoggedError(new Error('plain'), []);
    expect('error_meta' in out).toBe(false);
  });

  it('error_meta does not clobber pino stdSerializer fields (type/message/stack)', () => {
    const err = annotateError(new HttpError('boom', { status: 500 }), {
      category: 'figma_api',
      is_retryable: true,
    });
    const out = serializeLoggedError(err, []);
    // pino.stdSerializers.err emits `type`, `message`, `stack` at top level —
    // none of these may be overwritten when the meta merge happens.
    expect(out.type).toBe('HttpError');
    expect(out.message).toBe('boom');
    expect(typeof out.stack).toBe('string');
    expect(out.error_meta).toBeDefined();
  });

  it('picks up network_code for annotated network errors', () => {
    const netErr = annotateError(Object.assign(new Error('socket'), { code: 'ECONNREFUSED' }), {
      category: 'network',
      network_code: 'ECONNREFUSED',
      is_retryable: true,
    });
    const out = serializeLoggedError(netErr, []);
    expect(out.error_meta).toMatchObject({
      category: 'network',
      network_code: 'ECONNREFUSED',
      is_retryable: true,
    });
  });
});
