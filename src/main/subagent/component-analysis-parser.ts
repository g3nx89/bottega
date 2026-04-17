/**
 * Component analysis — parsing, tokenization, and fingerprinting primitives.
 * Pure functions used by component-analysis.ts for duplication detection.
 */

// ── Name Tokenizer ───────────────────────────────────────────────────

const DESIGN_ABBREVIATIONS: Record<string, string> = {
  btn: 'button',
  nav: 'navigation',
  img: 'image',
  bg: 'background',
  txt: 'text',
  hdr: 'header',
  ftr: 'footer',
  cta: 'calltoaction',
  ico: 'icon',
  lbl: 'label',
  desc: 'description',
  pg: 'page',
  sect: 'section',
  col: 'column',
  dlg: 'dialog',
  mod: 'modal',
  tb: 'toolbar',
  sb: 'sidebar',
  acc: 'accordion',
  chk: 'checkbox',
};

/** Split a name into semantic tokens, expanding abbreviations and stripping numeric suffixes. */
export function tokenizeName(name: string): Set<string> {
  // Remove numeric suffixes like "Card 1", "Frame 23"
  const cleaned = name.replace(/\s+\d+$/g, '');

  // Split on separators (-, _, /, space) and camelCase boundaries
  const parts = cleaned
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[-_/\s]+/)
    .map((p) => p.toLowerCase())
    .filter((p) => p.length > 0);

  const tokens = new Set<string>();
  for (const part of parts) {
    const expanded = DESIGN_ABBREVIATIONS[part];
    tokens.add(expanded ?? part);
  }
  return tokens;
}

/** Jaccard similarity between two token sets: |A∩B| / |A∪B|. */
export function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;

  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ── Structural Fingerprinting ────────────────────────────────────────

export interface ParsedNode {
  id?: string;
  type: string;
  name: string;
  children: ParsedNode[];
  properties?: Record<string, unknown>;
}

/**
 * Compute a structural fingerprint for a node subtree.
 * Encodes type and children recursively up to maxDepth.
 * Example: "FRAME>[TEXT,FRAME>[IMAGE],TEXT]"
 */
export function computeFingerprint(node: ParsedNode, maxDepth = 3): string {
  if (maxDepth <= 0 || node.children.length === 0) {
    return node.type;
  }
  const childFingerprints = node.children
    .map((c) => computeFingerprint(c, maxDepth - 1))
    .sort()
    .join(',');
  return `${node.type}>[${childFingerprints}]`;
}

/**
 * Compute a relaxed fingerprint — type + child count + sorted child types.
 * Useful for fuzzy matching when exact structure differs slightly.
 */
export function computeRelaxedFingerprint(node: ParsedNode): string {
  if (node.children.length === 0) return node.type;
  const childTypes = node.children
    .map((c) => c.type)
    .sort()
    .join(',');
  return `${node.type}:${node.children.length}children:[${childTypes}]`;
}

// ── File Data Parsing ────────────────────────────────────────────────

/**
 * Parse file_data full-mode output into a tree of ParsedNodes.
 * The format is a JSON string with nested nodes.
 */
export function parseFileData(raw: string): ParsedNode[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(toNode).filter(Boolean) as ParsedNode[];
    }
    if (parsed && typeof parsed === 'object') {
      // figma_get_file_data returns { nodes: [...], globalVars: ... }
      if (Array.isArray(parsed.nodes)) {
        return parsed.nodes.map(toNode).filter(Boolean) as ParsedNode[];
      }
      if (Array.isArray(parsed.children)) {
        return parsed.children.map(toNode).filter(Boolean) as ParsedNode[];
      }
      const node = toNode(parsed);
      return node ? [node] : [];
    }
  } catch {
    // Not JSON — try line-based text parsing
    return parseTextFileData(raw);
  }
  return [];
}

function toNode(raw: any): ParsedNode | null {
  if (!raw || typeof raw !== 'object') return null;
  const type = raw.type ?? raw.nodeType ?? 'UNKNOWN';
  const name = raw.name ?? '';
  const children = Array.isArray(raw.children) ? (raw.children.map(toNode).filter(Boolean) as ParsedNode[]) : [];
  const properties = raw.properties ?? raw.props ?? undefined;
  const id = raw.id ? String(raw.id) : undefined;
  return { id, type: String(type), name: String(name), children, properties };
}

/**
 * Fallback parser for text-based file_data format.
 * Extracts node type and name from indented text lines.
 */
function parseTextFileData(raw: string): ParsedNode[] {
  const lines = raw.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [];

  const root: ParsedNode[] = [];
  const stack: Array<{ node: ParsedNode; indent: number }> = [];

  for (const line of lines) {
    const match = line.match(/^(\s*)([\w_]+)\s*(?:"([^"]*)")?/);
    if (!match) continue;

    const indent = match[1]!.length;
    const type = match[2]!;
    const name = match[3] ?? '';
    const node: ParsedNode = { type, name, children: [] };

    // Pop stack to find parent
    while (stack.length > 0 && stack[stack.length - 1]!.indent >= indent) {
      stack.pop();
    }

    if (stack.length === 0) {
      root.push(node);
    } else {
      stack[stack.length - 1]!.node.children.push(node);
    }
    stack.push({ node, indent });
  }

  return root;
}
