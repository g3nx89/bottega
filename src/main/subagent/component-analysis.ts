/**
 * Component analysis — pure functions for detecting duplication and componentization opportunities.
 * Zero I/O: operates on parsed file_data strings and library component name lists.
 */

import type {
  ComponentAnalysis,
  ComponentStats,
  CrossScreenMatch,
  DetachedInstance,
  LibraryMiss,
  WithinScreenDuplicates,
} from './types.js';

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

interface ParsedNode {
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
  return { type: String(type), name: String(name), children, properties };
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

// ── Detection Functions ──────────────────────────────────────────────

/** Get top-level frames (screens) from parsed nodes. */
function getScreens(nodes: ParsedNode[]): ParsedNode[] {
  // Top-level FRAME or SECTION nodes are screens
  return nodes.filter((n) => n.type === 'FRAME' || n.type === 'SECTION');
}

/** Collect all subtrees at a given depth from a node. */
function collectSubtrees(node: ParsedNode, minChildren = 1): ParsedNode[] {
  const result: ParsedNode[] = [];
  function walk(n: ParsedNode) {
    if (n.children.length >= minChildren) {
      result.push(n);
    }
    for (const child of n.children) {
      walk(child);
    }
  }
  for (const child of node.children) {
    walk(child);
  }
  return result;
}

/** Detect duplicate subtrees within a single screen. */
function detectWithinScreen(screens: ParsedNode[]): WithinScreenDuplicates[] {
  const results: WithinScreenDuplicates[] = [];

  for (const screen of screens) {
    const subtrees = collectSubtrees(screen);
    const fingerprints = new Map<string, string[]>();

    for (const sub of subtrees) {
      // Skip INSTANCE nodes — already componentized
      if (sub.type === 'INSTANCE') continue;

      const fp = computeFingerprint(sub, 3);
      const existing = fingerprints.get(fp);
      if (existing) {
        existing.push(sub.name);
      } else {
        fingerprints.set(fp, [sub.name]);
      }
    }

    for (const [fp, names] of fingerprints) {
      if (names.length >= 3) {
        results.push({
          screenName: screen.name,
          fingerprint: fp,
          nodeNames: names,
          count: names.length,
        });
      }
    }
  }

  return results;
}

/** Detect cross-screen structural or name matches. */
function detectCrossScreen(screens: ParsedNode[]): CrossScreenMatch[] {
  if (screens.length < 2) return [];

  // Collect depth-1 candidates per screen
  interface Candidate {
    screenName: string;
    nodeName: string;
    fingerprint: string;
    relaxedFingerprint: string;
    tokens: Set<string>;
  }

  const candidates: Candidate[] = [];
  for (const screen of screens) {
    for (const child of screen.children) {
      if (child.type === 'INSTANCE') continue;
      if (child.children.length === 0) continue;

      candidates.push({
        screenName: screen.name,
        nodeName: child.name,
        fingerprint: computeFingerprint(child, 3),
        relaxedFingerprint: computeRelaxedFingerprint(child),
        tokens: tokenizeName(child.name),
      });
    }
  }

  const matches: CrossScreenMatch[] = [];
  const seen = new Set<string>();

  // Strategy A: group by fingerprint (structural match)
  const byFingerprint = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const group = byFingerprint.get(c.fingerprint);
    if (group) {
      group.push(c);
    } else {
      byFingerprint.set(c.fingerprint, [c]);
    }
  }

  for (const [fp, group] of byFingerprint) {
    // Must span at least 2 different screens
    const screenSet = new Set(group.map((c) => c.screenName));
    if (screenSet.size < 2) continue;

    // Check if names also match
    const hasNameMatch = group.some((a, i) =>
      group.some((b, j) => i < j && tokenSimilarity(a.tokens, b.tokens) >= 0.5),
    );

    const key = `struct:${fp}`;
    if (seen.has(key)) continue;
    seen.add(key);

    matches.push({
      fingerprint: fp,
      screens: group.map((c) => ({ screenName: c.screenName, nodeName: c.nodeName })),
      confidence: hasNameMatch ? 'HIGH' : 'MEDIUM',
      matchType: hasNameMatch ? 'struct+name' : 'struct_only',
    });
  }

  // Strategy B: group by tokenized name (name match)
  for (let i = 0; i < candidates.length; i++) {
    const a = candidates[i]!;
    for (let j = i + 1; j < candidates.length; j++) {
      const b = candidates[j]!;
      if (a.screenName === b.screenName) continue;

      const nameSim = tokenSimilarity(a.tokens, b.tokens);
      if (nameSim < 0.5) continue;

      // Skip if already matched by structure
      if (a.fingerprint === b.fingerprint) continue;

      const key = `name:${[a.nodeName, b.nodeName].sort().join('|')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Check relaxed fingerprint
      const relaxedMatch = a.relaxedFingerprint === b.relaxedFingerprint;

      matches.push({
        fingerprint: a.fingerprint,
        screens: [
          { screenName: a.screenName, nodeName: a.nodeName },
          { screenName: b.screenName, nodeName: b.nodeName },
        ],
        confidence: relaxedMatch ? 'MEDIUM' : 'LOW',
        matchType: relaxedMatch ? 'name+relaxed' : 'name_only',
      });
    }
  }

  return matches;
}

/** Detect FRAME nodes that match library component names but aren't instances. */
function detectLibraryMisses(screens: ParsedNode[], libraryComponentNames: string[]): LibraryMiss[] {
  const libraryTokens = libraryComponentNames.map((name) => ({
    name,
    tokens: tokenizeName(name),
  }));

  const results: LibraryMiss[] = [];

  function walkScreen(node: ParsedNode, screenName: string) {
    // Only flag FRAME nodes (INSTANCE are already componentized)
    if (node.type === 'FRAME' && node.children.length > 0) {
      const nodeTokens = tokenizeName(node.name);
      for (const lib of libraryTokens) {
        const sim = tokenSimilarity(nodeTokens, lib.tokens);
        if (sim >= 0.8) {
          results.push({
            nodeName: node.name,
            screenName,
            matchedComponentName: lib.name,
            similarity: sim,
          });
          break; // one match per node
        }
      }
    }
    for (const child of node.children) {
      walkScreen(child, screenName);
    }
  }

  for (const screen of screens) {
    walkScreen(screen, screen.name);
  }

  return results;
}

/**
 * Detect detached component instances — FRAME nodes whose name matches component patterns.
 * A slash in the name alone isn't enough (semantic naming like "Card/Body" is valid).
 * Look for names that match the "ComponentName/VariantValue" pattern AND have instance-like structure.
 */
function detectDetachedInstances(screens: ParsedNode[]): DetachedInstance[] {
  const results: DetachedInstance[] = [];

  function walk(node: ParsedNode, screenName: string) {
    // Heuristic: FRAME with "/" in name AND children (not a leaf) AND name starts with uppercase
    // after the last slash — suggests a component variant that was detached
    if (node.type === 'FRAME' && node.name.includes('/') && node.children.length > 0) {
      const parts = node.name.split('/');
      const last = parts[parts.length - 1]?.trim() ?? '';
      // Component variant pattern: "Component/Property=Value" or "Component/Variant"
      if (last.includes('=') || (parts.length >= 2 && /^[A-Z]/.test(parts[0]?.trim() ?? ''))) {
        results.push({ nodeName: node.name, screenName });
      }
    }
    for (const child of node.children) {
      walk(child, screenName);
    }
  }

  for (const screen of screens) {
    walk(screen, screen.name);
  }

  return results;
}

/** Compute component stats for the file. */
function computeStats(screens: ParsedNode[]): ComponentStats {
  let totalNodes = 0;
  let instanceCount = 0;

  function walk(node: ParsedNode) {
    totalNodes++;
    if (node.type === 'INSTANCE') instanceCount++;
    for (const child of node.children) {
      walk(child);
    }
  }

  for (const screen of screens) {
    walk(screen);
  }

  return {
    totalScreens: screens.length,
    totalNodes,
    instanceCount,
    componentizationRatio: totalNodes > 0 ? instanceCount / totalNodes : 0,
  };
}

// ── Entry Point ──────────────────────────────────────────────────────

/**
 * Analyze components in a Figma file for duplication and componentization opportunities.
 * Pure function — no I/O.
 */
export function analyzeComponents(fileDataRaw: string, libraryComponentNames: string[]): ComponentAnalysis {
  const nodes = parseFileData(fileDataRaw);
  const screens = getScreens(nodes);

  return {
    withinScreen: detectWithinScreen(screens),
    crossScreen: detectCrossScreen(screens),
    libraryMisses: detectLibraryMisses(screens, libraryComponentNames),
    detachedInstances: detectDetachedInstances(screens),
    stats: computeStats(screens),
  };
}
