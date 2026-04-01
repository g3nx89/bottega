/**
 * Mutation result compressor.
 *
 * Compresses success results from mutation tools from ~200 tokens
 * down to ~10 tokens (e.g. "OK node=123:456").
 *
 * Returns null for non-mutation tools, error results, and parse failures
 * so the caller can pass the original result through unchanged.
 */

import { CATEGORY_MAP } from './metrics.js';

/** Derived from the single source of truth in CATEGORY_MAP (metrics.ts). */
export const MUTATION_TOOLS = new Set(
  Object.entries(CATEGORY_MAP)
    .filter(([, cat]) => cat === 'mutation')
    .map(([name]) => name),
);

export function isMutationTool(name: string): boolean {
  return MUTATION_TOOLS.has(name);
}

/**
 * Attempt to compress a mutation tool result to a short acknowledgement.
 *
 * @returns compressed `{ content }` object, or null if no compression applies.
 */
export function compressMutationResult(toolName: string, content: any[], isError: boolean): { content: any[] } | null {
  if (!MUTATION_TOOLS.has(toolName)) return null;
  if (isError) return null;
  if (!content || content.length === 0) return null;

  const raw = content[0]?.text;
  if (typeof raw !== 'string') return null;

  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }

  // Batch operations — special shape: updated/total counts, no single nodeId
  if (toolName.startsWith('figma_batch_')) {
    const updated = data?.updated ?? data?.results?.filter((r: any) => r.success).length ?? 0;
    const total = data?.total ?? 0;
    return { content: [{ type: 'text', text: `OK batch=${updated}/${total}` }] };
  }

  // figma_setup_tokens — special shape: no nodeId, has collectionId + variables
  if (toolName === 'figma_setup_tokens') {
    const collectionId: string | undefined = data?.collectionId;
    if (!collectionId) return null;
    const varCount: number = Array.isArray(data?.variables) ? data.variables.length : 0;
    return { content: [{ type: 'text', text: `OK collection=${collectionId} vars=${varCount}` }] };
  }

  // figma_render_jsx — nodeId + optional childIds
  if (toolName === 'figma_render_jsx') {
    const nodeId: string | undefined = data?.node?.id ?? data?.nodeId ?? data?.deleted?.id ?? data?.success?.nodeId;
    if (!nodeId) return null;
    const childIds: string[] | undefined = Array.isArray(data?.childIds) ? data.childIds : undefined;
    const childPart = childIds && childIds.length > 0 ? ` children=${childIds.join(',')}` : '';
    return { content: [{ type: 'text', text: `OK node=${nodeId}${childPart}` }] };
  }

  // figma_delete — uses deleted.id
  if (toolName === 'figma_delete') {
    const nodeId: string | undefined = data?.deleted?.id ?? data?.node?.id ?? data?.nodeId ?? data?.success?.nodeId;
    if (!nodeId) return null;
    return { content: [{ type: 'text', text: `OK deleted=${nodeId}` }] };
  }

  // All other standard mutations
  const nodeId: string | undefined =
    data?.node?.id ?? data?.nodeId ?? data?.instance?.id ?? data?.deleted?.id ?? data?.success?.nodeId;
  if (!nodeId) return null;

  return { content: [{ type: 'text', text: `OK node=${nodeId}` }] };
}
