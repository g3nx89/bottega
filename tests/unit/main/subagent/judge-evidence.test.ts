/**
 * Unit tests for the judge-evidence pipeline.
 *
 * All analyzers operate on `EvidenceNode[]` fixtures — no live connector,
 * no mocks. Each analyzer is tested with ≥1 positive, ≥1 negative, and ≥1
 * edge case (insufficient_data / below threshold).
 */

import { describe, expect, it } from 'vitest';
import {
  analyzeAlignment,
  analyzeConsistency,
  analyzeNaming,
  analyzeTypography,
  buildEvidenceCode,
  computeJudgeEvidence,
  type EvidenceNode,
} from '../../../../src/main/subagent/judge-evidence.js';
import { makeEvidenceNode as makeNode } from '../../../helpers/evidence-fixtures.js';

// ── Fixture helpers ─────────────────────────────────────────────────────

/** Parent frame + 3 children with customizable layout. */
function threeSiblings(opts: {
  parentLayoutMode?: EvidenceNode['layoutMode'];
  positions: Array<{ x?: number; y?: number }>;
  type?: string;
}): EvidenceNode[] {
  const parent = makeNode({
    id: '1:1',
    name: 'Parent',
    type: 'FRAME',
    layoutMode: opts.parentLayoutMode ?? 'NONE',
    childCount: 3,
  });
  const children = opts.positions.map((p, i) =>
    makeNode({
      id: `1:${i + 2}`,
      name: `Child ${i + 1}`,
      type: opts.type ?? 'RECTANGLE',
      parentId: '1:1',
      x: p.x ?? 0,
      y: p.y ?? 0,
    }),
  );
  return [parent, ...children];
}

// ── analyzeAlignment ────────────────────────────────────────────────────

describe('analyzeAlignment', () => {
  it('3 siblings y=[0,15,0] under NONE layoutMode → misaligned, maxDeviation=15', () => {
    const nodes = threeSiblings({
      positions: [
        { x: 0, y: 0 },
        { x: 100, y: 15 },
        { x: 200, y: 0 },
      ],
    });
    const result = analyzeAlignment(nodes);
    expect(result.verdict).toBe('misaligned');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.axis).toBe('y');
    expect(result.findings[0]!.maxDeviation).toBe(15);
    expect(result.findings[0]!.values).toEqual([0, 15, 0]);
    expect(result.findings[0]!.nodeIds).toEqual(['1:2', '1:3', '1:4']);
  });

  it('3 siblings under HORIZONTAL auto-layout → aligned (trust auto-layout)', () => {
    const nodes = threeSiblings({
      parentLayoutMode: 'HORIZONTAL',
      positions: [
        { x: 0, y: 0 },
        { x: 100, y: 50 }, // deliberately off, but auto-layout is trusted
        { x: 200, y: 0 },
      ],
    });
    const result = analyzeAlignment(nodes);
    expect(result.verdict).toBe('aligned');
    expect(result.findings).toHaveLength(0);
    // Auto-layout group IS counted as checked (trusted) so the verdict is
    // 'aligned' instead of 'insufficient_data'.
    expect(result.siblingGroupsChecked).toBe(1);
  });

  it('3 siblings y=[0,3,0] (within 4px tolerance) → aligned', () => {
    const nodes = threeSiblings({
      positions: [
        { x: 0, y: 0 },
        { x: 100, y: 3 },
        { x: 200, y: 0 },
      ],
    });
    const result = analyzeAlignment(nodes);
    expect(result.verdict).toBe('aligned');
    expect(result.siblingGroupsChecked).toBe(1);
  });

  it('2 siblings under NONE → insufficient_data (below threshold of 3)', () => {
    const parent = makeNode({ id: '1:1', name: 'Parent', childCount: 2 });
    const children = [
      makeNode({ id: '1:2', parentId: '1:1', x: 0, y: 0 }),
      makeNode({ id: '1:3', parentId: '1:1', x: 100, y: 50 }),
    ];
    const result = analyzeAlignment([parent, ...children]);
    expect(result.verdict).toBe('insufficient_data');
  });

  it('3 vertical-column siblings x=[0,0,0] y=[0,50,100] → aligned (column layout)', () => {
    const nodes = threeSiblings({
      positions: [
        { x: 0, y: 0 },
        { x: 0, y: 50 },
        { x: 0, y: 100 },
      ],
    });
    const result = analyzeAlignment(nodes);
    expect(result.verdict).toBe('aligned');
  });
});

// ── analyzeTypography ───────────────────────────────────────────────────

describe('analyzeTypography', () => {
  it('3 text nodes all 14/Regular → flat + allSameStyle=true', () => {
    const nodes = [
      makeNode({ id: '2:1', type: 'TEXT', name: 'Title', fontSize: 14, fontStyle: 'Regular' }),
      makeNode({ id: '2:2', type: 'TEXT', name: 'Body', fontSize: 14, fontStyle: 'Regular' }),
      makeNode({ id: '2:3', type: 'TEXT', name: 'Caption', fontSize: 14, fontStyle: 'Regular' }),
    ];
    const result = analyzeTypography(nodes);
    expect(result.verdict).toBe('flat');
    expect(result.allSameStyle).toBe(true);
    expect(result.textCount).toBe(3);
    expect(result.uniqueFontSizes).toEqual([14]);
    expect(result.samples).toHaveLength(3);
  });

  it('24/Bold + 14/Regular → hierarchical', () => {
    const nodes = [
      makeNode({ id: '2:1', type: 'TEXT', fontSize: 24, fontStyle: 'Bold' }),
      makeNode({ id: '2:2', type: 'TEXT', fontSize: 14, fontStyle: 'Regular' }),
    ];
    const result = analyzeTypography(nodes);
    expect(result.verdict).toBe('hierarchical');
    expect(result.allSameStyle).toBe(false);
    expect(result.uniqueFontSizes).toEqual([14, 24]);
    expect(result.uniqueFontStyles).toEqual(['Bold', 'Regular']);
  });

  it('2 text nodes both 14/Regular → flat (still catches the defect)', () => {
    const nodes = [
      makeNode({ id: '2:1', type: 'TEXT', fontSize: 14, fontStyle: 'Regular' }),
      makeNode({ id: '2:2', type: 'TEXT', fontSize: 14, fontStyle: 'Regular' }),
    ];
    const result = analyzeTypography(nodes);
    expect(result.verdict).toBe('flat');
  });

  it('1 text node → insufficient_data (hierarchy needs ≥2 texts)', () => {
    const result = analyzeTypography([makeNode({ type: 'TEXT', fontSize: 14, fontStyle: 'Regular' })]);
    expect(result.verdict).toBe('insufficient_data');
  });

  it('0 text nodes → insufficient_data', () => {
    const result = analyzeTypography([makeNode({ type: 'FRAME' }), makeNode({ type: 'RECTANGLE' })]);
    expect(result.verdict).toBe('insufficient_data');
  });

  it('samples array trimmed to first 10 nodes for large trees', () => {
    const nodes: EvidenceNode[] = [];
    for (let i = 0; i < 15; i++) {
      nodes.push(makeNode({ id: `2:${i}`, type: 'TEXT', fontSize: 14, fontStyle: 'Regular' }));
    }
    const result = analyzeTypography(nodes);
    expect(result.samples).toHaveLength(10);
    expect(result.textCount).toBe(15);
  });
});

// ── analyzeConsistency ──────────────────────────────────────────────────

describe('analyzeConsistency', () => {
  it('3 frame siblings paddingTop=[16,24,16] → inconsistent with finding on paddingTop', () => {
    const parent = makeNode({ id: '3:1', name: 'Cards Container', type: 'FRAME' });
    const cards = [
      makeNode({ id: '3:2', parentId: '3:1', type: 'FRAME', paddingTop: 16 }),
      makeNode({ id: '3:3', parentId: '3:1', type: 'FRAME', paddingTop: 24 }),
      makeNode({ id: '3:4', parentId: '3:1', type: 'FRAME', paddingTop: 16 }),
    ];
    const result = analyzeConsistency([parent, ...cards]);
    expect(result.verdict).toBe('inconsistent');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.property).toBe('paddingTop');
    expect(result.findings[0]!.values).toEqual([16, 24, 16]);
    expect(result.findings[0]!.nodeIds).toEqual(['3:2', '3:3', '3:4']);
  });

  it('3 frame siblings all paddingTop=16 → consistent', () => {
    const parent = makeNode({ id: '3:1', type: 'FRAME' });
    const cards = [1, 2, 3].map((i) => makeNode({ id: `3:${i + 1}`, parentId: '3:1', type: 'FRAME', paddingTop: 16 }));
    const result = analyzeConsistency([parent, ...cards]);
    expect(result.verdict).toBe('consistent');
    expect(result.findings).toHaveLength(0);
  });

  it('2 frame siblings → insufficient_data (below threshold of 3)', () => {
    const parent = makeNode({ id: '3:1', type: 'FRAME' });
    const cards = [
      makeNode({ id: '3:2', parentId: '3:1', type: 'FRAME', paddingTop: 16 }),
      makeNode({ id: '3:3', parentId: '3:1', type: 'FRAME', paddingTop: 24 }),
    ];
    const result = analyzeConsistency([parent, ...cards]);
    expect(result.verdict).toBe('insufficient_data');
  });

  it('cornerRadius=[8,8,12] across 3 siblings → inconsistent on cornerRadius', () => {
    const parent = makeNode({ id: '3:1', type: 'FRAME' });
    const cards = [
      makeNode({ id: '3:2', parentId: '3:1', type: 'FRAME', cornerRadius: 8 }),
      makeNode({ id: '3:3', parentId: '3:1', type: 'FRAME', cornerRadius: 8 }),
      makeNode({ id: '3:4', parentId: '3:1', type: 'FRAME', cornerRadius: 12 }),
    ];
    const result = analyzeConsistency([parent, ...cards]);
    expect(result.verdict).toBe('inconsistent');
    const radiusFinding = result.findings.find((f) => f.property === 'cornerRadius');
    expect(radiusFinding).toBeDefined();
    expect(radiusFinding?.values).toEqual([8, 8, 12]);
  });

  it('paddingTop=[16,17,16] within 1px tolerance → consistent (no false positive from rounding)', () => {
    const parent = makeNode({ id: '3:1', type: 'FRAME' });
    const cards = [
      makeNode({ id: '3:2', parentId: '3:1', type: 'FRAME', paddingTop: 16 }),
      makeNode({ id: '3:3', parentId: '3:1', type: 'FRAME', paddingTop: 17 }),
      makeNode({ id: '3:4', parentId: '3:1', type: 'FRAME', paddingTop: 16 }),
    ];
    const result = analyzeConsistency([parent, ...cards]);
    expect(result.verdict).toBe('consistent');
  });

  it('itemSpacing=[12,12,12] across 3 siblings → consistent on itemSpacing', () => {
    const parent = makeNode({ id: '3:1', type: 'FRAME' });
    const cards = [1, 2, 3].map((i) => makeNode({ id: `3:${i + 1}`, parentId: '3:1', type: 'FRAME', itemSpacing: 12 }));
    const result = analyzeConsistency([parent, ...cards]);
    expect(result.verdict).toBe('consistent');
  });

  it('different types (FRAME + TEXT) not compared', () => {
    const parent = makeNode({ id: '3:1', type: 'FRAME' });
    const mixed = [
      makeNode({ id: '3:2', parentId: '3:1', type: 'FRAME', paddingTop: 16 }),
      makeNode({ id: '3:3', parentId: '3:1', type: 'TEXT', paddingTop: 0 }),
      makeNode({ id: '3:4', parentId: '3:1', type: 'TEXT', paddingTop: 0 }),
    ];
    const result = analyzeConsistency([parent, ...mixed]);
    // Only 1 FRAME sibling → below threshold → insufficient_data
    expect(result.verdict).toBe('insufficient_data');
  });
});

// ── analyzeNaming ───────────────────────────────────────────────────────

describe('analyzeNaming', () => {
  it("frame named 'Frame 1' → hasAutoNames with the frame in autoNamedFrames", () => {
    const nodes = [makeNode({ id: '4:1', name: 'Frame 1', type: 'FRAME', childCount: 2 })];
    const result = analyzeNaming(nodes);
    expect(result.verdict).toBe('hasAutoNames');
    expect(result.autoNamedFrames).toHaveLength(1);
    expect(result.autoNamedFrames[0]!.name).toBe('Frame 1');
  });

  it("leaf 'Rectangle 3' (non-structural) inside named frame → ok (leaves acceptable)", () => {
    const nodes = [
      makeNode({ id: '4:1', name: 'Header', type: 'FRAME', childCount: 1 }),
      makeNode({ id: '4:2', name: 'Rectangle 3', type: 'RECTANGLE', parentId: '4:1' }),
    ];
    const result = analyzeNaming(nodes);
    expect(result.verdict).toBe('ok');
    expect(result.autoNamedFrames).toHaveLength(0);
  });

  it('frame with 4 children and layoutMode=NONE → framesWithoutAutoLayout non-empty', () => {
    const nodes = [
      makeNode({
        id: '4:1',
        name: 'Cards Grid',
        type: 'FRAME',
        layoutMode: 'NONE',
        childCount: 4,
      }),
    ];
    const result = analyzeNaming(nodes);
    expect(result.verdict).toBe('hasAutoNames');
    expect(result.framesWithoutAutoLayout).toHaveLength(1);
    expect(result.framesWithoutAutoLayout[0]!.childCount).toBe(4);
  });

  it('frame with 2 children and layoutMode=NONE → NOT flagged (below threshold)', () => {
    const nodes = [makeNode({ id: '4:1', name: 'Pair', type: 'FRAME', layoutMode: 'NONE', childCount: 2 })];
    const result = analyzeNaming(nodes);
    expect(result.verdict).toBe('ok');
    expect(result.framesWithoutAutoLayout).toHaveLength(0);
  });

  it('frame with HORIZONTAL auto-layout → NOT flagged', () => {
    const nodes = [
      makeNode({
        id: '4:1',
        name: 'Row',
        type: 'FRAME',
        layoutMode: 'HORIZONTAL',
        childCount: 5,
      }),
    ];
    const result = analyzeNaming(nodes);
    expect(result.verdict).toBe('ok');
  });

  it("'Group 7' frame flagged as auto-named", () => {
    const nodes = [makeNode({ id: '4:1', name: 'Group 7', type: 'FRAME' })];
    const result = analyzeNaming(nodes);
    expect(result.verdict).toBe('hasAutoNames');
    expect(result.autoNamedFrames[0]!.name).toBe('Group 7');
  });

  it('empty tree (no structural nodes) → insufficient_data', () => {
    const result = analyzeNaming([makeNode({ type: 'TEXT' }), makeNode({ type: 'RECTANGLE' })]);
    expect(result.verdict).toBe('insufficient_data');
  });
});

// ── computeJudgeEvidence dispatcher ─────────────────────────────────────

describe('computeJudgeEvidence', () => {
  it('populates all 4 analyses and preserves targetNodeId + nodeCount', () => {
    const nodes = threeSiblings({
      positions: [
        { x: 0, y: 0 },
        { x: 100, y: 15 },
        { x: 200, y: 0 },
      ],
    });
    const result = computeJudgeEvidence(nodes, '1:1');
    expect(result.targetNodeId).toBe('1:1');
    expect(result.nodeCount).toBe(nodes.length);
    expect(result.alignment.verdict).toBe('misaligned');
    expect(result.visual_hierarchy.verdict).toBe('insufficient_data');
    expect(result.naming.verdict).toBeDefined();
    expect(result.consistency.verdict).toBeDefined();
  });

  it('empty tree → all verdicts are insufficient_data', () => {
    const result = computeJudgeEvidence([], 'none');
    expect(result.alignment.verdict).toBe('insufficient_data');
    expect(result.visual_hierarchy.verdict).toBe('insufficient_data');
    expect(result.consistency.verdict).toBe('insufficient_data');
    expect(result.naming.verdict).toBe('insufficient_data');
    expect(result.nodeCount).toBe(0);
  });
});

// ── buildEvidenceCode structural sanity ─────────────────────────────────

describe('buildEvidenceCode', () => {
  it('returns a string containing the target node ID literal', () => {
    const code = buildEvidenceCode('1:42');
    // JSON.stringify wraps the ID in double quotes
    expect(code).toContain('"1:42"');
    expect(code).toContain('figma.getNodeByIdAsync');
  });

  it('wraps the walker in a return-prefixed async IIFE (code.js provides outer wrapper)', () => {
    const code = buildEvidenceCode('1:2');
    expect(code).toMatch(/^return \(async \(\) => \{/);
    expect(code).toMatch(/\}\)\(\)$/);
  });

  it('safely escapes special characters via JSON.stringify', () => {
    // JSON.stringify handles all injection vectors — quotes, backslashes, unicode
    const code = buildEvidenceCode('1:2"; evil();//');
    expect(code).not.toContain('1:2"; evil();//');
    // The ID is safely enclosed in JSON-escaped double quotes
    expect(code).toContain('figma.getNodeByIdAsync(');
    expect(code).toContain('\\"; evil()');
  });

  it('includes MAX_NODES cap to prevent plugin freeze on large trees', () => {
    const code = buildEvidenceCode('1:1');
    expect(code).toContain('MAX');
    expect(code).toContain('out.length >= MAX');
  });

  it('skips page-level parents to prevent cross-design contamination', () => {
    const code = buildEvidenceCode('1:1');
    expect(code).toContain("root.parent.type !== 'PAGE'");
  });
});

// ── Regression: computeJudgeEvidence subtree separation ─────────────

describe('computeJudgeEvidence — subtree separation', () => {
  it('typography analyzes only target subtree, not sibling nodes', () => {
    // Simulate a page with two designs: a flat card (target) and a hero with hierarchy
    const tree: EvidenceNode[] = [
      // Target: flat notification card
      makeNode({ id: '10:1', name: 'NotificationCard', type: 'FRAME', childCount: 3 }),
      makeNode({ id: '10:2', parentId: '10:1', type: 'TEXT', name: 'Title', fontSize: 14, fontStyle: 'Regular' }),
      makeNode({ id: '10:3', parentId: '10:1', type: 'TEXT', name: 'Body', fontSize: 14, fontStyle: 'Regular' }),
      makeNode({ id: '10:4', parentId: '10:1', type: 'TEXT', name: 'Timestamp', fontSize: 14, fontStyle: 'Regular' }),
      // Sibling: hero section with hierarchy (should NOT pollute typography analysis)
      makeNode({ id: '11:1', name: 'HeroSection', type: 'FRAME', childCount: 2 }),
      makeNode({ id: '11:2', parentId: '11:1', type: 'TEXT', name: 'Heading', fontSize: 36, fontStyle: 'Bold' }),
      makeNode({ id: '11:3', parentId: '11:1', type: 'TEXT', name: 'Subtitle', fontSize: 18, fontStyle: 'Regular' }),
    ];

    const evidence = computeJudgeEvidence(tree, '10:1');

    // Typography should see only the 3 flat texts from the target card
    expect(evidence.visual_hierarchy.verdict).toBe('flat');
    expect(evidence.visual_hierarchy.allSameStyle).toBe(true);
    expect(evidence.visual_hierarchy.textCount).toBe(3);
  });

  it('alignment analyzes full tree including siblings', () => {
    // Siblings should be included for alignment comparison
    const tree: EvidenceNode[] = [
      makeNode({ id: '20:1', name: 'Card A', type: 'FRAME', parentId: '20:0', x: 0, y: 0 }),
      makeNode({ id: '20:2', name: 'Card B', type: 'FRAME', parentId: '20:0', x: 120, y: 15 }),
      makeNode({ id: '20:3', name: 'Card C', type: 'FRAME', parentId: '20:0', x: 240, y: 0 }),
      makeNode({ id: '20:0', name: 'Container', type: 'FRAME', childCount: 3 }),
    ];

    const evidence = computeJudgeEvidence(tree, '20:1');

    // Alignment should detect the 15px y-offset across siblings
    expect(evidence.alignment.verdict).toBe('misaligned');
    expect(evidence.alignment.findings.length).toBeGreaterThan(0);
    expect(evidence.alignment.findings[0].maxDeviation).toBe(15);
  });

  it('naming analyzes only target subtree, not sibling auto-named frames', () => {
    const tree: EvidenceNode[] = [
      // Target: well-named card
      makeNode({ id: '30:1', name: 'ProfileCard', type: 'FRAME', childCount: 1 }),
      makeNode({ id: '30:2', parentId: '30:1', type: 'TEXT', name: 'Title' }),
      // Sibling: auto-named frame (should NOT cause target to fail naming)
      makeNode({ id: '31:1', name: 'Frame 1', type: 'FRAME', childCount: 0 }),
    ];

    const evidence = computeJudgeEvidence(tree, '30:1');

    // Naming should only check the target card — should be OK
    expect(evidence.naming.verdict).toBe('ok');
  });
});

// ── Regression: blocking criteria in aggregateVerdicts ────────────────

describe('computeJudgeEvidence — consistency in standard tier', () => {
  it('3 inconsistent cards with same parent → consistency FAIL regardless of tier', () => {
    // This tests that the consistency analyzer works on children within the target
    const tree: EvidenceNode[] = [
      makeNode({ id: '40:1', name: 'Row', type: 'FRAME', childCount: 3 }),
      makeNode({ id: '40:2', parentId: '40:1', name: 'Card1', type: 'FRAME', paddingTop: 16, cornerRadius: 8 }),
      makeNode({ id: '40:3', parentId: '40:1', name: 'Card2', type: 'FRAME', paddingTop: 24, cornerRadius: 12 }),
      makeNode({ id: '40:4', parentId: '40:1', name: 'Card3', type: 'FRAME', paddingTop: 16, cornerRadius: 8 }),
    ];

    const evidence = computeJudgeEvidence(tree, '40:1');

    expect(evidence.consistency.verdict).toBe('inconsistent');
    expect(evidence.consistency.findings.length).toBeGreaterThan(0);
    // Should find paddingTop inconsistency
    const paddingFinding = evidence.consistency.findings.find((f) => f.property === 'paddingTop');
    expect(paddingFinding).toBeDefined();
    expect(paddingFinding!.values).toEqual([16, 24, 16]);
  });
});
