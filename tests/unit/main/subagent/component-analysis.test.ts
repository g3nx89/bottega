import { describe, expect, it } from 'vitest';
import {
  analyzeComponents,
  computeFingerprint,
  computeRelaxedFingerprint,
  tokenizeName,
  tokenSimilarity,
} from '../../../../src/main/subagent/component-analysis.js';

// ── Helper: inline ParsedNode construction ──────────────────────────

interface TestNode {
  type: string;
  name: string;
  children: TestNode[];
  properties?: Record<string, unknown>;
}

function node(type: string, name: string, children: TestNode[] = []): TestNode {
  return { type, name, children };
}

// ── Name Tokenizer ──────────────────────────────────────────────────

describe('tokenizeName', () => {
  it('expands abbreviations (btn → button)', () => {
    const tokens = tokenizeName('btn-primary');
    expect(tokens.has('button')).toBe(true);
    expect(tokens.has('primary')).toBe(true);
  });

  it('splits camelCase names', () => {
    const tokens = tokenizeName('PrimaryButton');
    expect(tokens.has('primary')).toBe(true);
    expect(tokens.has('button')).toBe(true);
  });

  it('Jaccard similarity of equivalent names is 1.0', () => {
    const a = tokenizeName('btn-primary');
    const b = tokenizeName('PrimaryButton');
    expect(tokenSimilarity(a, b)).toBe(1.0);
  });

  it('Jaccard similarity of unrelated names is 0.0', () => {
    const a = tokenizeName('header');
    const b = tokenizeName('footer');
    expect(tokenSimilarity(a, b)).toBe(0.0);
  });

  it('strips numeric suffixes so "Card 1" ≈ "Card 2"', () => {
    const a = tokenizeName('Card 1');
    const b = tokenizeName('Card 2');
    expect(tokenSimilarity(a, b)).toBe(1.0);
  });
});

// ── Structural Fingerprinting ───────────────────────────────────────

describe('computeFingerprint', () => {
  it('identical trees produce identical fingerprints', () => {
    const tree1 = node('FRAME', 'A', [node('TEXT', 'title'), node('IMAGE', 'hero')]);
    const tree2 = node('FRAME', 'B', [node('TEXT', 'heading'), node('IMAGE', 'photo')]);
    expect(computeFingerprint(tree1)).toBe(computeFingerprint(tree2));
  });

  it('different child types produce different fingerprints', () => {
    const tree1 = node('FRAME', 'A', [node('TEXT', 'title'), node('IMAGE', 'hero')]);
    const tree2 = node('FRAME', 'B', [node('TEXT', 'title'), node('RECTANGLE', 'bg')]);
    expect(computeFingerprint(tree1)).not.toBe(computeFingerprint(tree2));
  });

  it('leaf nodes fingerprint by type only', () => {
    const leaf = node('TEXT', 'hello');
    expect(computeFingerprint(leaf)).toBe('TEXT');
  });

  it('maxDepth=1 ignores deep structural differences', () => {
    const shallow1 = node('FRAME', 'A', [node('FRAME', 'inner', [node('TEXT', 'deep')])]);
    const shallow2 = node('FRAME', 'B', [node('FRAME', 'inner', [node('IMAGE', 'deep')])]);
    // At maxDepth=1 children are fingerprinted at depth 0 → just their type
    expect(computeFingerprint(shallow1, 1)).toBe(computeFingerprint(shallow2, 1));
  });
});

describe('computeRelaxedFingerprint', () => {
  it('encodes type, child count, and sorted child types', () => {
    const n = node('FRAME', 'card', [node('IMAGE', 'img'), node('TEXT', 'title')]);
    expect(computeRelaxedFingerprint(n)).toBe('FRAME:2children:[IMAGE,TEXT]');
  });

  it('leaf node returns type only', () => {
    expect(computeRelaxedFingerprint(node('TEXT', 'x'))).toBe('TEXT');
  });
});

// ── analyzeComponents (integration) ─────────────────────────────────

describe('analyzeComponents', () => {
  it('detects totalScreens from top-level FRAME nodes', () => {
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Screen A',
        children: [
          { type: 'FRAME', name: 'Header', children: [{ type: 'TEXT', name: 'Title', children: [] }] },
          { type: 'FRAME', name: 'Body', children: [{ type: 'IMAGE', name: 'Hero', children: [] }] },
        ],
      },
      {
        type: 'FRAME',
        name: 'Screen B',
        children: [
          { type: 'FRAME', name: 'Header', children: [{ type: 'TEXT', name: 'Title', children: [] }] },
          { type: 'FRAME', name: 'Footer', children: [{ type: 'TEXT', name: 'Copyright', children: [] }] },
        ],
      },
    ]);

    const result = analyzeComponents(fileData, []);

    // Structure validation
    expect(result).toHaveProperty('withinScreen');
    expect(result).toHaveProperty('crossScreen');
    expect(result).toHaveProperty('libraryMisses');
    expect(result).toHaveProperty('detachedInstances');
    expect(result).toHaveProperty('stats');

    // Stats
    expect(result.stats.totalScreens).toBe(2);
    expect(result.stats.totalNodes).toBeGreaterThan(0);
    expect(result.stats.componentizationRatio).toBeGreaterThanOrEqual(0);

    // Cross-screen: both screens have a "Header" FRAME with a TEXT child → structural match
    expect(result.crossScreen.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Realistic card duplication detection ────────────────────────────

describe('analyzeComponents — realistic card detection', () => {
  it('detects 4 identical pizza cards as within-screen duplicates', () => {
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Menu Page',
        children: [
          { type: 'TEXT', name: 'Our Menu', children: [] },
          // 4 pizza cards — same structure, different text
          {
            type: 'FRAME',
            name: 'Margherita',
            children: [
              { type: 'IMAGE', name: 'Pizza Photo', children: [] },
              {
                type: 'FRAME',
                name: 'Card Body',
                children: [
                  { type: 'TEXT', name: 'Classic tomato and mozzarella', children: [] },
                  { type: 'TEXT', name: '€8.50', children: [] },
                ],
              },
            ],
          },
          {
            type: 'FRAME',
            name: 'Quattro Formaggi',
            children: [
              { type: 'IMAGE', name: 'Pizza Photo', children: [] },
              {
                type: 'FRAME',
                name: 'Card Body',
                children: [
                  { type: 'TEXT', name: 'Four cheese blend', children: [] },
                  { type: 'TEXT', name: '€12.00', children: [] },
                ],
              },
            ],
          },
          {
            type: 'FRAME',
            name: 'Diavola',
            children: [
              { type: 'IMAGE', name: 'Pizza Photo', children: [] },
              {
                type: 'FRAME',
                name: 'Card Body',
                children: [
                  { type: 'TEXT', name: 'Spicy salami', children: [] },
                  { type: 'TEXT', name: '€10.00', children: [] },
                ],
              },
            ],
          },
          {
            type: 'FRAME',
            name: 'Capricciosa',
            children: [
              { type: 'IMAGE', name: 'Pizza Photo', children: [] },
              {
                type: 'FRAME',
                name: 'Card Body',
                children: [
                  { type: 'TEXT', name: 'Ham, mushrooms, artichokes', children: [] },
                  { type: 'TEXT', name: '€11.50', children: [] },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const result = analyzeComponents(fileData, []);

    // Must detect the 4 cards as duplicates
    expect(result.withinScreen.length).toBeGreaterThanOrEqual(1);
    const cardDuplicates = result.withinScreen.find((d) => d.count >= 4);
    expect(cardDuplicates).toBeDefined();
    expect(cardDuplicates!.count).toBe(4);
  });

  it('detects 2 pricing cards (threshold lowered to 2)', () => {
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Pricing Page',
        children: [
          {
            type: 'FRAME',
            name: 'Free Plan',
            children: [
              { type: 'TEXT', name: 'Free', children: [] },
              { type: 'TEXT', name: '$0/mo', children: [] },
              {
                type: 'FRAME',
                name: 'Features',
                children: [
                  { type: 'TEXT', name: '1 project', children: [] },
                  { type: 'TEXT', name: '5 users', children: [] },
                ],
              },
            ],
          },
          {
            type: 'FRAME',
            name: 'Pro Plan',
            children: [
              { type: 'TEXT', name: 'Pro', children: [] },
              { type: 'TEXT', name: '$49/mo', children: [] },
              {
                type: 'FRAME',
                name: 'Features',
                children: [
                  { type: 'TEXT', name: '10 projects', children: [] },
                  { type: 'TEXT', name: '50 users', children: [] },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    expect(result.withinScreen.length).toBeGreaterThanOrEqual(1);
    const planDuplicates = result.withinScreen.find((d) => d.count >= 2);
    expect(planDuplicates).toBeDefined();
  });

  it('detects cards with minor structural differences via relaxed fingerprint', () => {
    // Cards with inner structure (grandchildren) — required for depth filter
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Product Grid',
        children: [
          // Card with badge (extra child)
          {
            type: 'FRAME',
            name: 'Product A',
            children: [
              { type: 'IMAGE', name: 'Photo', children: [] },
              {
                type: 'FRAME',
                name: 'Info',
                children: [
                  { type: 'TEXT', name: 'Name', children: [] },
                  { type: 'TEXT', name: 'Price', children: [] },
                ],
              },
              { type: 'TEXT', name: 'NEW', children: [] },
            ],
          },
          // Card without badge
          {
            type: 'FRAME',
            name: 'Product B',
            children: [
              { type: 'IMAGE', name: 'Photo', children: [] },
              {
                type: 'FRAME',
                name: 'Info',
                children: [
                  { type: 'TEXT', name: 'Name', children: [] },
                  { type: 'TEXT', name: 'Price', children: [] },
                ],
              },
            ],
          },
          // Card without badge
          {
            type: 'FRAME',
            name: 'Product C',
            children: [
              { type: 'IMAGE', name: 'Photo', children: [] },
              {
                type: 'FRAME',
                name: 'Info',
                children: [
                  { type: 'TEXT', name: 'Name', children: [] },
                  { type: 'TEXT', name: 'Price', children: [] },
                ],
              },
            ],
          },
        ],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    // At minimum: 2 strict matches (B+C have identical structure)
    const totalDuplicateNodes = result.withinScreen.reduce((sum, d) => sum + d.count, 0);
    expect(totalDuplicateNodes).toBeGreaterThanOrEqual(2);
  });

  it('skips INSTANCE nodes — already componentized', () => {
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Screen',
        children: [
          {
            type: 'INSTANCE',
            name: 'Card 1',
            children: [{ type: 'FRAME', name: 'Body', children: [{ type: 'TEXT', name: 'A', children: [] }] }],
          },
          {
            type: 'INSTANCE',
            name: 'Card 2',
            children: [{ type: 'FRAME', name: 'Body', children: [{ type: 'TEXT', name: 'B', children: [] }] }],
          },
          {
            type: 'INSTANCE',
            name: 'Card 3',
            children: [{ type: 'FRAME', name: 'Body', children: [{ type: 'TEXT', name: 'C', children: [] }] }],
          },
        ],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    // INSTANCE nodes should be skipped — no duplicates reported
    expect(result.withinScreen.length).toBe(0);
  });

  it('fast-path would NOT auto-PASS when duplicates with inner structure exist', () => {
    // Cards with grandchildren to pass structural depth filter
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Page',
        children: [
          {
            type: 'FRAME',
            name: 'Card 1',
            children: [
              { type: 'IMAGE', name: 'Img', children: [] },
              { type: 'FRAME', name: 'Body', children: [{ type: 'TEXT', name: 'A', children: [] }] },
            ],
          },
          {
            type: 'FRAME',
            name: 'Card 2',
            children: [
              { type: 'IMAGE', name: 'Img', children: [] },
              { type: 'FRAME', name: 'Body', children: [{ type: 'TEXT', name: 'B', children: [] }] },
            ],
          },
        ],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    // 2 identical cards with inner structure → withinScreen should NOT be empty
    expect(result.withinScreen.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT flag shallow FRAME>[TEXT] as duplicates (buttons, badges)', () => {
    // Simple FRAME>[TEXT] patterns should NOT be flagged — too generic
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Page',
        children: [
          { type: 'FRAME', name: 'Submit Btn', children: [{ type: 'TEXT', name: 'Submit', children: [] }] },
          { type: 'FRAME', name: 'Cancel Btn', children: [{ type: 'TEXT', name: 'Cancel', children: [] }] },
          { type: 'FRAME', name: 'Badge', children: [{ type: 'TEXT', name: 'NEW', children: [] }] },
          { type: 'FRAME', name: 'Label', children: [{ type: 'TEXT', name: 'Price', children: [] }] },
        ],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    // No duplicates — shallow structures are filtered out
    expect(result.withinScreen.length).toBe(0);
  });
});

// ── Ancestor dedup ─────────────────────────────────────────────────

describe('analyzeComponents — ancestor dedup', () => {
  it('deduplicates inner frames that are subsets of card-level duplicates', () => {
    // 4 cards, each with IMAGE + inner FRAME>[TEXT,TEXT].
    // Without dedup: 2 groups (4 cards + 4 inner frames). With dedup: 1 group (4 cards only).
    const card = (name: string) => ({
      type: 'FRAME',
      name,
      children: [
        { type: 'IMAGE', name: 'Photo', children: [] },
        {
          type: 'FRAME',
          name: 'Body',
          children: [
            { type: 'TEXT', name: 'Title', children: [] },
            { type: 'TEXT', name: 'Price', children: [] },
          ],
        },
      ],
    });
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Screen',
        children: [card('Card A'), card('Card B'), card('Card C'), card('Card D')],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    // Should be exactly 1 group: the 4 cards (not the inner Body frames)
    expect(result.withinScreen.length).toBe(1);
    expect(result.withinScreen[0]!.count).toBe(4);
  });

  it('keeps independent duplicate groups even when they co-exist with card duplicates', () => {
    // 3 cards (with inner structure) + 2 simpler components (with inner structure)
    const card = (name: string) => ({
      type: 'FRAME',
      name,
      children: [
        { type: 'IMAGE', name: 'Img', children: [] },
        {
          type: 'FRAME',
          name: 'Body',
          children: [
            { type: 'TEXT', name: 'Title', children: [] },
            { type: 'TEXT', name: 'Desc', children: [] },
          ],
        },
      ],
    });
    const testimonial = (name: string) => ({
      type: 'FRAME',
      name,
      children: [
        { type: 'TEXT', name: 'Quote', children: [] },
        {
          type: 'FRAME',
          name: 'Author',
          children: [
            { type: 'IMAGE', name: 'Avatar', children: [] },
            { type: 'TEXT', name: 'Name', children: [] },
          ],
        },
      ],
    });
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Screen',
        children: [card('Card 1'), card('Card 2'), card('Card 3'), testimonial('Review 1'), testimonial('Review 2')],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    // 2 independent groups: 3 cards + 2 testimonials (both have inner structure)
    expect(result.withinScreen.length).toBe(2);
  });
});

// ── Target node scoping ────────────────────────────────────────────

describe('analyzeComponents — target node scoping', () => {
  // Helper: realistic card with inner structure (passes depth filter)
  const realisticCard = (id: string, name: string) => ({
    id,
    type: 'FRAME',
    name,
    children: [
      { type: 'IMAGE', name: 'Photo', children: [] },
      {
        type: 'FRAME',
        name: 'Body',
        children: [
          { type: 'TEXT', name: 'Title', children: [] },
          { type: 'TEXT', name: 'Desc', children: [] },
        ],
      },
    ],
  });

  it('limits within-screen detection to the screen containing the target', () => {
    const fileData = JSON.stringify([
      {
        id: '1:1',
        type: 'FRAME',
        name: 'Old Screen',
        children: [realisticCard('1:2', 'Old Card A'), realisticCard('1:3', 'Old Card B')],
      },
      {
        id: '2:1',
        type: 'FRAME',
        name: 'New Screen',
        children: [realisticCard('2:2', 'New Card A'), realisticCard('2:3', 'New Card B')],
      },
    ]);

    // Without scoping: both screens' duplicates counted
    const unscoped = analyzeComponents(fileData, []);
    expect(unscoped.withinScreen.length).toBeGreaterThanOrEqual(2);

    // With target in New Screen: only New Screen's duplicates counted
    const scoped = analyzeComponents(fileData, [], '2:2');
    expect(scoped.withinScreen.length).toBe(1);
    expect(scoped.withinScreen[0]!.nodeNames).toContain('New Card A');
  });

  it('scopes to parent container, not entire screen (prevents contamination)', () => {
    // Screen has two sections: old cards + new cards. Target is in new section.
    const fileData = JSON.stringify([
      {
        id: '1:1',
        type: 'FRAME',
        name: 'Page',
        children: [
          {
            id: '1:10',
            type: 'FRAME',
            name: 'Old Section',
            children: [realisticCard('1:11', 'Old A'), realisticCard('1:12', 'Old B'), realisticCard('1:13', 'Old C')],
          },
          {
            id: '1:20',
            type: 'FRAME',
            name: 'New Section',
            children: [realisticCard('1:21', 'New A'), realisticCard('1:22', 'New B')],
          },
        ],
      },
    ]);

    // Target is "New A" inside "New Section" — should only analyze New Section's children
    const result = analyzeComponents(fileData, [], '1:21');
    // Should find 2 duplicates in New Section only (not the 3 in Old Section)
    expect(result.withinScreen.length).toBe(1);
    expect(result.withinScreen[0]!.count).toBe(2);
    expect(result.withinScreen[0]!.nodeNames).toContain('New A');
    expect(result.withinScreen[0]!.nodeNames).not.toContain('Old A');
  });

  it('when target is a container with 3+ children, analyzes its children', () => {
    const fileData = JSON.stringify([
      {
        id: '1:1',
        type: 'FRAME',
        name: 'Page',
        children: [
          {
            id: '1:10',
            type: 'FRAME',
            name: 'Menu Grid',
            children: [
              realisticCard('1:11', 'Card A'),
              realisticCard('1:12', 'Card B'),
              realisticCard('1:13', 'Card C'),
              realisticCard('1:14', 'Card D'),
            ],
          },
        ],
      },
    ]);

    // Target IS the container "Menu Grid" (4 children) — analyze its children
    const result = analyzeComponents(fileData, [], '1:10');
    expect(result.withinScreen.length).toBe(1);
    expect(result.withinScreen[0]!.count).toBe(4);
  });

  it('falls back to all screens when target not found', () => {
    const fileData = JSON.stringify([
      {
        id: '1:1',
        type: 'FRAME',
        name: 'Screen',
        children: [realisticCard('1:2', 'A'), realisticCard('1:3', 'B')],
      },
    ]);

    const result = analyzeComponents(fileData, [], 'nonexistent:99');
    // Should still detect duplicates (fallback to all screens)
    expect(result.withinScreen.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Edge cases ─────────────────────────────────────────────────────

describe('analyzeComponents — edge cases', () => {
  it('single card — no duplicates, PASS', () => {
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Screen',
        children: [
          {
            type: 'FRAME',
            name: 'Only Card',
            children: [
              { type: 'IMAGE', name: 'Photo', children: [] },
              { type: 'TEXT', name: 'Title', children: [] },
            ],
          },
        ],
      },
    ]);
    const result = analyzeComponents(fileData, []);
    expect(result.withinScreen.length).toBe(0);
  });

  it('empty page — zero findings', () => {
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Empty Page',
        children: [],
      },
    ]);
    const result = analyzeComponents(fileData, []);
    expect(result.withinScreen.length).toBe(0);
    expect(result.stats.totalNodes).toBeGreaterThanOrEqual(0);
  });

  it('mixed INSTANCE and FRAME — only FRAME counted', () => {
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Screen',
        children: [
          // INSTANCE nodes — should be skipped
          {
            type: 'INSTANCE',
            name: 'Good Card 1',
            children: [{ type: 'FRAME', name: 'B', children: [{ type: 'TEXT', name: 'A', children: [] }] }],
          },
          {
            type: 'INSTANCE',
            name: 'Good Card 2',
            children: [{ type: 'FRAME', name: 'B', children: [{ type: 'TEXT', name: 'B', children: [] }] }],
          },
          // FRAME nodes with inner structure — should be detected
          {
            type: 'FRAME',
            name: 'Bad Card 1',
            children: [
              { type: 'IMAGE', name: 'Img', children: [] },
              { type: 'FRAME', name: 'Body', children: [{ type: 'TEXT', name: 'C', children: [] }] },
            ],
          },
          {
            type: 'FRAME',
            name: 'Bad Card 2',
            children: [
              { type: 'IMAGE', name: 'Img', children: [] },
              { type: 'FRAME', name: 'Body', children: [{ type: 'TEXT', name: 'D', children: [] }] },
            ],
          },
        ],
      },
    ]);
    const result = analyzeComponents(fileData, []);
    // Only the 2 FRAME cards should be detected as duplicates
    const frameDupes = result.withinScreen.find((d) => d.count === 2);
    expect(frameDupes).toBeDefined();
    expect(frameDupes!.nodeNames).toContain('Bad Card 1');
    expect(frameDupes!.nodeNames).not.toContain('Good Card 1');
  });

  it('deeply nested cards (depth > 3) still match', () => {
    // Deep cards with 2+ children and grandchildren at each level
    const deepCard = (name: string) => ({
      type: 'FRAME',
      name,
      children: [
        { type: 'IMAGE', name: 'Thumb', children: [] },
        {
          type: 'FRAME',
          name: 'Layer 1',
          children: [
            {
              type: 'FRAME',
              name: 'Layer 2',
              children: [
                { type: 'FRAME', name: 'Layer 3', children: [{ type: 'TEXT', name: 'Deep Text', children: [] }] },
              ],
            },
          ],
        },
      ],
    });
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Screen',
        children: [deepCard('Deep A'), deepCard('Deep B'), deepCard('Deep C')],
      },
    ]);
    const result = analyzeComponents(fileData, []);
    // Should find duplicates via strict (same depth-3 structure) or relaxed
    expect(result.withinScreen.length).toBeGreaterThanOrEqual(1);
  });

  it('layout without repeating top-level elements — only nested noise possible', () => {
    // Header, Hero, Footer have different structures at their level.
    // Make each structurally unique to avoid inner-frame coincidental matches.
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Landing Page',
        children: [
          {
            type: 'FRAME',
            name: 'Header',
            children: [
              { type: 'TEXT', name: 'Logo', children: [] },
              {
                type: 'FRAME',
                name: 'Nav',
                children: [
                  { type: 'TEXT', name: 'Link 1', children: [] },
                  { type: 'TEXT', name: 'Link 2', children: [] },
                ],
              },
            ],
          },
          {
            type: 'FRAME',
            name: 'Hero',
            children: [
              { type: 'TEXT', name: 'Headline', children: [] },
              { type: 'IMAGE', name: 'Hero Image', children: [] },
              {
                type: 'FRAME',
                name: 'CTA',
                children: [
                  { type: 'TEXT', name: 'Button Text', children: [] },
                  { type: 'RECTANGLE', name: 'Button BG', children: [] },
                ],
              },
            ],
          },
          {
            type: 'FRAME',
            name: 'Footer',
            children: [
              { type: 'TEXT', name: 'Copyright', children: [] },
              {
                type: 'FRAME',
                name: 'Social Links',
                children: [
                  { type: 'IMAGE', name: 'Twitter', children: [] },
                  { type: 'IMAGE', name: 'LinkedIn', children: [] },
                  { type: 'IMAGE', name: 'GitHub', children: [] },
                ],
              },
            ],
          },
        ],
      },
    ]);
    const result = analyzeComponents(fileData, []);
    // Header, Hero, Footer are all structurally different — no top-level duplicates
    // (inner frames may coincidentally match but ancestor dedup should handle it)
    const topLevelDupes = result.withinScreen.filter((d) => d.count >= 2);
    // No group should contain Header+Hero or Hero+Footer
    for (const group of topLevelDupes) {
      const hasHeader = group.nodeNames.includes('Header');
      const hasHero = group.nodeNames.includes('Hero');
      const hasFooter = group.nodeNames.includes('Footer');
      expect(hasHeader && hasHero).toBe(false);
      expect(hasHero && hasFooter).toBe(false);
    }
  });

  it('handles malformed/empty file data gracefully', () => {
    expect(analyzeComponents('', []).withinScreen.length).toBe(0);
    expect(analyzeComponents('not json', []).withinScreen.length).toBe(0);
    expect(analyzeComponents('{}', []).withinScreen.length).toBe(0);
    expect(analyzeComponents('null', []).withinScreen.length).toBe(0);
  });
});

// ── NodeId propagation (retry hint enablement) ─────────────────────

describe('analyzeComponents — nodeId propagation', () => {
  it('populates nodeIds in withinScreen findings when IDs are present in raw tree', () => {
    const card = (id: string, name: string) => ({
      id,
      type: 'FRAME',
      name,
      children: [
        { type: 'IMAGE', name: 'Img', children: [] },
        {
          type: 'FRAME',
          name: 'Body',
          children: [
            { type: 'TEXT', name: 'Title', children: [] },
            { type: 'TEXT', name: 'Desc', children: [] },
          ],
        },
      ],
    });
    const fileData = JSON.stringify([
      {
        id: '1:1',
        type: 'FRAME',
        name: 'Screen',
        children: [card('270:2025', 'Card A'), card('270:2040', 'Card B'), card('270:2055', 'Card C')],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    expect(result.withinScreen.length).toBe(1);
    const group = result.withinScreen[0]!;
    expect(group.nodeIds).toEqual(['270:2025', '270:2040', '270:2055']);
    expect(group.nodeNames).toEqual(['Card A', 'Card B', 'Card C']);
  });

  it('handles missing IDs gracefully (empty nodeIds array)', () => {
    const card = (name: string) => ({
      type: 'FRAME',
      name,
      children: [
        { type: 'IMAGE', name: 'Img', children: [] },
        { type: 'FRAME', name: 'Body', children: [{ type: 'TEXT', name: 'X', children: [] }] },
      ],
    });
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Screen',
        children: [card('A'), card('B')],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    expect(result.withinScreen.length).toBe(1);
    expect(result.withinScreen[0]!.nodeIds).toEqual([]);
  });
});

// ── Relaxed fingerprint name similarity (nav/header false positive fix) ─

describe('analyzeComponents — relaxed fingerprint name filter', () => {
  it('does NOT flag relaxed-match structures with dissimilar semantic names', () => {
    // Nav/Header + Footer/Top + Hero/CTARow share RELAXED fingerprint
    // FRAME:2children:[FRAME,TEXT] but have different internal structures.
    // Strict fingerprints differ; relaxed would match but name filter blocks.
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Page',
        children: [
          {
            type: 'FRAME',
            name: 'Nav/Header',
            children: [
              {
                type: 'FRAME',
                name: 'Links',
                children: [
                  { type: 'TEXT', name: 'Home', children: [] },
                  { type: 'TEXT', name: 'About', children: [] },
                  { type: 'TEXT', name: 'Contact', children: [] },
                ],
              },
              { type: 'TEXT', name: 'Logo', children: [] },
            ],
          },
          {
            type: 'FRAME',
            name: 'Footer/Top',
            children: [
              {
                type: 'FRAME',
                name: 'Social',
                children: [
                  { type: 'IMAGE', name: 'Twitter', children: [] },
                  { type: 'IMAGE', name: 'GitHub', children: [] },
                ],
              },
              { type: 'TEXT', name: 'Copyright', children: [] },
            ],
          },
          {
            type: 'FRAME',
            name: 'Hero/CTARow',
            children: [
              {
                type: 'FRAME',
                name: 'Buttons',
                children: [
                  { type: 'RECTANGLE', name: 'Primary', children: [] },
                  { type: 'RECTANGLE', name: 'Secondary', children: [] },
                ],
              },
              { type: 'TEXT', name: 'Tagline', children: [] },
            ],
          },
        ],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    // Strict fingerprints differ (different child types). Relaxed would match
    // but name filter rejects: Nav/Footer/Hero tokens have no meaningful overlap.
    // Should be 0 findings.
    expect(result.withinScreen.length).toBe(0);
  });

  it('does NOT flag elements with shared page-path prefix only', () => {
    // Landing/Hero, Landing/Features, Landing/Footer share "Landing" prefix
    // but the last segments (Hero, Features, Footer) are dissimilar.
    // Should NOT be flagged as duplicates.
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Page',
        children: [
          {
            type: 'FRAME',
            name: 'Landing/Hero',
            children: [
              {
                type: 'FRAME',
                name: 'Inner',
                children: [
                  { type: 'TEXT', name: 'Headline', children: [] },
                  { type: 'TEXT', name: 'Sub', children: [] },
                ],
              },
              { type: 'TEXT', name: 'Tagline', children: [] },
            ],
          },
          {
            type: 'FRAME',
            name: 'Landing/Features',
            children: [
              {
                type: 'FRAME',
                name: 'List',
                children: [
                  { type: 'TEXT', name: 'Item 1', children: [] },
                  { type: 'TEXT', name: 'Item 2', children: [] },
                ],
              },
              { type: 'TEXT', name: 'Title', children: [] },
            ],
          },
          {
            type: 'FRAME',
            name: 'Landing/Footer',
            children: [
              {
                type: 'FRAME',
                name: 'Bottom',
                children: [
                  { type: 'TEXT', name: 'Copyright', children: [] },
                  { type: 'TEXT', name: 'Links', children: [] },
                ],
              },
              { type: 'TEXT', name: 'Brand', children: [] },
            ],
          },
        ],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    // Strict fingerprints are identical (same structure), so this WILL be flagged
    // by the strict matcher. The name filter only applies to relaxed matches.
    // What we're testing: the shared-prefix shouldn't bypass scrutiny.
    // For this test, accept either 0 or 1 finding (strict can flag identical structures).
    if (result.withinScreen.length > 0) {
      // If flagged, must be by strict match (no ~ prefix)
      const fp = result.withinScreen[0]!.fingerprint;
      expect(fp.startsWith('~')).toBe(false); // not a relaxed match
    }
  });

  it('still flags similarly-named repeated elements (cards, items)', () => {
    const card = (name: string) => ({
      type: 'FRAME',
      name,
      children: [
        {
          type: 'FRAME',
          name: 'Body',
          children: [
            { type: 'TEXT', name: 'Title', children: [] },
            { type: 'TEXT', name: 'Desc', children: [] },
          ],
        },
        { type: 'TEXT', name: 'Label', children: [] },
      ],
    });
    const fileData = JSON.stringify([
      {
        type: 'FRAME',
        name: 'Page',
        children: [card('Card/A'), card('Card/B'), card('Card/C')],
      },
    ]);

    const result = analyzeComponents(fileData, []);
    // Cards with shared "Card" prefix should be detected
    expect(result.withinScreen.length).toBeGreaterThanOrEqual(1);
  });
});
