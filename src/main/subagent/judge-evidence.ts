/**
 * Judge evidence pipeline — pre-computes numeric facts for 4 micro-judges.
 *
 * Design rationale: LLMs cannot reliably compare coordinates, font sizes, or
 * padding values by eye. The existing `componentization` judge works because
 * it interprets a pre-computed `ComponentAnalysis` report instead of raw file
 * data. This module generalizes that pattern to `alignment`, `visual_hierarchy`,
 * `consistency`, and `naming`.
 *
 * Split: (1) `buildEvidenceCode` returns a JS payload that runs inside the
 * Figma plugin and emits a flat `EvidenceNode[]`. (2) `computeJudgeEvidence`
 * is a pure function that takes that array and produces 4 typed reports. All
 * analyzers are pure/deterministic and unit-testable without a live connector.
 */

// ── Raw tree record ─────────────────────────────────────────────────────

/** One record per descendant of the target node. Emitted by the plugin payload. */
export interface EvidenceNode {
  id: string;
  name: string;
  type: string;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  layoutMode: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  itemSpacing: number;
  fontSize: number | null;
  fontStyle: string | null;
  fontFamily: string | null;
  cornerRadius: number | null;
  childCount: number;
}

// ── Analysis outputs ────────────────────────────────────────────────────

export interface AlignmentFinding {
  parentId: string;
  parentName: string;
  axis: 'x' | 'y';
  values: number[];
  maxDeviation: number;
  nodeIds: string[];
}

export interface AlignmentAnalysis {
  verdict: 'aligned' | 'misaligned' | 'insufficient_data';
  tolerancePx: 4;
  siblingGroupsChecked: number;
  findings: AlignmentFinding[];
}

export interface TypographyAnalysis {
  verdict: 'hierarchical' | 'flat' | 'insufficient_data';
  textCount: number;
  uniqueFontSizes: number[];
  uniqueFontStyles: string[];
  allSameStyle: boolean;
  samples: Array<{ id: string; name: string; fontSize: number; fontStyle: string }>;
}

export interface ConsistencyFinding {
  parentId: string;
  parentName: string;
  property: 'paddingTop' | 'paddingBottom' | 'paddingLeft' | 'paddingRight' | 'itemSpacing' | 'cornerRadius';
  values: number[];
  nodeIds: string[];
}

export interface ConsistencyAnalysis {
  verdict: 'consistent' | 'inconsistent' | 'insufficient_data';
  siblingGroupsChecked: number;
  findings: ConsistencyFinding[];
}

export interface NamingAnalysis {
  verdict: 'ok' | 'hasAutoNames' | 'insufficient_data';
  autoNamedFrames: Array<{ id: string; name: string }>;
  framesWithoutAutoLayout: Array<{ id: string; name: string; childCount: number }>;
}

export interface JudgeEvidence {
  alignment: AlignmentAnalysis;
  visual_hierarchy: TypographyAnalysis;
  consistency: ConsistencyAnalysis;
  naming: NamingAnalysis;
  targetNodeId: string;
  nodeCount: number;
}

// ── Plugin payload builder ──────────────────────────────────────────────

/**
 * Build a JS payload string that, when eval'd inside the Figma plugin, walks
 * the target node subtree and returns a flat `EvidenceNode[]`.
 *
 * Intentionally stupid: no analysis, no filtering, just raw numbers. All
 * logic lives in `computeJudgeEvidence` where it is testable.
 */
export function buildEvidenceCode(targetNodeId: string): string {
  // JSON.stringify handles all special characters (quotes, backslashes, unicode)
  // — safer than manual single-quote escaping.
  const idLiteral = JSON.stringify(targetNodeId);
  return `return (async () => {
  const root = await figma.getNodeByIdAsync(${idLiteral});
  if (!root) return [];
  var MAX = 2000;
  const out = [];
  const collect = (n) => {
    if (out.length >= MAX) return;
    const b = ('absoluteBoundingBox' in n) ? n.absoluteBoundingBox : null;
    const hasPad = 'paddingTop' in n;
    let fontSize = null, fontStyle = null, fontFamily = null;
    if (n.type === 'TEXT') {
      try { if (typeof n.fontSize === 'number') fontSize = n.fontSize; } catch (e) {}
      try {
        if (n.fontName && typeof n.fontName === 'object') {
          fontStyle = n.fontName.style || null;
          fontFamily = n.fontName.family || null;
        }
      } catch (e) {}
    }
    let cornerRadius = null;
    try { if ('cornerRadius' in n && typeof n.cornerRadius === 'number') cornerRadius = n.cornerRadius; } catch (e) {}
    out.push({
      id: n.id,
      name: n.name,
      type: n.type,
      parentId: n.parent ? n.parent.id : null,
      x: b ? b.x : 0,
      y: b ? b.y : 0,
      width: b ? b.width : 0,
      height: b ? b.height : 0,
      layoutMode: ('layoutMode' in n) ? n.layoutMode : 'NONE',
      paddingTop: hasPad ? (n.paddingTop || 0) : 0,
      paddingRight: hasPad ? (n.paddingRight || 0) : 0,
      paddingBottom: hasPad ? (n.paddingBottom || 0) : 0,
      paddingLeft: hasPad ? (n.paddingLeft || 0) : 0,
      itemSpacing: ('itemSpacing' in n) ? (n.itemSpacing || 0) : 0,
      fontSize: fontSize,
      fontStyle: fontStyle,
      fontFamily: fontFamily,
      cornerRadius: cornerRadius,
      childCount: ('children' in n && Array.isArray(n.children)) ? n.children.length : 0,
    });
    if ('children' in n && Array.isArray(n.children)) {
      for (const c of n.children) {
        if (out.length >= MAX) break;
        collect(c);
      }
    }
  };
  // Walk the target node and its subtree
  collect(root);
  // Also walk siblings of the target (same parent) so alignment/consistency
  // analyzers can compare peer elements. Skip page-level parents — top-level
  // frames on a page are independent designs, not siblings to compare.
  // Only walk siblings inside shared containers (FRAME, GROUP, SECTION, etc.).
  if (root.parent && root.parent.type !== 'PAGE' && 'children' in root.parent && Array.isArray(root.parent.children)) {
    for (const sib of root.parent.children) {
      if (sib.id === root.id) continue;
      if (out.length >= MAX) break;
      collect(sib);
    }
  }
  return out;
})()`;
}

// ── Constants ───────────────────────────────────────────────────────────

const ALIGNMENT_TOLERANCE_PX = 4;
const CONSISTENCY_TOLERANCE_PX = 1;
const MIN_SIBLINGS_FOR_ALIGNMENT = 3;
const MIN_SIBLINGS_FOR_CONSISTENCY = 3;
const MIN_TEXT_NODES_FOR_HIERARCHY = 2;
const MAX_TYPOGRAPHY_SAMPLES = 10;

/** Regex for auto-generated Figma names like "Frame 1", "Group 42". */
const AUTO_NAME_REGEX = /^(Frame|Group|Rectangle|Ellipse|Vector|Line|Polygon|Star|Component|Instance)\s+\d+$/;

/** Types that count as "structural containers" for naming / consistency checks. */
const STRUCTURAL_TYPES = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'GROUP']);

// ── Helpers ─────────────────────────────────────────────────────────────

/** Group nodes by parentId. Excludes the root (parentId of caller is ambiguous). */
function groupByParent(nodes: EvidenceNode[]): Map<string, EvidenceNode[]> {
  const groups = new Map<string, EvidenceNode[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    const existing = groups.get(n.parentId);
    if (existing) existing.push(n);
    else groups.set(n.parentId, [n]);
  }
  return groups;
}

/** Build a lookup map for O(1) node access by ID. */
function buildNodeMap(nodes: EvidenceNode[]): Map<string, EvidenceNode> {
  const map = new Map<string, EvidenceNode>();
  for (const n of nodes) map.set(n.id, n);
  return map;
}

// ── analyzeAlignment ────────────────────────────────────────────────────

/**
 * Flag sibling groups where coordinates deviate beyond the 4px tolerance.
 * Skips parents with auto-layout (layoutMode !== 'NONE') — those are trusted.
 * Requires at least 3 siblings to avoid false positives on pairs.
 */
export function analyzeAlignment(nodes: EvidenceNode[], nodeMap?: Map<string, EvidenceNode>): AlignmentAnalysis {
  const groups = groupByParent(nodes);
  const lookup = nodeMap ?? buildNodeMap(nodes);
  const findings: AlignmentFinding[] = [];
  let checked = 0;

  for (const [parentId, siblings] of groups) {
    if (siblings.length < MIN_SIBLINGS_FOR_ALIGNMENT) continue;
    const parent = lookup.get(parentId);
    // Auto-layout parents are trusted — count the group as checked AND aligned,
    // so the verdict is 'aligned' rather than 'insufficient_data' when the only
    // groups in the tree are auto-layout ones.
    checked++;
    if (parent && parent.layoutMode !== 'NONE') continue;

    const xs = siblings.map((s) => s.x);
    const ys = siblings.map((s) => s.y);
    const xDev = Math.max(...xs) - Math.min(...xs);
    const yDev = Math.max(...ys) - Math.min(...ys);
    // A well-aligned group is aligned on ONE axis (siblings in a row or column).
    // Horizontal row: all share y within tolerance. Vertical column: all share x.
    // If BOTH axes deviate, siblings are scattered → misaligned on the smaller-deviation axis.
    const rowAligned = yDev <= ALIGNMENT_TOLERANCE_PX;
    const colAligned = xDev <= ALIGNMENT_TOLERANCE_PX;
    if (rowAligned || colAligned) continue;

    // Report the axis with the smaller deviation — that's the one the user probably
    // intended to align, and the violation is more surprising there.
    const axis: 'x' | 'y' = xDev <= yDev ? 'x' : 'y';
    const values = axis === 'x' ? xs : ys;
    const deviation = axis === 'x' ? xDev : yDev;
    findings.push({
      parentId,
      parentName: parent?.name ?? '(unknown)',
      axis,
      values,
      maxDeviation: deviation,
      nodeIds: siblings.map((s) => s.id),
    });
  }

  let verdict: AlignmentAnalysis['verdict'];
  if (checked === 0) verdict = 'insufficient_data';
  else if (findings.length > 0) verdict = 'misaligned';
  else verdict = 'aligned';

  return { verdict, tolerancePx: 4, siblingGroupsChecked: checked, findings };
}

// ── analyzeTypography ───────────────────────────────────────────────────

/**
 * Detect "flat" typography — all text nodes share the same fontSize AND fontStyle.
 * This is a quality defect: a design with 2+ text nodes serving different roles
 * should establish hierarchy through size or weight contrast.
 */
export function analyzeTypography(nodes: EvidenceNode[]): TypographyAnalysis {
  const textNodes = nodes.filter((n) => n.type === 'TEXT' && n.fontSize != null);

  if (textNodes.length < MIN_TEXT_NODES_FOR_HIERARCHY) {
    return {
      verdict: 'insufficient_data',
      textCount: textNodes.length,
      uniqueFontSizes: [],
      uniqueFontStyles: [],
      allSameStyle: false,
      samples: [],
    };
  }

  const sizes = new Set<number>();
  const styles = new Set<string>();
  for (const n of textNodes) {
    if (n.fontSize != null) sizes.add(n.fontSize);
    if (n.fontStyle) styles.add(n.fontStyle);
  }
  // If styles is empty (all null), treat as a single "unknown" style — fall through
  // to the allSameStyle check based on size alone.
  const effectiveStyleCount = styles.size === 0 ? 1 : styles.size;
  const allSameStyle = sizes.size === 1 && effectiveStyleCount === 1;

  const samples = textNodes.slice(0, MAX_TYPOGRAPHY_SAMPLES).map((n) => ({
    id: n.id,
    name: n.name,
    fontSize: n.fontSize as number,
    fontStyle: n.fontStyle ?? '(unknown)',
  }));

  return {
    verdict: allSameStyle ? 'flat' : 'hierarchical',
    textCount: textNodes.length,
    uniqueFontSizes: [...sizes].sort((a, b) => a - b),
    uniqueFontStyles: [...styles].sort(),
    allSameStyle,
    samples,
  };
}

// ── analyzeConsistency ──────────────────────────────────────────────────

const CONSISTENCY_PROPERTIES: ConsistencyFinding['property'][] = [
  'paddingTop',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'itemSpacing',
  'cornerRadius',
];

/**
 * Flag sibling groups where frames of the same type have inconsistent padding,
 * gap, or corner radius. Requires at least 3 same-type siblings under one parent.
 */
export function analyzeConsistency(nodes: EvidenceNode[], nodeMap?: Map<string, EvidenceNode>): ConsistencyAnalysis {
  const groups = groupByParent(nodes);
  const lookup = nodeMap ?? buildNodeMap(nodes);
  const findings: ConsistencyFinding[] = [];
  let checked = 0;

  for (const [parentId, siblings] of groups) {
    const structural = siblings.filter((s) => STRUCTURAL_TYPES.has(s.type));
    if (structural.length < MIN_SIBLINGS_FOR_CONSISTENCY) continue;
    checked++;
    const parent = lookup.get(parentId);

    for (const prop of CONSISTENCY_PROPERTIES) {
      const rawValues = structural.map((s) => {
        const v = s[prop];
        return typeof v === 'number' ? v : null;
      });
      // Skip property if any sibling lacks it (e.g. cornerRadius null on some nodes)
      if (rawValues.some((v) => v === null)) continue;
      const values = rawValues as number[];
      // Apply tolerance to avoid false positives from rounding (e.g. 16 vs 17)
      const maxVal = Math.max(...values);
      const minVal = Math.min(...values);
      if (maxVal - minVal > CONSISTENCY_TOLERANCE_PX) {
        findings.push({
          parentId,
          parentName: parent?.name ?? '(unknown)',
          property: prop,
          values,
          nodeIds: structural.map((s) => s.id),
        });
      }
    }
  }

  let verdict: ConsistencyAnalysis['verdict'];
  if (checked === 0) verdict = 'insufficient_data';
  else if (findings.length > 0) verdict = 'inconsistent';
  else verdict = 'consistent';

  return { verdict, siblingGroupsChecked: checked, findings };
}

// ── analyzeNaming ───────────────────────────────────────────────────────

/**
 * Flag structural frames with auto-generated names AND frames with 3+ children
 * that lack auto-layout (missed layout opportunity).
 *
 * Leaf shapes like "Rectangle 3" inside a properly named parent are acceptable —
 * only top-level / container frames are checked.
 */
export function analyzeNaming(nodes: EvidenceNode[]): NamingAnalysis {
  const autoNamed: NamingAnalysis['autoNamedFrames'] = [];
  const missingAutoLayout: NamingAnalysis['framesWithoutAutoLayout'] = [];
  let checked = 0;

  for (const n of nodes) {
    if (!STRUCTURAL_TYPES.has(n.type)) continue;
    checked++;
    if (AUTO_NAME_REGEX.test(n.name)) {
      autoNamed.push({ id: n.id, name: n.name });
    }
    if (n.childCount >= 3 && n.layoutMode === 'NONE') {
      missingAutoLayout.push({ id: n.id, name: n.name, childCount: n.childCount });
    }
  }

  let verdict: NamingAnalysis['verdict'];
  if (checked === 0) verdict = 'insufficient_data';
  else if (autoNamed.length > 0 || missingAutoLayout.length > 0) verdict = 'hasAutoNames';
  else verdict = 'ok';

  return { verdict, autoNamedFrames: autoNamed, framesWithoutAutoLayout: missingAutoLayout };
}

// ── Dispatcher ──────────────────────────────────────────────────────────

/**
 * Collect all descendant node IDs of a given root in the tree.
 * Used to separate "target subtree" nodes from "sibling" nodes.
 */
function collectSubtreeIds(nodes: EvidenceNode[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId]);
  // BFS: add children whose parentId is already in the set.
  // Nodes are in tree-walk order (parent before children), so one pass suffices.
  for (const n of nodes) {
    if (n.parentId && ids.has(n.parentId)) ids.add(n.id);
  }
  return ids;
}

/** Run all 4 analyzers on a raw tree and return the combined report. */
export function computeJudgeEvidence(rawTree: EvidenceNode[], targetNodeId: string): JudgeEvidence {
  // Build the lookup map once and share it with analyzers that need parent lookups.
  const nodeMap = buildNodeMap(rawTree);

  // Split nodes into subtree (target + descendants) vs full (including siblings).
  // Typography and naming analyze the TARGET design only — mixing in unrelated
  // sibling designs would produce false hierarchical signals.
  // Alignment and consistency analyze ALL nodes including siblings — they need
  // peer elements to detect misalignment and inconsistency across the group.
  const subtreeIds = collectSubtreeIds(rawTree, targetNodeId);
  const subtreeNodes = rawTree.filter((n) => subtreeIds.has(n.id));

  return {
    alignment: analyzeAlignment(rawTree, nodeMap),
    visual_hierarchy: analyzeTypography(subtreeNodes),
    consistency: analyzeConsistency(rawTree, nodeMap),
    naming: analyzeNaming(subtreeNodes),
    targetNodeId,
    nodeCount: rawTree.length,
  };
}
