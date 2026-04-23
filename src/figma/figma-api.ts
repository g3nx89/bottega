/**
 * Figma REST API Client
 * Handles HTTP calls to Figma's REST API for file data, variables, components, and styles.
 *
 * Error surfacing adapted from Figma-Context-MCP (MIT, © 2025 Graham Lipsman)
 * commits 12280ba and 334ae2b. See src/figma/errors.ts for the HttpError and
 * ErrorCategory types.
 */

import { FIGMA_OAUTH_PREFIX } from './constants.js';
import {
  annotateError,
  buildForbiddenMessage,
  buildMissingNodeMessage,
  buildNotFoundMessage,
  buildRateLimitMessage,
  extractFigmaErr,
  getConnectionErrorCode,
  HttpError,
  httpStatusCategory,
  redactAndTruncateBody,
  redactErrorStrings,
} from './errors.js';
import { createChildLogger, registerSecret, unregisterSecret } from './logger.js';

/**
 * Figma `err` strings (returned as the `err` field of a 403 body) that
 * indicate the access token itself is invalid — distinct from file/scope
 * permission errors. Matching any of these trips the circuit breaker.
 * Substring-matching on the whole error body was too loose and missed
 * rotated/expired-token cases that use different phrasing.
 */
const AUTH_INVALIDATION_ERRS: ReadonlySet<string> = new Set([
  'Invalid token',
  'Token expired',
  'Token revoked',
  'Invalid API key',
]);

const logger = createChildLogger({ component: 'figma-api' });

const FIGMA_API_BASE = 'https://api.figma.com/v1';

/**
 * Extract file key from Figma URL
 * @example https://www.figma.com/design/abc123/My-File -> abc123
 */
export function extractFileKey(url: string): string | null {
  try {
    const urlObj = new URL(url);
    const match = urlObj.pathname.match(/\/(design|file)\/([a-zA-Z0-9]+)/);
    return match ? match[2]! : null;
  } catch (error) {
    logger.error({ error, url }, 'Failed to extract file key from URL');
    return null;
  }
}

/**
 * Information extracted from a Figma URL
 */
export interface FigmaUrlInfo {
  fileKey: string;
  branchId?: string;
  nodeId?: string;
}

/**
 * Authenticated user identity returned by GET /v1/me.
 *
 * `email` is intentionally NOT declared: Figma returns it, but Bottega must
 * never surface it to the agent (PII). If a future caller legitimately needs
 * email (e.g. user-visible UI only), narrow the raw response at that call
 * site — do NOT add `email` here.
 */
export interface FigmaUser {
  id: string;
  handle: string;
  img_url?: string;
}

/** Single entry in GET /v1/files/:key/versions. */
export interface FigmaFileVersion {
  id: string;
  created_at: string;
  label: string | null;
  description: string | null;
  user: { id: string; handle: string; img_url?: string };
  thumbnail_url?: string;
}

/** Response shape of GET /v1/files/:key/versions. */
export interface FigmaVersionsResponse {
  versions: FigmaFileVersion[];
  pagination?: { prev_page?: string; next_page?: string };
}

/** Single Dev Mode resource attached to a node. */
export interface FigmaDevResource {
  id: string;
  name: string;
  url: string;
  file_key: string;
  node_id: string;
}

/** Response shape of GET /v1/files/:key/dev_resources. */
export interface FigmaDevResourcesResponse {
  dev_resources: FigmaDevResource[];
}

/**
 * Extract comprehensive URL info including branch and node IDs
 */
export function extractFigmaUrlInfo(url: string): FigmaUrlInfo | null {
  try {
    const urlObj = new URL(url);

    const branchPathMatch = urlObj.pathname.match(/\/(design|file)\/([a-zA-Z0-9]+)\/branch\/([a-zA-Z0-9]+)/);
    if (branchPathMatch) {
      const fileKey = branchPathMatch[2]!;
      const branchId = branchPathMatch[3]!;
      const nodeIdParam = urlObj.searchParams.get('node-id');
      const nodeId = nodeIdParam ? nodeIdParam.replace(/-/g, ':') : undefined;
      return { fileKey, branchId, nodeId };
    }

    const standardMatch = urlObj.pathname.match(/\/(design|file)\/([a-zA-Z0-9]+)/);
    if (!standardMatch) return null;

    const fileKey = standardMatch[2]!;
    const branchId = urlObj.searchParams.get('branch-id') || undefined;
    const nodeIdParam = urlObj.searchParams.get('node-id');
    const nodeId = nodeIdParam ? nodeIdParam.replace(/-/g, ':') : undefined;

    return { fileKey, branchId, nodeId };
  } catch (error) {
    logger.error({ error, url }, 'Failed to extract Figma URL info');
    return null;
  }
}

/**
 * Wrap a promise with a timeout
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    void promise.finally(() => clearTimeout(timeoutId));
  });
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Figma API Client
 * Makes authenticated requests to Figma REST API
 */
export class FigmaAPI {
  private accessToken: string;
  private consecutive403Count = 0;
  private apiDisabled = false;
  /**
   * Monotonic counter incremented on every `setAccessToken()` call. `request()`
   * captures the epoch at start; post-fetch mutations to
   * `consecutive403Count`/`apiDisabled` and error-path redaction are gated on
   * epoch equality so a stale in-flight response can't disable a newly
   * rotated token or leak the old secret through redaction done with the new
   * `this.accessToken`.
   */
  private tokenEpoch = 0;
  private static readonly MAX_403_BEFORE_DISABLE = 3;
  /**
   * W-002: Transient HTTP codes eligible for retry with backoff. Includes
   * 408 (Request Timeout) and 504 (Gateway Timeout) which flaky corporate
   * proxies commonly produce — matches upstream figma-developer-mcp parity.
   */
  private static readonly RETRYABLE_CODES = new Set([408, 429, 500, 502, 503, 504]);
  private static readonly MAX_RETRIES = 2;
  private static readonly BACKOFF_BASE_MS = 1_000;
  private static readonly BACKOFF_MAX_MS = 10_000;
  private static readonly BACKOFF_JITTER_MS = 500;
  private static readonly VALIDATE_TIMEOUT_MS = 10_000;

  constructor(accessToken?: string) {
    this.accessToken = accessToken || '';
    registerSecret(this.accessToken);
  }

  /**
   * Update the access token at runtime. Resets error state so a corrected
   * token can recover from a previously-disabled client (e.g., after 3x 403s).
   *
   * Calling with an empty string clears the token and causes subsequent
   * `request()` calls to throw `'Figma REST API token not configured'`
   * (fast-fail instead of sending empty-header requests).
   *
   * IMPORTANT: The `apiDisabled` and `consecutive403Count` resets are
   * load-bearing — they are what allow the "user saves a bad token, then
   * saves a good one" recovery flow to work without an app restart. See
   * `src/main/ipc-handlers-figma-auth.ts` `figma-auth:set-token` handler.
   * Do NOT refactor this to a plain setter without preserving that behavior.
   */
  setAccessToken(token: string): void {
    // Register new token BEFORE unregistering old one so the global secret set
    // never has an empty transient window during rotation — in-flight error
    // serialization that runs during this call still scrubs both.
    // Skip the register/unregister dance if the token didn't actually change —
    // otherwise `register(same)` is a Set no-op and the subsequent
    // `unregister(previous)` would silently drop the token from the scrub
    // registry, defeating redaction on future logs.
    const previous = this.accessToken;
    const next = token || '';
    if (next !== previous) {
      this.accessToken = next;
      registerSecret(this.accessToken);
      unregisterSecret(previous);
      // tokenEpoch tracks token-identity changes, not setter-call count. If the
      // token did not actually change, incrementing would cause in-flight
      // requests (epochAtStart = previousEpoch) to be treated as stale — their
      // legitimate 403s would be silently ignored by the epoch-gated breaker.
      this.tokenEpoch++;
    }
    this.consecutive403Count = 0;
    this.apiDisabled = false;
    logger.info({ hasToken: !!this.accessToken }, 'Figma API access token updated');
  }

  /**
   * Validate a token by calling `GET /v1/me`. Static because it's called
   * during the "save token" and "startup revalidation" flows, before any
   * FigmaAPI instance is reconfigured. Handles network errors, timeout,
   * and non-2xx responses uniformly.
   *
   * Never persists the token. Never mutates global state. Safe to call
   * concurrently.
   */
  static async validateToken(
    token: string,
  ): Promise<{ ok: true; handle: string } | { ok: false; error: string; status?: number }> {
    if (!token || !token.trim()) {
      return { ok: false, error: 'Token is required' };
    }
    const trimmed = token.trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FigmaAPI.VALIDATE_TIMEOUT_MS);
    try {
      const response = await fetch(`${FIGMA_API_BASE}/me`, {
        headers: { 'X-Figma-Token': trimmed },
        signal: controller.signal,
      });

      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: 'Invalid token', status: response.status };
      }
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        return {
          ok: false,
          error: `Figma API error (${response.status}): ${body}`,
          status: response.status,
        };
      }

      // Only use `handle` or `id` for UI display — never `email`, which would
      // persist PII as plaintext metadata in figma-auth.json (the handle field
      // is not encrypted even when safeStorage is available — only the token).
      const data = (await response.json()) as { handle?: string; id?: string };
      const handle = data.handle || data.id || 'Figma user';
      return { ok: true, handle };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Make authenticated request to Figma API.
   * W-002: Retries transient errors (429, 5xx) with exponential backoff.
   */
  private async request(endpoint: string, options: RequestInit = {}): Promise<any> {
    this.assertApiEnabled();
    const url = `${FIGMA_API_BASE}${endpoint}`;
    const { headers, isOAuthToken } = this.buildRequestHeaders(options);
    // Snapshot both at request start so an in-flight rotation (setAccessToken)
    // can't poison the breaker or leak the OLD token through error redaction.
    const epochAtStart = this.tokenEpoch;
    const secretAtStart = this.accessToken;

    for (let attempt = 0; attempt <= FigmaAPI.MAX_RETRIES; attempt++) {
      logger.info(
        {
          url,
          hasToken: !!this.accessToken,
          isOAuthToken,
          authMethod: isOAuthToken ? 'Bearer' : 'X-Figma-Token',
          ...(attempt > 0 && { retry: attempt }),
        },
        'Making Figma API request',
      );

      const response = await this.fetchWithNetworkTagging(url, options, headers, secretAtStart);

      if (response.ok) {
        if (epochAtStart === this.tokenEpoch) this.consecutive403Count = 0;
        return await response.json();
      }

      // Body-read can throw with the request URL or a fragment of the token
      // embedded in the error message (undici stream errors, interrupted TLS).
      // Redact that message with `secretAtStart` before rethrowing so a
      // rotated-away token doesn't leak through the global set after
      // `unregisterSecret` has already run for the old value.
      //
      // Tag as `network` (not `figma_api`): the HTTP response arrived but the
      // body stream aborted — socket/TLS class of failure. `http_status` is
      // preserved as context so dashboards can still see which response the
      // read failed on.
      let errorText: string;
      try {
        errorText = await response.text();
      } catch (readErr) {
        const msg = redactErrorStrings((readErr as { message?: string })?.message, [secretAtStart]);
        // `is_retryable: false` — the response arrived, so retrying the same
        // request is unlikely to self-heal a persistent body-stream failure.
        // Tagging retryable would risk upstream retry-storms on TLS-MITM or
        // corporate-proxy truncation paths.
        throw annotateError(Object.assign(readErr as Error, { message: typeof msg === 'string' ? msg : String(msg) }), {
          category: 'network',
          http_status: response.status,
          is_retryable: false,
        });
      }

      if (FigmaAPI.RETRYABLE_CODES.has(response.status) && attempt < FigmaAPI.MAX_RETRIES) {
        const delay = FigmaAPI.computeBackoffDelay(attempt);
        logger.warn(
          { status: response.status, attempt, delay: Math.round(delay) },
          'Figma API transient error — retrying with backoff',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      const redactedBody = redactAndTruncateBody(errorText, [secretAtStart]);
      logger.error(
        { status: response.status, statusText: response.statusText, body: redactedBody },
        'Figma API request failed',
      );

      const figmaErr = extractFigmaErr(errorText);
      if (epochAtStart === this.tokenEpoch) {
        this.update403CircuitBreaker(response.status, figmaErr);
      }

      throw FigmaAPI.buildErrorFromResponse(response, errorText, endpoint, secretAtStart);
    }

    // Unreachable — every loop iteration exits via return/continue/throw.
    // This final throw exists so TS sees a total function and so the
    // invariant is explicit if future refactors break the loop contract.
    throw new HttpError(`Figma API error: max retries exceeded for ${endpoint}`, {
      status: 0,
      meta: { category: 'internal', is_retryable: false },
    });
  }

  /** Fast-fail if the client is disabled or missing a token. */
  private assertApiEnabled(): void {
    if (this.apiDisabled) {
      // Throw HttpError (not plain Error) so downstream type guards and the
      // err-serializer see uniform shape for auth failures. Status 0 denotes
      // "no request was sent" — the circuit breaker fired locally.
      throw new HttpError('Figma REST API disabled: invalid token (3 consecutive 403s)', {
        status: 0,
        meta: { category: 'auth', is_retryable: false },
      });
    }
    if (!this.accessToken) {
      throw new HttpError('Figma REST API token not configured', {
        status: 0,
        meta: { category: 'auth', is_retryable: false },
      });
    }
  }

  /**
   * Build request headers with the correct Figma auth scheme. OAuth tokens
   * (`figu_*`) use Authorization: Bearer; PATs use X-Figma-Token.
   */
  private buildRequestHeaders(options: RequestInit): {
    headers: Record<string, string>;
    isOAuthToken: boolean;
  } {
    const isOAuthToken = this.accessToken.startsWith(FIGMA_OAUTH_PREFIX);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };
    if (isOAuthToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    } else {
      headers['X-Figma-Token'] = this.accessToken;
    }
    return { headers, isOAuthToken };
  }

  /** Exponential backoff with jitter, capped at BACKOFF_MAX_MS. */
  private static computeBackoffDelay(attempt: number): number {
    const baseDelay = Math.min(FigmaAPI.BACKOFF_BASE_MS * 2 ** attempt, FigmaAPI.BACKOFF_MAX_MS);
    const jitter = Math.random() * FigmaAPI.BACKOFF_JITTER_MS;
    return baseDelay + jitter;
  }

  /**
   * Wrap `fetch()` to tag network-layer failures with a `network` category
   * for Axiom, redacting any token that leaked into the error message/stack
   * before logging. Non-network errors are tagged `internal`.
   */
  private async fetchWithNetworkTagging(
    url: string,
    options: RequestInit,
    headers: Record<string, string>,
    secretAtStart: string,
  ): Promise<Response> {
    try {
      return await fetch(url, { ...options, headers });
    } catch (err) {
      const networkCode = getConnectionErrorCode(err);
      const redactedMessage = redactErrorStrings((err as { message?: string })?.message, [secretAtStart]);
      if (networkCode) {
        logger.warn({ url, networkCode, errMessage: redactedMessage }, 'Figma API network error');
        throw annotateError(err, {
          category: 'network',
          network_code: networkCode,
          is_retryable: true,
        });
      }
      throw annotateError(err, { category: 'internal', is_retryable: false });
    }
  }

  /**
   * Increment the 403 circuit breaker on auth-invalidation errors so
   * rotated/expired/revoked tokens stop the app from hammering a dead
   * credential. Matches the `figmaErr` field (the parsed Figma `err`),
   * not arbitrary substring of the whole body, so the breaker reacts to
   * every phrasing Figma uses — not just the literal "Invalid token".
   */
  private update403CircuitBreaker(status: number, figmaErr: string | undefined): void {
    if (status === 403 && figmaErr && AUTH_INVALIDATION_ERRS.has(figmaErr)) {
      this.consecutive403Count++;
      if (this.consecutive403Count >= FigmaAPI.MAX_403_BEFORE_DISABLE) {
        this.apiDisabled = true;
        logger.warn('Figma REST API disabled: auth token invalidated (3 consecutive 403s)');
      }
    } else if (status !== 403) {
      this.consecutive403Count = 0;
    }
  }

  /**
   * Build a structured HttpError from a non-ok Response. Extracted so the
   * retry loop body stays readable and so the error-construction logic is
   * unit-testable in isolation.
   */
  private static buildErrorFromResponse(
    response: Response,
    errorText: string,
    endpoint: string,
    accessToken: string,
  ): HttpError {
    const figmaErr = extractFigmaErr(errorText);
    const responseBody = redactAndTruncateBody(errorText, [accessToken]);
    const responseHeaders = Object.fromEntries(response.headers);

    // Message prefix `Figma API error (<status>)` is load-bearing: existing
    // tests and tool callers parse it. For 403/404/429 we append the
    // actionable remediation hint so the agent can self-heal.
    let message: string;
    if (response.status === 403) {
      message = buildForbiddenMessage(endpoint, figmaErr);
    } else if (response.status === 404) {
      message = buildNotFoundMessage(endpoint, figmaErr);
    } else if (response.status === 429) {
      message = buildRateLimitMessage(endpoint, responseHeaders['retry-after']);
    } else {
      message = `Figma API error (${response.status}): ${responseBody}`;
    }

    return new HttpError(message, {
      status: response.status,
      responseBody,
      responseHeaders,
      figmaErr,
      meta: {
        category: httpStatusCategory(response.status),
        is_retryable: FigmaAPI.RETRYABLE_CODES.has(response.status),
      },
    });
  }

  /**
   * GET /v1/files/:file_key
   */
  async getFile(
    fileKey: string,
    options?: {
      version?: string;
      ids?: string[];
      depth?: number;
      geometry?: 'paths' | 'screen';
      plugin_data?: string;
      branch_data?: boolean;
    },
  ): Promise<any> {
    let endpoint = `/files/${fileKey}`;

    const params = new URLSearchParams();
    if (options?.version) params.append('version', options.version);
    if (options?.ids) params.append('ids', options.ids.join(','));
    if (options?.depth !== undefined) params.append('depth', options.depth.toString());
    if (options?.geometry) params.append('geometry', options.geometry);
    if (options?.plugin_data) params.append('plugin_data', options.plugin_data);
    if (options?.branch_data) params.append('branch_data', 'true');

    if (params.toString()) {
      endpoint += `?${params.toString()}`;
    }

    return this.request(endpoint);
  }

  /**
   * Resolve a branch key from a branch ID
   */
  async getBranchKey(fileKey: string, branchId?: string): Promise<string> {
    if (!branchId) {
      return fileKey;
    }

    try {
      logger.info({ fileKey, branchId }, 'Resolving branch key');
      const fileData = await this.getFile(fileKey, { branch_data: true });
      const branches = fileData.branches || [];

      const branch = branches.find((b: { key?: string; name?: string }) => b.key === branchId || b.name === branchId);

      if (branch?.key) {
        logger.info({ fileKey, branchId, branchKey: branch.key, branchName: branch.name }, 'Resolved branch key');
        return branch.key;
      }

      if (/^[a-zA-Z0-9]+$/.test(branchId)) {
        logger.info({ fileKey, branchId }, 'Branch ID appears to be a key, using directly');
        return branchId;
      }

      logger.warn(
        {
          fileKey,
          branchId,
          availableBranches: branches.map((b: { key?: string; name?: string }) => ({ key: b.key, name: b.name })),
        },
        'Branch not found in file, using main file key',
      );
      return fileKey;
    } catch (error) {
      logger.error({ error, fileKey, branchId }, 'Failed to resolve branch key, using main file key');
      return fileKey;
    }
  }

  /**
   * GET /v1/files/:file_key/variables/local
   */
  async getLocalVariables(fileKey: string): Promise<any> {
    const response = await this.request(`/files/${fileKey}/variables/local`);
    return response.meta || response;
  }

  /**
   * GET /v1/files/:file_key/variables/published
   */
  async getPublishedVariables(fileKey: string): Promise<any> {
    const response = await this.request(`/files/${fileKey}/variables/published`);
    return response.meta || response;
  }

  /**
   * GET /v1/files/:file_key/nodes
   */
  async getNodes(
    fileKey: string,
    nodeIds: string[],
    options?: {
      version?: string;
      depth?: number;
      geometry?: 'paths' | 'screen';
      plugin_data?: string;
      /**
       * Policy for nodes that resolve to `null` in the 200 response (valid-
       * format ID that doesn't exist in the file).
       * - `'tolerate'` (default): return the partial response unchanged. Used
       *   by `getComponentData` and tools that render mixed-validity siblings.
       * - `'throw'`: raise `HttpError(404)` listing the missing IDs. Opt in
       *   when the caller cannot meaningfully proceed with a partial result.
       *
       * String union (not boolean) so future states like `'warn'` or
       * `'partial'` are additive instead of breaking.
       */
      missingNodePolicy?: 'tolerate' | 'throw';
    },
  ): Promise<any> {
    let endpoint = `/files/${fileKey}/nodes`;

    const params = new URLSearchParams();
    params.append('ids', nodeIds.join(','));
    if (options?.version) params.append('version', options.version);
    if (options?.depth !== undefined) params.append('depth', options.depth.toString());
    if (options?.geometry) params.append('geometry', options.geometry);
    if (options?.plugin_data) params.append('plugin_data', options.plugin_data);

    endpoint += `?${params.toString()}`;

    const response = await this.request(endpoint);

    if (options?.missingNodePolicy === 'throw' && response && typeof response === 'object' && response.nodes) {
      const nodesMap = response.nodes as Record<string, unknown>;
      // Use `hasOwn` + explicit `=== null` so "key absent" and "key present
      // with null value" aren't conflated; in practice Figma always returns
      // the key, but the distinction keeps the error message truthful.
      const missing = nodeIds.filter((id) => !Object.hasOwn(nodesMap, id) || nodesMap[id] === null);
      if (missing.length > 0) {
        throw new HttpError(buildMissingNodeMessage(fileKey, missing), {
          status: 404,
          meta: {
            category: 'not_found',
            is_retryable: false,
          },
        });
      }
    }

    return response;
  }

  /**
   * GET /v1/files/:file_key/styles
   */
  async getStyles(fileKey: string): Promise<any> {
    return this.request(`/files/${fileKey}/styles`);
  }

  /**
   * GET /v1/files/:file_key/components
   */
  async getComponents(fileKey: string): Promise<any> {
    return this.request(`/files/${fileKey}/components`);
  }

  /**
   * GET /v1/files/:file_key/component_sets
   */
  async getComponentSets(fileKey: string): Promise<any> {
    return this.request(`/files/${fileKey}/component_sets`);
  }

  /**
   * GET /v1/images/:file_key
   */
  async getImages(
    fileKey: string,
    nodeIds: string | string[],
    options?: {
      scale?: number;
      format?: 'png' | 'jpg' | 'svg' | 'pdf';
      svg_outline_text?: boolean;
      svg_include_id?: boolean;
      svg_include_node_id?: boolean;
      svg_simplify_stroke?: boolean;
      contents_only?: boolean;
    },
  ): Promise<{ images: Record<string, string | null> }> {
    const params = new URLSearchParams();

    const ids = Array.isArray(nodeIds) ? nodeIds.join(',') : nodeIds;
    params.append('ids', ids);

    if (options?.scale !== undefined) params.append('scale', options.scale.toString());
    if (options?.format) params.append('format', options.format);
    if (options?.svg_outline_text !== undefined) params.append('svg_outline_text', options.svg_outline_text.toString());
    if (options?.svg_include_id !== undefined) params.append('svg_include_id', options.svg_include_id.toString());
    if (options?.svg_include_node_id !== undefined)
      params.append('svg_include_node_id', options.svg_include_node_id.toString());
    if (options?.svg_simplify_stroke !== undefined)
      params.append('svg_simplify_stroke', options.svg_simplify_stroke.toString());
    if (options?.contents_only !== undefined) params.append('contents_only', options.contents_only.toString());

    const endpoint = `/images/${fileKey}?${params.toString()}`;

    logger.info({ fileKey, ids, options }, 'Rendering images');

    return this.request(endpoint);
  }

  /**
   * GET /v1/files/:file_key/comments
   */
  async getComments(fileKey: string, options?: { as_md?: boolean }): Promise<any> {
    const params = new URLSearchParams();
    if (options?.as_md) params.set('as_md', 'true');
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/files/${fileKey}/comments${query}`);
  }

  /**
   * POST /v1/files/:file_key/comments
   */
  async postComment(
    fileKey: string,
    message: string,
    clientMeta?: { node_id?: string; node_offset?: { x: number; y: number } },
    commentId?: string,
  ): Promise<any> {
    return this.request(`/files/${fileKey}/comments`, {
      method: 'POST',
      body: JSON.stringify({
        message,
        ...(clientMeta && { client_meta: clientMeta }),
        ...(commentId && { comment_id: commentId }),
      }),
    });
  }

  /**
   * DELETE /v1/files/:file_key/comments/:comment_id
   */
  async deleteComment(fileKey: string, commentId: string): Promise<any> {
    return this.request(`/files/${fileKey}/comments/${commentId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Helper: Get all design tokens (variables) with formatted output
   */
  async getAllVariables(fileKey: string): Promise<{
    local: any;
    published: any;
    localError?: string;
    publishedError?: string;
  }> {
    const [localResult, publishedResult] = await Promise.all([
      this.getLocalVariables(fileKey).catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { error: errorMsg, variables: {}, variableCollections: {} };
      }),
      this.getPublishedVariables(fileKey).catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return { error: errorMsg, variables: {} };
      }),
    ]);

    return {
      local: 'error' in localResult ? { meta: { variables: {}, variableCollections: {} } } : localResult,
      published: 'error' in publishedResult ? { variables: {} } : publishedResult,
      ...('error' in localResult && { localError: localResult.error }),
      ...('error' in publishedResult && { publishedError: publishedResult.error }),
    };
  }

  /**
   * Helper: Get component metadata with properties
   */
  async getComponentData(fileKey: string, nodeId: string): Promise<any> {
    const response = await this.getNodes(fileKey, [nodeId], { depth: 2 });
    return response.nodes?.[nodeId];
  }

  /**
   * Helper: Search for components by name
   */
  async searchComponents(fileKey: string, searchTerm: string): Promise<any[]> {
    const { meta } = await this.getComponents(fileKey);
    const components = meta?.components || [];

    return components.filter((comp: any) => comp.name?.toLowerCase().includes(searchTerm.toLowerCase()));
  }

  /**
   * GET /v1/me — authenticated user identity.
   */
  async getMe(): Promise<FigmaUser> {
    return this.request('/me');
  }

  /**
   * GET /v1/files/:file_key/versions — file version history (paginated).
   */
  async getFileVersions(
    fileKey: string,
    options?: { page_size?: number; before?: number; after?: number },
  ): Promise<FigmaVersionsResponse> {
    const params = new URLSearchParams();
    if (options?.page_size !== undefined) params.set('page_size', String(options.page_size));
    if (options?.before !== undefined) params.set('before', String(options.before));
    if (options?.after !== undefined) params.set('after', String(options.after));
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/files/${fileKey}/versions${query}`);
  }

  /**
   * GET /v1/files/:file_key/dev_resources — Dev Mode resource links on a file.
   */
  async getDevResources(fileKey: string, nodeIds?: string[]): Promise<FigmaDevResourcesResponse> {
    const params = new URLSearchParams();
    if (nodeIds && nodeIds.length > 0) params.set('node_ids', nodeIds.join(','));
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/files/${fileKey}/dev_resources${query}`);
  }
}

/**
 * Helper function to format variables for display
 */
export function formatVariables(variablesData: any): {
  collections: any[];
  variables: any[];
  summary: {
    totalCollections: number;
    totalVariables: number;
    variablesByType: Record<string, number>;
  };
} {
  const collections = Object.entries(variablesData.variableCollections || {}).map(
    ([id, collection]: [string, any]) => ({
      id,
      name: collection.name,
      key: collection.key,
      modes: collection.modes,
      variableIds: collection.variableIds,
    }),
  );

  const variables = Object.entries(variablesData.variables || {}).map(([id, variable]: [string, any]) => ({
    id,
    name: variable.name,
    key: variable.key,
    resolvedType: variable.resolvedType,
    valuesByMode: variable.valuesByMode,
    variableCollectionId: variable.variableCollectionId,
    scopes: variable.scopes,
    description: variable.description,
  }));

  const variablesByType = variables.reduce(
    (acc, v) => {
      acc[v.resolvedType] = (acc[v.resolvedType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return {
    collections,
    variables,
    summary: {
      totalCollections: collections.length,
      totalVariables: variables.length,
      variablesByType,
    },
  };
}

/**
 * Helper function to format component data for display
 */
export function formatComponentData(componentNode: any): {
  id: string;
  name: string;
  type: string;
  description?: string;
  descriptionMarkdown?: string;
  properties?: any;
  children?: any[];
  bounds?: any;
  fills?: any[];
  strokes?: any[];
  effects?: any[];
} {
  return {
    id: componentNode.id,
    name: componentNode.name,
    type: componentNode.type,
    description: componentNode.description,
    descriptionMarkdown: componentNode.descriptionMarkdown,
    properties: componentNode.componentPropertyDefinitions,
    children: componentNode.children?.map((child: any) => ({
      id: child.id,
      name: child.name,
      type: child.type,
    })),
    bounds: componentNode.absoluteBoundingBox,
    fills: componentNode.fills,
    strokes: componentNode.strokes,
    effects: componentNode.effects,
  };
}
