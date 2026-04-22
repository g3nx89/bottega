import type { IFigmaConnector, NodeDataField } from '../../../figma/figma-connector.js';
import { ensureObject } from './util.js';

const MAX_SUBTREE_DEPTH = 3;
const MAX_CHILDREN_PER_LEVEL = 200;

type SubtreeNode = Record<string, unknown> & {
  children?: SubtreeNode[];
  truncated?: boolean;
};

function summarizeNode(value: unknown): SubtreeNode {
  const node = ensureObject(value);
  return {
    id: typeof node.id === 'string' ? node.id : '',
    type: typeof node.type === 'string' ? node.type : 'UNKNOWN',
    name: typeof node.name === 'string' ? node.name : '',
    truncated: true,
  };
}

function normalizeChildren(value: unknown, depth: number): { children: SubtreeNode[]; truncated: boolean } {
  if (!Array.isArray(value)) return { children: [], truncated: false };
  const limited = value.slice(0, MAX_CHILDREN_PER_LEVEL);
  const children =
    depth >= MAX_SUBTREE_DEPTH
      ? limited.map((child) => summarizeNode(child))
      : limited.map((child) => normalizeNode(child, depth + 1));
  return {
    children,
    truncated: value.length > MAX_CHILDREN_PER_LEVEL || depth >= MAX_SUBTREE_DEPTH,
  };
}

function normalizeNode(value: unknown, depth: number): SubtreeNode {
  const node = ensureObject(value);
  const normalized: SubtreeNode = {
    id: typeof node.id === 'string' ? node.id : '',
    type: typeof node.type === 'string' ? node.type : 'UNKNOWN',
    name: typeof node.name === 'string' ? node.name : '',
    fills: Array.isArray(node.fills) ? node.fills : [],
    strokes: Array.isArray(node.strokes) ? node.strokes : [],
    position: ensureObject(node.position),
    size: ensureObject(node.size),
    layoutSizing: ensureObject(node.layoutSizing),
    constraints: ensureObject(node.constraints),
    opacity: typeof node.opacity === 'number' ? node.opacity : null,
    cornerRadius: typeof node.cornerRadius === 'number' ? node.cornerRadius : null,
    parent: node.parent === null ? null : ensureObject(node.parent),
  };

  const { children, truncated } = normalizeChildren(node.children, depth);
  normalized.children = children;
  if (truncated) normalized.truncated = true;
  return normalized;
}

export async function captureSubtreePreState(
  connector: IFigmaConnector,
  nodeId: string,
  _fields: NodeDataField[] = [],
): Promise<Record<string, unknown>> {
  const raw = await connector.getNodeData(nodeId);
  return { subtree: normalizeNode(raw, 0) };
}
