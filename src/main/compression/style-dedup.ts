/**
 * Style deduplication for semantic extraction.
 *
 * Patterns after Framelink's findOrCreateVar: identical visual values across nodes
 * are stored once in globalVars and referenced by ID. Post-processing inlines values
 * that appear only once (no point referencing a singleton).
 */

import type { ExtractionContext, GlobalVars, SemanticNode } from './semantic-modes.js';

// ── Random ID ──────────────────────────────────

const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomId(len: number): string {
  let result = '';
  for (let i = 0; i < len; i++) {
    result += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return result;
}

// ── Core dedup ─────────────────────────────────

/** Find an existing globalVars entry for `value`, or create one with a generated key. */
export function findOrCreateVar(context: ExtractionContext, value: unknown, prefix: string): string {
  const key = JSON.stringify(value);
  const existing = context.styleCache.get(key);
  if (existing) return existing;

  const varId = `${prefix}_${randomId(6)}`;
  context.globalVars.styles[varId] = value;
  context.styleCache.set(key, varId);
  return varId;
}

/** Use a named Figma style as the globalVars key (e.g., 'Primary/Blue'). */
export function findOrCreateNamedVar(context: ExtractionContext, value: unknown, styleName: string): string {
  if (styleName in context.globalVars.styles) return styleName;
  context.globalVars.styles[styleName] = value;
  context.styleCache.set(JSON.stringify(value), styleName);
  return styleName;
}

// ── Post-processing: inline singles ────────────

const REF_FIELDS: (keyof SemanticNode)[] = ['fills', 'strokes', 'effects', 'textStyle'];

function countReferencesInNode(node: SemanticNode, counts: Map<string, number>): void {
  for (const field of REF_FIELDS) {
    const val = node[field];
    if (typeof val === 'string' && counts.has(val)) {
      counts.set(val, (counts.get(val) ?? 0) + 1);
    }
  }
  if (node.children) {
    for (const child of node.children) {
      countReferencesInNode(child, counts);
    }
  }
}

function countReferences(nodes: SemanticNode[], globalVars: GlobalVars): Map<string, number> {
  const counts = new Map<string, number>();
  for (const varId of Object.keys(globalVars.styles)) {
    counts.set(varId, 0);
  }
  for (const node of nodes) {
    countReferencesInNode(node, counts);
  }
  return counts;
}

function replaceRefInNode(node: SemanticNode, varId: string, value: unknown): void {
  for (const field of REF_FIELDS) {
    if (node[field] === varId) {
      (node as any)[field] = value;
    }
  }
  if (node.children) {
    for (const child of node.children) {
      replaceRefInNode(child, varId, value);
    }
  }
}

/** Inline globalVars entries referenced only once — they don't benefit from dedup.
 *  Named Figma style refs (style:*) are never inlined — they carry semantic meaning even when used once. */
export function inlineSingles(nodes: SemanticNode[], globalVars: GlobalVars): void {
  const refCounts = countReferences(nodes, globalVars);
  refCounts.forEach((count, varId) => {
    if (varId.startsWith('style:')) return; // preserve named style bindings
    if (count <= 1) {
      const value = globalVars.styles[varId];
      for (const node of nodes) {
        replaceRefInNode(node, varId, value);
      }
      delete globalVars.styles[varId];
    }
  });
}
