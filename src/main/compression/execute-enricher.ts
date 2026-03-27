/**
 * Enriches figma_execute tool results by extracting node IDs and prepending
 * them as a summary. The full result is always preserved — no truncation.
 */

const NODE_ID_RE = /"(\d+:\d+)"/g;

export function enrichExecuteResult(content: any[]): { content: any[]; extractedIds: string[] } | null {
  const text = content[0]?.text;
  if (typeof text !== 'string' || text.length === 0) {
    return null;
  }

  const ids = new Set<string>();
  for (const match of text.matchAll(NODE_ID_RE)) {
    ids.add(match[1]!);
  }

  if (ids.size === 0) {
    return null;
  }

  const extractedIds = [...ids];
  const prefixed = `Returned IDs: ${extractedIds.join(', ')}\n${text}`;

  return {
    content: [{ type: 'text', text: prefixed }],
    extractedIds,
  };
}
