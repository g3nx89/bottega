/**
 * Shared helpers for extracting Figma node IDs from tool call inputs and
 * tool result contents. Extracted from session-events.ts so guardrails,
 * rewind and judge harness can share one code path.
 *
 * Pure functions — no side effects, no I/O, cheap to call per tool_call.
 */

const NODE_ID_IN_CODE = /getNodeByIdAsync\s*\(\s*["'](\d+:\d+)["']\s*\)/g;
const NODE_ID_IN_RESULT = /"(?:id|nodeId)"\s*:\s*"(\d+:\d+)"|(?:^|\s)node[=:](\d+:\d+)/gm;

/**
 * Pull node IDs from a mutation tool's input. Covers the three shapes used
 * across Bottega tools:
 *   - `nodeId: string`
 *   - `nodeIds: string[]`
 *   - `parentId: string`  (create-style tools — parent frame)
 *   - `code: string`      (figma_execute — scan for getNodeByIdAsync("N:M"))
 */
export function extractTargetNodeIds(_toolName: string, input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const obj = input as Record<string, unknown>;
  const out: string[] = [];
  if (typeof obj.nodeId === 'string' && obj.nodeId) out.push(obj.nodeId);
  if (Array.isArray(obj.nodeIds)) {
    for (const id of obj.nodeIds) if (typeof id === 'string' && id) out.push(id);
  }
  if (typeof obj.parentId === 'string' && obj.parentId) out.push(obj.parentId);
  if (typeof obj.code === 'string' && obj.code) {
    for (const match of obj.code.matchAll(NODE_ID_IN_CODE)) {
      if (match[1]) out.push(match[1]);
    }
  }
  return out;
}

/**
 * Pull freshly created node IDs out of a tool result's text content.
 * Create/clone/instantiate tools return `{id: "N:M"}` or `{nodeId: "N:M"}`
 * inside their JSON payload; figma_execute may log `node=N:M`. Deduped.
 */
export function extractCreatedNodeIds(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const c of content) {
    if (!c || typeof c !== 'object') continue;
    const entry = c as { type?: unknown; text?: unknown };
    if (entry.type !== 'text' || typeof entry.text !== 'string') continue;
    for (const match of entry.text.matchAll(NODE_ID_IN_RESULT)) {
      const id = match[1] ?? match[2];
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}
