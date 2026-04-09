/**
 * Figma REST API Client
 * Handles HTTP calls to Figma's REST API for file data, variables, components, and styles
 */

import { createChildLogger } from './logger.js';

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
  private static readonly MAX_403_BEFORE_DISABLE = 3;
  /** W-002: Transient HTTP codes eligible for retry with backoff. */
  private static readonly RETRYABLE_CODES = new Set([429, 500, 502, 503]);
  private static readonly MAX_RETRIES = 2;
  private static readonly BACKOFF_BASE_MS = 1_000;
  private static readonly BACKOFF_MAX_MS = 10_000;
  private static readonly BACKOFF_JITTER_MS = 500;
  private static readonly VALIDATE_TIMEOUT_MS = 10_000;

  constructor(accessToken?: string) {
    this.accessToken = accessToken || '';
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
    this.accessToken = token || '';
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
    if (this.apiDisabled) {
      throw new Error('Figma REST API disabled: invalid token (3 consecutive 403s)');
    }
    if (!this.accessToken) {
      // Fast-fail: previously we'd proceed with an empty `X-Figma-Token` header
      // and wait for 3 fresh 403s before disabling. After a Clear token click,
      // in-flight tools must stop immediately — not waste 3 round-trips.
      throw new Error('Figma REST API token not configured');
    }

    const url = `${FIGMA_API_BASE}${endpoint}`;
    const isOAuthToken = this.accessToken.startsWith('figu_');

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (isOAuthToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    } else {
      headers['X-Figma-Token'] = this.accessToken;
    }

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

      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (response.ok) {
        // Reset 403 counter on success
        this.consecutive403Count = 0;
        return await response.json();
      }

      const errorText = await response.text();

      // W-002: Retry transient errors with exponential backoff + jitter
      if (FigmaAPI.RETRYABLE_CODES.has(response.status) && attempt < FigmaAPI.MAX_RETRIES) {
        const baseDelay = Math.min(FigmaAPI.BACKOFF_BASE_MS * 2 ** attempt, FigmaAPI.BACKOFF_MAX_MS);
        const jitter = Math.random() * FigmaAPI.BACKOFF_JITTER_MS;
        const delay = baseDelay + jitter;
        logger.warn(
          { status: response.status, attempt, delay: Math.round(delay) },
          'Figma API transient error — retrying with backoff',
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Non-retryable or exhausted retries — log and throw
      logger.error(
        { status: response.status, statusText: response.statusText, body: errorText },
        'Figma API request failed',
      );

      // Only count 403s that indicate a genuinely invalid token (not file-level permission errors)
      if (response.status === 403 && errorText.includes('Invalid token')) {
        this.consecutive403Count++;
        if (this.consecutive403Count >= FigmaAPI.MAX_403_BEFORE_DISABLE) {
          this.apiDisabled = true;
          logger.warn('Figma REST API disabled: invalid token (3 consecutive 403s)');
        }
      } else if (response.status !== 403) {
        this.consecutive403Count = 0;
      }

      throw new Error(`Figma API error (${response.status}): ${errorText}`);
    }

    // Should not be reached, but satisfies TypeScript
    throw new Error(`Figma API error: max retries exceeded for ${endpoint}`);
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

    return this.request(endpoint);
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
