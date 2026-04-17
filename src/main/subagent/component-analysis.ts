/**
 * Component analysis — pure functions for detecting duplication and componentization opportunities.
 * Zero I/O: operates on parsed file_data strings and library component name lists.
 */

import {
  computeFingerprint,
  computeRelaxedFingerprint,
  type ParsedNode,
  parseFileData,
  tokenizeName,
  tokenSimilarity,
} from './component-analysis-parser.js';
import type {
  ComponentAnalysis,
  ComponentStats,
  CrossScreenMatch,
  DetachedInstance,
  LibraryMiss,
  WithinScreenDuplicates,
} from './types.js';

// ── Detection Functions ──────────────────────────────────────────────

/** Get top-level frames (screens) from parsed nodes. */
function getScreens(nodes: ParsedNode[]): ParsedNode[] {
  // Top-level FRAME or SECTION nodes are screens
  return nodes.filter((n) => n.type === 'FRAME' || n.type === 'SECTION');
}

/**
 * Check if a group of node names are semantically similar enough to be a
 * componentization candidate. Used for relaxed-fingerprint matches where
 * structure is similar but we want to avoid flagging semantically distinct
 * elements (e.g., Nav/Header + Footer/Top + Hero/CTARow all share
 * FRAME:2children:[FRAME,TEXT] but serve different purposes).
 *
 * Uses only the LAST path segment for similarity to avoid shared-page-prefix
 * false positives (e.g., "Landing/Hero" + "Landing/Features" + "Landing/Footer"
 * are not duplicates just because they share "Landing").
 *
 * Returns true if MAJORITY of pairs (>=50%) score similarity >= 0.5.
 * This catches "Card 1" + "Card 2" (similarity 1.0) or
 * "PizzaCard/Margherita" + "PizzaCard/Pepperoni" (shared "card" token in last segment).
 */
function haveSimilarNames(names: string[]): boolean {
  if (names.length < 2) return false;
  // Extract last path segment — "Landing/Hero/CTARow" → "CTARow"
  const lastSegments = names.map((n) => {
    const parts = n.split('/');
    return parts[parts.length - 1]?.trim() ?? n;
  });
  const tokens = lastSegments.map((n) => tokenizeName(n));
  let matches = 0;
  let total = 0;
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      total++;
      if (tokenSimilarity(tokens[i]!, tokens[j]!) >= 0.5) matches++;
    }
  }
  // Require majority of pairs to match — single shared token isn't enough
  return total > 0 && matches / total >= 0.5;
}

/**
 * Collect subtrees that are meaningful component candidates.
 * minChildren=2: a frame with just 1 child (button with text) is too simple.
 * Also requires structural depth — the node must have at least one child
 * with its own children (grandchildren exist), ensuring the subtree has
 * meaningful internal structure worth componentizing.
 */
function collectSubtrees(node: ParsedNode, minChildren = 2): ParsedNode[] {
  const result: ParsedNode[] = [];
  function walk(n: ParsedNode) {
    if (n.children.length >= minChildren) {
      // Structural depth check: at least one child must have children of its own.
      // This filters out shallow patterns like FRAME>[TEXT,TEXT] (a label pair)
      // while keeping real structures like FRAME>[IMAGE, FRAME>[TEXT,TEXT]] (a card).
      const hasGrandchildren = n.children.some((c) => c.children.length > 0);
      if (hasGrandchildren) {
        result.push(n);
      }
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

/**
 * Build a parent→children map for ancestor dedup.
 * Returns a Map from parent name to set of descendant names.
 */
function buildAncestorMap(node: ParsedNode): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  function walk(n: ParsedNode, ancestors: string[]) {
    for (const ancestor of ancestors) {
      let set = map.get(ancestor);
      if (!set) {
        set = new Set();
        map.set(ancestor, set);
      }
      set.add(n.name);
    }
    for (const child of n.children) {
      walk(child, [...ancestors, n.name]);
    }
  }
  for (const child of node.children) {
    walk(child, []);
  }
  return map;
}

/** Detect duplicate subtrees within a single screen. */
function detectWithinScreen(screens: ParsedNode[]): WithinScreenDuplicates[] {
  const rawResults: WithinScreenDuplicates[] = [];

  for (const screen of screens) {
    const subtrees = collectSubtrees(screen);
    const ancestorMap = buildAncestorMap(screen);

    // Two-pass detection: strict fingerprint first, then relaxed for near-matches.
    // Each bucket stores { name, id } tuples to enable precise retry hints.
    interface Entry {
      name: string;
      id: string;
    }
    const strictFps = new Map<string, Entry[]>();
    const relaxedFps = new Map<string, Entry[]>();
    const reportedNames = new Set<string>();

    for (const sub of subtrees) {
      // Skip INSTANCE nodes — already componentized
      if (sub.type === 'INSTANCE') continue;

      const entry: Entry = { name: sub.name, id: sub.id ?? '' };

      const strictFp = computeFingerprint(sub, 3);
      const existing = strictFps.get(strictFp);
      if (existing) {
        existing.push(entry);
      } else {
        strictFps.set(strictFp, [entry]);
      }

      const relaxedFp = computeRelaxedFingerprint(sub);
      const existingRelaxed = relaxedFps.get(relaxedFp);
      if (existingRelaxed) {
        existingRelaxed.push(entry);
      } else {
        relaxedFps.set(relaxedFp, [entry]);
      }
    }

    // Strict matches: threshold 2+
    for (const [fp, entries] of strictFps) {
      if (entries.length >= 2) {
        rawResults.push({
          screenName: screen.name,
          fingerprint: fp,
          nodeNames: entries.map((e) => e.name),
          nodeIds: entries.map((e) => e.id).filter(Boolean),
          count: entries.length,
        });
        for (const e of entries) reportedNames.add(e.name);
      }
    }

    // Relaxed matches: threshold 3+ (higher bar for fuzzy match), skip already-reported.
    // Also require name similarity across the group — prevents flagging semantically
    // distinct elements (Nav/Header + Footer/Top + Hero/CTARow) that share structure
    // but serve different purposes.
    for (const [fp, entries] of relaxedFps) {
      const unreported = entries.filter((e) => !reportedNames.has(e.name));
      if (unreported.length >= 3 && haveSimilarNames(unreported.map((e) => e.name))) {
        rawResults.push({
          screenName: screen.name,
          fingerprint: `~${fp}`,
          nodeNames: unreported.map((e) => e.name),
          nodeIds: unreported.map((e) => e.id).filter(Boolean),
          count: unreported.length,
        });
      }
    }

    // ── Ancestor dedup ────────────────────────────────────────────────
    // If all nodes in group B are descendants of nodes in group A, group B
    // is noise (inner frames of duplicated cards). Remove it.
    // Sort by fingerprint length descending — longer fingerprints are more
    // specific (higher-level structures). Keep the most specific groups.
    const screenResults = rawResults.filter((r) => r.screenName === screen.name);
    const sorted = [...screenResults].sort((a, b) => b.fingerprint.length - a.fingerprint.length);
    const ancestorGroupNames = new Set<string>();

    for (const group of sorted) {
      // Check if ALL names in this group are descendants of already-kept groups
      const allAreDescendants = group.nodeNames.every((name) => {
        for (const ancestor of ancestorGroupNames) {
          const descendants = ancestorMap.get(ancestor);
          if (descendants?.has(name)) return true;
        }
        return false;
      });

      if (allAreDescendants) {
        // Remove this group from rawResults — it's a subset of a bigger match
        const idx = rawResults.indexOf(group);
        if (idx >= 0) rawResults.splice(idx, 1);
      } else {
        // Keep this group and register its names as ancestors
        for (const name of group.nodeNames) {
          ancestorGroupNames.add(name);
        }
      }
    }
  }

  return rawResults;
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
      // Only flag "Component/Property=Value" pattern (variant syntax).
      // Skip semantic naming like "PizzaCard/Margherita" or "Nav/Header" —
      // the system prompt encourages PascalCase/slash naming.
      if (last.includes('=')) {
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
export function analyzeComponents(
  fileDataRaw: string,
  libraryComponentNames: string[],
  targetNodeId?: string,
): ComponentAnalysis {
  const nodes = parseFileData(fileDataRaw);
  const allScreens = getScreens(nodes);

  // When a target node is specified, scope within-screen detection to the
  // relevant subtree — not the entire page. This prevents pre-existing
  // content from polluting the analysis with false positives.
  //
  // Scoping strategy:
  // 1. Find the target node in the tree
  // 2. If target is a container (2+ children) → analyze its children for duplicates
  // 3. If target is a leaf/simple → analyze siblings (parent's children)
  // 4. Fallback: the screen containing the target
  const focusedScreens = targetNodeId ? findScopeForTarget(allScreens, targetNodeId) : allScreens;

  return {
    withinScreen: detectWithinScreen(focusedScreens),
    crossScreen: detectCrossScreen(allScreens), // cross-screen uses all screens
    libraryMisses: detectLibraryMisses(focusedScreens, libraryComponentNames),
    detachedInstances: detectDetachedInstances(focusedScreens),
    stats: computeStats(allScreens),
  };
}

/**
 * Find the narrowest scope for componentization analysis around a target node.
 * Returns a pseudo-screen array for `detectWithinScreen` to analyze.
 *
 * Strategy:
 * - If the target is a container (2+ children), treat IT as the scope
 *   (look for duplicates among its children — e.g., "Menu Grid" with 4 cards)
 * - If the target is a leaf or simple node, treat its PARENT as the scope
 *   (look for duplicates among siblings — e.g., "Card 1" among other cards)
 * - Fallback: the entire screen containing the target
 */
function findScopeForTarget(screens: ParsedNode[], targetNodeId: string): ParsedNode[] {
  for (const screen of screens) {
    const result = findNodeAndParent(screen, targetNodeId, null);
    if (result) {
      const { node, parent } = result;

      // Check if target is a container of repeated elements (e.g., "Menu Grid"
      // with multiple card children that share structure). This is different from
      // a card that happens to have 2+ children (image + body).
      if (node.children.length >= 3) {
        // 3+ children suggest a grid/list container — analyze its children
        return [node];
      }

      // Target is likely a repeated element itself (e.g., "Card 1") or a
      // simple node. Analyze siblings via the parent container.
      if (parent && parent.children.length >= 2) {
        return [parent];
      }

      // Fallback: the entire screen
      return [screen];
    }
  }
  // Target not found — return all screens (no scoping)
  return screens;
}

/** Walk tree to find a node and its parent by ID. */
function findNodeAndParent(
  node: ParsedNode,
  targetId: string,
  parent: ParsedNode | null,
): { node: ParsedNode; parent: ParsedNode | null } | null {
  if (node.id === targetId) return { node, parent };
  for (const child of node.children) {
    const found = findNodeAndParent(child, targetId, node);
    if (found) return found;
  }
  return null;
}
