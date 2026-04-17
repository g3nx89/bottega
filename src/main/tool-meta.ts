/**
 * Tool metadata — blast radius, restorability, mutation flag.
 *
 * Pi SDK's ToolDefinition interface is strict (no custom fields allowed).
 * Metadata lives in a side map derived from the existing CATEGORY_MAP in
 * compression/metrics.ts. Consumers: guardrails (what to intercept),
 * rewind (what to snapshot/restore), future audit UI.
 */

import { categorizeToolName, type ToolCategory } from './compression/metrics.js';

export type BlastRadius = 'low' | 'medium' | 'high';

export interface ToolMeta {
  category: ToolCategory;
  mutation: boolean;
  /** false → cannot be undone via inverse-op. Currently only figma_execute. */
  restorable: boolean;
  blastRadius: BlastRadius;
}

const OVERRIDES: Partial<Record<string, Partial<ToolMeta>>> = {
  figma_execute: { restorable: false, blastRadius: 'high' },
  figma_delete: { blastRadius: 'medium' },
  figma_batch_transform: { blastRadius: 'medium' },
  figma_batch_set_text: { blastRadius: 'medium' },
  figma_batch_set_fills: { blastRadius: 'medium' },
  figma_clone: { blastRadius: 'low' },
  figma_setup_tokens: { blastRadius: 'high' },
  figma_bind_variable: { blastRadius: 'medium' },
  figma_update_ds_page: { blastRadius: 'medium' },
};

export function getToolMeta(toolName: string): ToolMeta {
  const category = categorizeToolName(toolName);
  const baseMutation = category === 'mutation' || category === 'execute' || category === 'ds';
  const base: ToolMeta = {
    category,
    mutation: baseMutation,
    restorable: baseMutation && category !== 'execute',
    blastRadius: baseMutation ? 'medium' : 'low',
  };
  return { ...base, ...OVERRIDES[toolName] };
}

export function isMutation(toolName: string): boolean {
  return getToolMeta(toolName).mutation;
}

export function isRestorable(toolName: string): boolean {
  return getToolMeta(toolName).restorable;
}
