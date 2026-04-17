/**
 * Built-in guardrail rules.
 *
 * Each rule is a pure async function `(toolName, input, ctx) => RuleMatch | null`.
 * Rules are evaluated A→B→C→D in order; the first match wins (short-circuit).
 *
 * Rule B (main-ds-component) is the only one that hits the WS connector to
 * fetch node metadata. A tiny node-info cache (30s TTL) mitigates latency
 * across consecutive tool calls in the same turn. When the connector is
 * unavailable or the probe throws, rule B falls through silently (fail-open)
 * so a disconnected bridge never blocks the agent via rule B alone — rules
 * A/C/D remain active since they only need the tool input.
 */

import type { IFigmaConnector } from '../../figma/figma-connector.js';
import { createChildLogger } from '../../figma/logger.js';
import { LruTtlCache } from '../lru-ttl-cache.js';
import { extractTargetNodeIds } from '../mutation-tracker.js';
import type { RuleId, RuleMatch } from './types.js';

const log = createChildLogger({ component: 'guardrails-rules' });

const BULK_DELETE_THRESHOLD = 5;
const NODE_INFO_TTL_MS = 30_000;
const NODE_INFO_PROBE_TIMEOUT_MS = 2_500;
/** Cap Rule B lookups per evaluation to avoid unbounded per-call latency. */
const NODE_INFO_MAX_PROBES_PER_EVAL = 3;
/** Hard cap on the per-process node-info cache to bound memory across long sessions. */
const NODE_INFO_CACHE_MAX_ENTRIES = 500;

// ─── Node info cache (module-level, shared across extension-factory calls) ──

interface NodeInfo {
  type: string;
  name: string;
  pageName: string | null;
}

/** `null` value = probed but node not found; kept cached to avoid re-probing bad ids. */
const nodeInfoCache = new LruTtlCache<string, NodeInfo | null>({
  maxEntries: NODE_INFO_CACHE_MAX_ENTRIES,
  defaultTtlMs: NODE_INFO_TTL_MS,
});

function cacheKey(fileKey: string, nodeId: string): string {
  return `${fileKey}::${nodeId}`;
}

async function probeNodeInfo(
  connector: IFigmaConnector,
  fileKey: string,
  nodeId: string,
): Promise<{ info: NodeInfo | null; failed: boolean }> {
  const k = cacheKey(fileKey, nodeId);
  if (nodeInfoCache.has(k)) {
    return { info: nodeInfoCache.get(k) ?? null, failed: false };
  }

  try {
    const code = `
      const node = await figma.getNodeByIdAsync(${JSON.stringify(nodeId)});
      if (!node) return null;
      let page = node;
      while (page && page.type !== 'PAGE' && page.parent) page = page.parent;
      return { type: node.type, name: node.name || '', pageName: page && page.type === 'PAGE' ? page.name : null };
    `;
    const raw = await connector.executeCodeViaUI(code, NODE_INFO_PROBE_TIMEOUT_MS);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const info: NodeInfo | null =
      parsed && typeof parsed === 'object' && typeof parsed.type === 'string'
        ? { type: parsed.type, name: String(parsed.name ?? ''), pageName: parsed.pageName ?? null }
        : null;
    nodeInfoCache.set(k, info);
    return { info, failed: false };
  } catch (err) {
    log.debug({ err, fileKey, nodeId }, 'guardrails node-info probe failed (rule B soft-skip)');
    // Cache the failure briefly to avoid hammering the bridge on a bad node.
    nodeInfoCache.set(k, null);
    return { info: null, failed: true };
  }
}

export interface EvaluateCtx {
  connector: IFigmaConnector | null;
  fileKey: string;
  /** Optional callback invoked when Rule B's node-info probe fails (WS/bridge error).
   *  Lets the extension factory distinguish probe-failure from genuine no-match. */
  onProbeFailed?: () => void;
}

// ─── Rule implementations ───────────────────────────────────────────────────

/** Rule A: deleting more than BULK_DELETE_THRESHOLD nodes in one call. */
function matchBulkDelete(toolName: string, input: Record<string, unknown>): RuleMatch | null {
  if (toolName === 'figma_delete') {
    const ids = Array.isArray(input.nodeIds) ? input.nodeIds : [];
    if (ids.length > BULK_DELETE_THRESHOLD) {
      return {
        ruleId: 'bulk-delete',
        description: `Deleting ${ids.length} nodes (more than ${BULK_DELETE_THRESHOLD})`,
        toolName,
        affectedLabel: `${ids.length} nodes`,
        input,
      };
    }
  }
  if (toolName === 'figma_execute' && typeof input.code === 'string') {
    const code = input.code;
    // Two or more .remove() calls OR deleteMany invocation.
    const removeCount = (code.match(/\.remove\s*\(\s*\)/g) || []).length;
    const hasDeleteMany = /\bdeleteMany\s*\(/.test(code);
    if (removeCount >= 2 || hasDeleteMany) {
      const label = hasDeleteMany ? 'deleteMany()' : `${removeCount} remove() calls`;
      return {
        ruleId: 'bulk-delete',
        description: `Bulk node removal via figma_execute (${label})`,
        toolName,
        affectedLabel: label,
        input,
      };
    }
  }
  return null;
}

/** Rule C: variable/token deletion via figma_execute. Stronger than bulk-delete so we try it first for execute. */
function matchVariableDelete(toolName: string, input: Record<string, unknown>): RuleMatch | null {
  if (toolName !== 'figma_execute' || typeof input.code !== 'string') return null;
  const code = input.code;
  // Match figma.variables.deleteLocalVariable(...), .removeVariable(..., and variable.remove(
  const patterns: RegExp[] = [
    /\b(?:delete|remove)(?:Local)?Variable\s*\(/,
    /\bvariable\.remove\s*\(/,
    /\bdeleteVariableCollection\s*\(/,
  ];
  for (const re of patterns) {
    if (re.test(code)) {
      return {
        ruleId: 'variable-delete-via-execute',
        description: 'Deleting design token/variable via figma_execute',
        toolName,
        affectedLabel: 'variable/token',
        input,
        // Irreversible: give the user longer to read/decide than the default 10s.
        confirmTimeoutMs: 25_000,
      };
    }
  }
  return null;
}

/**
 * Rule D: detachInstance() call in figma_execute. The pattern matches a method
 * call whose left-hand name is exactly `detachInstance` — the leading negative
 * class avoids false positives on identifiers that happen to end in the word
 * (e.g. `somethingDetachInstance()`).
 */
function matchDetachInstance(toolName: string, input: Record<string, unknown>): RuleMatch | null {
  if (toolName !== 'figma_execute' || typeof input.code !== 'string') return null;
  if (/(?:^|[^A-Za-z0-9_$])detachInstance\s*\(/.test(input.code)) {
    return {
      ruleId: 'detach-main-instance',
      description: 'Detaching instance from main component',
      toolName,
      affectedLabel: 'instance',
      input,
    };
  }
  return null;
}

/** Rule B: mutation targeting a main DS component or a node on a Design System page. */
async function matchMainDsComponent(
  toolName: string,
  input: Record<string, unknown>,
  ctx: EvaluateCtx,
): Promise<RuleMatch | null> {
  // Caller (extension-factory) already gated on isMutation(); no re-check here.
  if (!ctx.connector) return null;
  const ids = extractTargetNodeIds(toolName, input);
  if (ids.length === 0) return null;

  const probeIds = ids.slice(0, NODE_INFO_MAX_PROBES_PER_EVAL);
  for (const id of probeIds) {
    const { info, failed } = await probeNodeInfo(ctx.connector, ctx.fileKey, id);
    if (failed) ctx.onProbeFailed?.();
    if (!info) continue;
    const isComponent = info.type === 'COMPONENT' || info.type === 'COMPONENT_SET';
    const onDsPage = info.pageName != null && /design\s*system/i.test(info.pageName);
    if (isComponent || onDsPage) {
      const where = onDsPage ? `${info.pageName} / ${info.name}` : info.name;
      return {
        ruleId: 'main-ds-component',
        description: `Mutating ${isComponent ? 'main component' : 'DS-page node'} ${info.name}`,
        toolName,
        affectedLabel: where,
        input,
      };
    }
  }
  return null;
}

// ─── Evaluation entry point ────────────────────────────────────────────────

type RuleMatcher = (
  toolName: string,
  input: Record<string, unknown>,
  ctx: EvaluateCtx,
) => RuleMatch | null | Promise<RuleMatch | null>;

/**
 * Rule evaluation order — single source of truth. Sync rules come first so the
 * happy path avoids an `await` hop; the async WS-probe rule (main-ds-component)
 * runs last. More-specific execute-only rules (variable, detach) precede the
 * broader bulk-delete so figma_execute with deleteVariable+remove shows the
 * more actionable rule first.
 */
const RULES: ReadonlyArray<readonly [RuleId, RuleMatcher]> = [
  ['variable-delete-via-execute', matchVariableDelete],
  ['detach-main-instance', matchDetachInstance],
  ['bulk-delete', matchBulkDelete],
  ['main-ds-component', matchMainDsComponent],
];

export const RULE_ORDER: readonly RuleId[] = RULES.map(([id]) => id);

export async function evaluateRules(
  toolName: string,
  input: Record<string, unknown>,
  ctx: EvaluateCtx,
): Promise<RuleMatch | null> {
  for (const [, matcher] of RULES) {
    const match = await matcher(toolName, input, ctx);
    if (match) return match;
  }
  return null;
}

// ─── Test helpers ──────────────────────────────────────────────────────────

/** Clear the node-info cache (test-only). */
export function __clearNodeInfoCacheForTests(): void {
  nodeInfoCache.clear();
}

/** Current cache size (test-only). */
export function __nodeInfoCacheSizeForTests(): number {
  return nodeInfoCache.size;
}
