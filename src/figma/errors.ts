/**
 * Structured error types for Figma REST API failures.
 *
 * Design goals:
 * - Callers discriminate failure modes without string-matching messages.
 * - Telemetry (Axiom) categorizes failures without parsing stack traces.
 * - LLM agents see the actual Figma error body on 403/404 so they suggest
 *   concrete remediation (e.g. "your PAT is missing the library_content:read
 *   scope") rather than guessing from a generic "API disabled" string.
 *
 * Adapted from Figma-Context-MCP (MIT, © 2025 Graham Lipsman):
 *   https://github.com/GLips/Figma-Context-MCP — commits 12280ba (HttpError +
 *   403 body) and 334ae2b (ErrorCategory).
 *
 * Bottega-specific changes: unconditional secret redaction (single-tenant),
 * Symbol-keyed meta auto-populated by HttpError constructor so a pino
 * serializer can read it uniformly for HTTP and non-HTTP tagged errors, and a
 * network-error branch that matches the undici/Node connection error codes.
 */

import { FIGMA_OAUTH_PREFIX, FIGMA_PAT_PREFIX } from './constants.js';

// Re-exported so existing consumers of errors.ts keep working — the single
// source of truth lives in `./constants.ts`.
export { FIGMA_OAUTH_PREFIX, FIGMA_PAT_PREFIX };

export type ErrorCategory =
  | 'rate_limit'
  | 'auth'
  | 'not_found'
  | 'invalid_input'
  | 'network'
  | 'figma_api'
  | 'image_download'
  | 'internal';

export interface ErrorMeta {
  category?: ErrorCategory;
  http_status?: number;
  network_code?: string;
  is_retryable?: boolean;
}

/**
 * Meta carried by `HttpError` instances — narrowed form of `ErrorMeta` whose
 * `http_status` is guaranteed non-nullable. The `HttpError` constructor
 * derives `http_status` from the response status, so consumers reading
 * `err.meta.http_status` can skip a null-check.
 */
export type HttpErrorMeta = ErrorMeta & { http_status: number };

/**
 * Symbol-keyed storage for error metadata. `Symbol.for()` is used (not
 * `Symbol()`) so the key survives serialization boundaries — a pino
 * serializer in a different module realm can read the same tag. Cross-realm
 * collision risk is negligible given the namespaced key.
 */
const META = Symbol.for('bottega.errorMeta');

type WithMeta = { [META]?: ErrorMeta };

/**
 * Error thrown on non-2xx HTTP responses from Figma. Exposes the response
 * body verbatim (truncated + secret-redacted) so the calling LLM can read
 * the actual Figma `err` string — distinct 403 causes ("missing scope",
 * "token revoked", "file not exportable") have distinct fixes, and the
 * legacy four-bullet canned list lumped them all together.
 *
 * `figmaErr` is the parsed `err` field when the body is JSON. `responseBody`
 * is always present for debugging corporate-proxy HTML blocks.
 *
 * The constructor auto-populates Symbol meta on the instance so callers can
 * just `throw new HttpError(..., { meta: {...} })`. For non-HttpError cases
 * (e.g. native network errors caught and rethrown) use
 * `throw annotateError(err, meta)` — an explicit throw keeps control flow
 * visible at the call site.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly responseBody: string | undefined;
  readonly responseHeaders: Record<string, string>;
  readonly figmaErr: string | undefined;
  readonly meta: HttpErrorMeta;

  constructor(
    message: string,
    opts: {
      status: number;
      responseBody?: string;
      responseHeaders?: Record<string, string>;
      figmaErr?: string;
      meta?: Omit<ErrorMeta, 'http_status'>;
    },
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = opts.status;
    this.responseBody = opts.responseBody;
    this.responseHeaders = opts.responseHeaders ?? {};
    this.figmaErr = opts.figmaErr;
    // Auto-derive http_status from status to avoid two sources of truth.
    // Defensive copy so external mutations on opts.meta don't leak in.
    this.meta = { ...(opts.meta ?? {}), http_status: opts.status };
    (this as WithMeta)[META] = { ...this.meta };
  }
}

/**
 * Attach metadata to an error and return the same instance. Mutates the
 * Symbol-keyed meta slot — the stack trace and identity of the caught error
 * are preserved.
 *
 * Call as `throw annotateError(err, meta)` to keep control flow visible at
 * the call site. For HTTP errors, prefer `new HttpError(..., { meta })` —
 * the constructor auto-populates the Symbol meta so a separate annotate
 * call is unnecessary.
 */
export function annotateError<E>(error: E, meta: ErrorMeta): E {
  if (error && typeof error === 'object') {
    const existing = (error as unknown as WithMeta)[META] ?? {};
    (error as unknown as WithMeta)[META] = { ...existing, ...meta };
  }
  return error;
}

/**
 * Walk the error → cause chain and merge any attached meta. Outer errors win
 * for overlapping keys.
 */
export function getErrorMeta(error: unknown): ErrorMeta {
  const merged: ErrorMeta = {};
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const meta = (current as WithMeta)[META];
    if (meta) {
      for (const [key, value] of Object.entries(meta) as Array<[keyof ErrorMeta, unknown]>) {
        if (merged[key] === undefined && value !== undefined) {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
    }
    current = (current as { cause?: unknown }).cause;
  }
  return merged;
}

/**
 * Map HTTP status to an Axiom-friendly category.
 */
export function httpStatusCategory(status: number): ErrorCategory {
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 400 || status === 422) return 'invalid_input';
  return 'figma_api';
}

/**
 * Node and undici connection error codes that should be tagged with
 * `category: 'network'`. These are Node.js/undici conventions — not Figma-
 * specific — covering the codes Electron's main-process fetch emits when the
 * socket layer fails.
 */
const CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * Extract the network error code from an unknown error, if any. Walks the
 * `.cause` chain because undici wraps the socket error inside a generic
 * fetch `TypeError`. The `seen` set guards against cyclic chains.
 */
export function getConnectionErrorCode(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Extract the Figma `err` string from a response body that may be JSON or
 * HTML (corporate proxy block page). Returns `undefined` if not parseable.
 */
export function extractFigmaErr(body: string | undefined): string | undefined {
  if (!body) return undefined;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as { err?: unknown; message?: unknown };
      if (typeof obj.err === 'string') return obj.err;
      if (typeof obj.message === 'string') return obj.message;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

const MAX_BODY_CHARS = 500;

/**
 * Pattern-based fallback redactor for token-shaped fragments. Covers Figma
 * PAT (`figd_*`) and OAuth (`figu_*`) tokens and `Authorization: Bearer ...`
 * header echoes. Runs AFTER the exact-match pass so a caller-supplied known
 * token is redacted first; this catches the case where the body contains a
 * different (rotated/proxy-echoed) token or a token-shaped pattern we
 * couldn't supply.
 *
 * The alternation `(?:figd_|figu_)` is exact (not `fig[dou]_`) — only PAT
 * (`figd_`) and OAuth (`figu_`) are legitimate Figma token prefixes, so a
 * broader character class would over-match non-token strings.
 */
const TOKEN_PATTERN = new RegExp(
  `\\b((?:${FIGMA_PAT_PREFIX}|${FIGMA_OAUTH_PREFIX})[A-Za-z0-9_-]{16,}|Bearer\\s+[A-Za-z0-9._-]{20,})`,
  'g',
);

/**
 * Normalize a response body for attachment to an error.
 *
 * Order: exact-match runs on the RAW body first so any canonical token
 * occurrences are scrubbed before normalization; whitespace is then collapsed
 * (a defense against proxy line-wrapping that would have defeated
 * token-pattern search); the pattern fallback catches token-shaped residue
 * the caller couldn't supply; finally the body is truncated. Proxy wraps
 * INSIDE the token itself (`figd_abc\n  123`) are not fully recovered by
 * either pass and must rely on the truncation/remediation-hint UX.
 */
export function redactAndTruncateBody(body: string, secretsToRedact: string[] = []): string {
  let out = body;
  for (const secret of secretsToRedact) {
    // Skip empty/falsy secrets — `''.split('')` explodes into chars and
    // `join('[REDACTED]')` would corrupt the body.
    if (secret) out = out.split(secret).join('[REDACTED]');
  }
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(TOKEN_PATTERN, '[REDACTED]');
  if (out.length > MAX_BODY_CHARS) {
    out = `${out.slice(0, MAX_BODY_CHARS)}… [truncated]`;
  }
  return out;
}

/**
 * Redact secrets from an error's `message` and `stack` strings. Used by the
 * pino serializer to defend against upstream code that built an Error whose
 * message interpolates a token (undici internals, proxy wrappers).
 */
export function redactErrorStrings(s: unknown, secretsToRedact: string[] = []): unknown {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const secret of secretsToRedact) {
    if (secret) out = out.split(secret).join('[REDACTED]');
  }
  return out.replace(TOKEN_PATTERN, '[REDACTED]');
}

export const FORBIDDEN_DOCS_URL =
  'https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens';

/**
 * Build a 403 error message that surfaces the Figma `err` body verbatim when
 * available, with a link to docs for per-error resolution. Falls back to a
 * short canned list only if the body couldn't be read. Always closes with a
 * corporate-proxy hint because 403 on a managed machine is frequently caused
 * by an intercepting proxy that rewrites responses.
 */
export function buildForbiddenMessage(endpoint: string, figmaErr: string | undefined): string {
  const proxyHint = ' If behind a corporate proxy, check HTTP_PROXY/HTTPS_PROXY/NO_PROXY env vars.';
  if (figmaErr) {
    return (
      `Figma API error (403) on ${endpoint}: ${figmaErr}. ` +
      `Act on the specific reason above — see ${FORBIDDEN_DOCS_URL} for resolution.${proxyHint}`
    );
  }
  return (
    `Figma API error (403) on ${endpoint}. Common causes: expired/revoked token, ` +
    `missing PAT scope (e.g. library_content:read for library queries), ` +
    `file not shared with token owner, or file export disabled in share settings. ` +
    `See ${FORBIDDEN_DOCS_URL}.${proxyHint}`
  );
}

/**
 * Parse a `Retry-After` header value. Figma may send either delta-seconds
 * (integer) or HTTP-date (RFC 7231). Returns a human-readable "Nns" form.
 */
function formatRetryAfter(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return `${trimmed}s`;
  const ts = Date.parse(trimmed);
  if (!Number.isNaN(ts)) {
    const deltaSec = Math.max(0, Math.round((ts - Date.now()) / 1000));
    return `${deltaSec}s`;
  }
  return raw;
}

/**
 * Build a 429 rate-limit error message. Surfaces `Retry-After` when present,
 * normalized to delta-seconds regardless of the header format.
 */
export function buildRateLimitMessage(endpoint: string, retryAfter: string | undefined): string {
  const formatted = formatRetryAfter(retryAfter);
  if (formatted) {
    return `Figma API error (429) on ${endpoint}: rate-limited. Retry after ${formatted}.`;
  }
  return `Figma API error (429) on ${endpoint}: rate-limited. Back off and retry.`;
}

/**
 * Build a 404 error message suggesting the common fix (stale node ID).
 */
export function buildNotFoundMessage(endpoint: string, figmaErr: string | undefined): string {
  const detail = figmaErr ? `: ${figmaErr}` : '';
  return (
    `Figma API error (404) on ${endpoint}${detail}. ` +
    `The file or node does not exist, was deleted, or the ID is stale — ` +
    `re-copy the Figma link to get a fresh node ID.`
  );
}

/**
 * Build an error message for a node present in a 200 response but with
 * `null` entry — Figma's way of signaling "this node ID is valid format
 * but does not exist in the file" without a 404.
 */
export function buildMissingNodeMessage(fileKey: string, missingNodeIds: string[]): string {
  const ids = missingNodeIds.slice(0, 5).join(', ');
  const suffix = missingNodeIds.length > 5 ? ` (+${missingNodeIds.length - 5} more)` : '';
  return (
    `Figma nodes not found in file ${fileKey}: ${ids}${suffix}. ` +
    `The file key is valid but these node IDs do not exist or were deleted. ` +
    `Re-copy the Figma link or verify the node IDs are from this file.`
  );
}
