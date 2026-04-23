import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  annotateError,
  buildForbiddenMessage,
  buildMissingNodeMessage,
  buildNotFoundMessage,
  buildRateLimitMessage,
  extractFigmaErr,
  getConnectionErrorCode,
  getErrorMeta,
  HttpError,
  httpStatusCategory,
  redactAndTruncateBody,
  redactErrorStrings,
} from '../../../src/figma/errors.js';

describe('errors module', () => {
  describe('HttpError', () => {
    it('carries status, body, headers, and figmaErr', () => {
      const err = new HttpError('boom', {
        status: 403,
        responseBody: 'Invalid token',
        responseHeaders: { 'retry-after': '5' },
        figmaErr: 'Invalid scope',
      });
      expect(err).toBeInstanceOf(Error);
      expect(err).toBeInstanceOf(HttpError);
      expect(err.name).toBe('HttpError');
      expect(err.status).toBe(403);
      expect(err.responseBody).toBe('Invalid token');
      expect(err.responseHeaders['retry-after']).toBe('5');
      expect(err.figmaErr).toBe('Invalid scope');
    });

    it('defaults responseHeaders to empty object', () => {
      const err = new HttpError('x', { status: 500 });
      expect(err.responseHeaders).toEqual({});
    });
  });

  describe('httpStatusCategory', () => {
    it.each([
      [429, 'rate_limit'],
      [401, 'auth'],
      [403, 'auth'],
      [404, 'not_found'],
      [400, 'invalid_input'],
      [422, 'invalid_input'],
      [500, 'figma_api'],
      [502, 'figma_api'],
      [503, 'figma_api'],
      [418, 'figma_api'],
    ])('status %i maps to %s', (status, expected) => {
      expect(httpStatusCategory(status)).toBe(expected);
    });
  });

  describe('extractFigmaErr', () => {
    it('returns err field from JSON body', () => {
      expect(extractFigmaErr('{"err":"Invalid token"}')).toBe('Invalid token');
    });

    it('falls back to message field', () => {
      expect(extractFigmaErr('{"message":"something"}')).toBe('something');
    });

    it('returns undefined for HTML body', () => {
      expect(extractFigmaErr('<html>Blocked</html>')).toBeUndefined();
    });

    it('returns undefined for empty body', () => {
      expect(extractFigmaErr('')).toBeUndefined();
      expect(extractFigmaErr(undefined)).toBeUndefined();
    });
  });

  describe('redactAndTruncateBody', () => {
    it('redacts secrets', () => {
      expect(redactAndTruncateBody('token=figd_abc123 leaked', ['figd_abc123'])).toBe('token=[REDACTED] leaked');
    });

    it('collapses whitespace and trims', () => {
      expect(redactAndTruncateBody('  foo\n\n\tbar  ')).toBe('foo bar');
    });

    it('truncates long bodies', () => {
      const long = 'a'.repeat(600);
      const result = redactAndTruncateBody(long);
      expect(result.length).toBeLessThanOrEqual(520);
      expect(result).toContain('[truncated]');
    });

    it('ignores empty secrets in the redact list', () => {
      expect(redactAndTruncateBody('hello world', ['', 'world'])).toBe('hello [REDACTED]');
    });
  });

  describe('annotateError + getErrorMeta', () => {
    it('attaches meta and returns the same instance', () => {
      const err = new Error('x');
      const out = annotateError(err, { category: 'auth', http_status: 403 });
      expect(out).toBe(err);
      expect(getErrorMeta(out)).toMatchObject({ category: 'auth', http_status: 403 });
    });

    it('supports throw-annotateError idiom', () => {
      const err = new Error('boom');
      expect(() => {
        throw annotateError(err, { category: 'network' });
      }).toThrow(err);
    });

    it('no-ops on non-object input', () => {
      expect(annotateError(null, { category: 'internal' })).toBeNull();
      expect(annotateError('str' as unknown, { category: 'internal' })).toBe('str');
    });

    it('reads merged meta from the error chain', () => {
      const inner = annotateError(new Error('inner'), { http_status: 500, category: 'figma_api' });
      const outer: Error & { cause?: unknown } = new Error('outer');
      outer.cause = inner;
      annotateError(outer, { category: 'internal' });
      const meta = getErrorMeta(outer);
      expect(meta.category).toBe('internal');
      expect(meta.http_status).toBe(500);
    });

    it('returns empty meta for non-tagged errors', () => {
      expect(getErrorMeta(new Error('plain'))).toEqual({});
      expect(getErrorMeta(null)).toEqual({});
    });

    it('handles cyclic cause chains without infinite loop', () => {
      const a: Error & { cause?: unknown } = new Error('a');
      const b: Error & { cause?: unknown } = new Error('b');
      a.cause = b;
      b.cause = a;
      expect(() => getErrorMeta(a)).not.toThrow();
    });
  });

  describe('message builders', () => {
    it('buildForbiddenMessage surfaces figmaErr verbatim when present', () => {
      const msg = buildForbiddenMessage('/v1/files/abc', 'Invalid scope');
      expect(msg).toContain('Figma API error (403)');
      expect(msg).toContain('Invalid scope');
      expect(msg).toContain('https://help.figma.com');
    });

    it('buildForbiddenMessage falls back to canned causes without body', () => {
      const msg = buildForbiddenMessage('/v1/files/abc', undefined);
      expect(msg).toContain('Figma API error (403)');
      expect(msg).toContain('library_content:read');
      expect(msg).toContain('https://help.figma.com');
    });

    it('buildRateLimitMessage includes retry-after when present', () => {
      expect(buildRateLimitMessage('/v1/me', '30')).toContain('Retry after 30s');
      expect(buildRateLimitMessage('/v1/me', undefined)).toContain('Back off and retry');
    });

    it('buildNotFoundMessage suggests fresh link', () => {
      const msg = buildNotFoundMessage('/v1/files/abc/nodes', 'Node not found');
      expect(msg).toContain('Figma API error (404)');
      expect(msg).toContain('Node not found');
      expect(msg).toContain('re-copy the Figma link');
    });

    it('buildForbiddenMessage always appends proxy hint', () => {
      expect(buildForbiddenMessage('/v1/me', 'Invalid scope')).toContain('HTTP_PROXY');
      expect(buildForbiddenMessage('/v1/me', undefined)).toContain('HTTP_PROXY');
    });

    it('buildRateLimitMessage parses HTTP-date retry-after', () => {
      const futureIso = new Date(Date.now() + 30_000).toUTCString();
      const msg = buildRateLimitMessage('/v1/me', futureIso);
      // Expect "Retry after Ns." where N is 29 or 30 depending on rounding
      expect(msg).toMatch(/Retry after (29|30)s\./);
    });
  });

  describe('getConnectionErrorCode', () => {
    it('returns a direct network code', () => {
      const err = Object.assign(new Error('boom'), { code: 'ECONNRESET' });
      expect(getConnectionErrorCode(err)).toBe('ECONNRESET');
    });

    it('walks nested cause.cause to find the code', () => {
      const inner = Object.assign(new Error('socket'), { code: 'ETIMEDOUT' });
      const mid: Error & { cause?: unknown } = new Error('fetch fail');
      mid.cause = inner;
      const outer: Error & { cause?: unknown } = new Error('wrap');
      outer.cause = mid;
      expect(getConnectionErrorCode(outer)).toBe('ETIMEDOUT');
    });

    it('does not loop on a cyclic cause chain', () => {
      const a: Error & { cause?: unknown } = new Error('a');
      const b: Error & { cause?: unknown } = new Error('b');
      a.cause = b;
      b.cause = a;
      expect(() => getConnectionErrorCode(a)).not.toThrow();
      expect(getConnectionErrorCode(a)).toBeUndefined();
    });

    it('returns undefined for unknown codes', () => {
      expect(getConnectionErrorCode(new Error('x'))).toBeUndefined();
      expect(getConnectionErrorCode(Object.assign(new Error('x'), { code: 'EUNKNOWN' }))).toBeUndefined();
    });
  });

  describe('redactErrorStrings', () => {
    it('scrubs figd_ (PAT) tokens via the fallback pattern', () => {
      const out = redactErrorStrings('leaked figd_abcdefghijklmnop0123', []);
      expect(out).toBe('leaked [REDACTED]');
    });

    it('scrubs figu_ (OAuth) tokens', () => {
      const out = redactErrorStrings('hdr figu_abcdefghijklmnop0123', []);
      expect(out).toBe('hdr [REDACTED]');
    });

    it('scrubs Bearer header echoes', () => {
      const out = redactErrorStrings('Authorization: Bearer abcdefghijklmnop0123', []);
      expect(out).toContain('[REDACTED]');
      expect(out).not.toContain('abcdefghijklmnop0123');
    });

    it('does NOT match figo_ or other non-token prefixes', () => {
      const s = 'figo_someother_value figa_x';
      expect(redactErrorStrings(s, [])).toBe(s);
    });

    it('handles secrets containing regex-special characters (literal string match)', () => {
      // split/join is literal, not regex — confirm no metacharacter escape is
      // required. If anyone swaps to String.replace(regex), this test breaks.
      const secret = 'figd_a.b+c*d(e)f|g';
      const out = redactErrorStrings(`token=${secret}|extra`, [secret]);
      expect(out).toBe('token=[REDACTED]|extra');
    });
  });

  describe('redactAndTruncateBody — extra cases', () => {
    it('truncates at MAX_BODY_CHARS (<=520 including [truncated])', () => {
      const out = redactAndTruncateBody('a'.repeat(600));
      expect(out.length).toBeLessThanOrEqual(520);
      expect(out).toContain('[truncated]');
    });
  });

  describe('buildMissingNodeMessage', () => {
    it('lists up to 5 IDs and appends a (+N more) suffix', () => {
      const ids = ['a:1', 'a:2', 'a:3', 'a:4', 'a:5', 'a:6', 'a:7', 'a:8'];
      const msg = buildMissingNodeMessage('file123', ids);
      expect(msg).toContain('a:1, a:2, a:3, a:4, a:5');
      expect(msg).toContain('(+3 more)');
      expect(msg).not.toContain('a:6');
    });
  });

  describe('buildRateLimitMessage — malformed retry-after', () => {
    it('passes through an unparseable retry-after string unchanged', () => {
      const msg = buildRateLimitMessage('/v1/me', 'next-tuesday');
      expect(msg).toContain('Retry after next-tuesday');
    });
  });

  describe('annotateError — merge behavior', () => {
    it('outer wins for overlapping keys across the cause chain', () => {
      const inner = annotateError(new Error('inner'), { category: 'network', http_status: 500 });
      const outer: Error & { cause?: unknown } = new Error('outer');
      outer.cause = inner;
      annotateError(outer, { category: 'auth' });
      const meta = getErrorMeta(outer);
      expect(meta.category).toBe('auth');
      expect(meta.http_status).toBe(500);
    });
  });

  describe('HttpError.meta auto-population', () => {
    it('getErrorMeta reads meta passed to HttpError constructor', () => {
      const err = new HttpError('x', {
        status: 500,
        meta: { category: 'figma_api', is_retryable: true },
      });
      const meta = getErrorMeta(err);
      expect(meta.category).toBe('figma_api');
      expect(meta.http_status).toBe(500);
      expect(meta.is_retryable).toBe(true);
    });

    it('exposes meta as a readonly field for direct access', () => {
      const err = new HttpError('x', {
        status: 429,
        meta: { category: 'rate_limit' },
      });
      expect(err.meta.category).toBe('rate_limit');
    });
  });
});
