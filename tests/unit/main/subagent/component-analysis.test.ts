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
