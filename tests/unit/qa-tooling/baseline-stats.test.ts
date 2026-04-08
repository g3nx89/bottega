// Fase 3 — Quantile math for baseline aggregation.
// Covers: computeStats edge cases (empty, single sample, non-finite),
// percentile nearest-rank behavior, computeSequenceStats modal/variants.

import { describe, expect, it } from 'vitest';

import { computeSequenceStats, computeStats, percentileNearestRank } from '../../../tests/helpers/qa-baseline/stats.js';

describe('computeStats', () => {
  it('returns null for empty input', () => {
    expect(computeStats([])).toBeNull();
  });

  it('handles single sample (all percentiles = value, stddev = 0)', () => {
    const s = computeStats([42]);
    expect(s).toEqual({
      min: 42,
      p50: 42,
      p90: 42,
      p95: 42,
      max: 42,
      mean: 42,
      stddev: 0,
      samples: 1,
    });
  });

  it('computes correct stats for 5-sample run (n=5, p95 = sorted[ceil(0.95*5)-1] = sorted[4] = max)', () => {
    const s = computeStats([10, 20, 30, 40, 50]);
    expect(s).not.toBeNull();
    expect(s!.min).toBe(10);
    expect(s!.max).toBe(50);
    expect(s!.mean).toBe(30);
    expect(s!.p50).toBe(30);
    expect(s!.p95).toBe(50);
    expect(s!.samples).toBe(5);
    // Population stddev of [10,20,30,40,50] = sqrt(200) ≈ 14.1421
    expect(s!.stddev).toBeCloseTo(Math.sqrt(200), 4);
  });

  it('throws on non-finite samples instead of producing NaN stats', () => {
    expect(() => computeStats([1, 2, Number.NaN])).toThrow(/non-finite/);
    expect(() => computeStats([1, Number.POSITIVE_INFINITY])).toThrow(/non-finite/);
  });

  it('handles unsorted input (internal sort)', () => {
    const s = computeStats([50, 10, 30, 20, 40]);
    expect(s!.min).toBe(10);
    expect(s!.max).toBe(50);
    expect(s!.p50).toBe(30);
  });

  it('handles duplicate samples', () => {
    const s = computeStats([5, 5, 5, 5]);
    expect(s!.stddev).toBe(0);
    expect(s!.p95).toBe(5);
  });
});

describe('percentileNearestRank', () => {
  it('returns first for p=0, last for p=1', () => {
    expect(percentileNearestRank([1, 2, 3], 0)).toBe(1);
    expect(percentileNearestRank([1, 2, 3], 1)).toBe(3);
  });

  it('uses nearest-rank: ceil(p*n)-1', () => {
    // n=10, p=0.5 → ceil(5)=5 → index 4 → value 5
    expect(percentileNearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
    // n=10, p=0.9 → ceil(9)=9 → index 8 → value 9
    expect(percentileNearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    // n=10, p=0.95 → ceil(9.5)=10 → index 9 → value 10
    expect(percentileNearestRank([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
  });

  it('throws on empty input', () => {
    expect(() => percentileNearestRank([], 0.5)).toThrow(/empty/);
  });
});

describe('computeSequenceStats', () => {
  it('returns empty stats for empty input', () => {
    expect(computeSequenceStats([])).toEqual({ modal: [], variants: [] });
  });

  it('identifies the modal sequence and counts variants', () => {
    const r = computeSequenceStats([
      ['a', 'b'],
      ['a', 'b'],
      ['a', 'b'],
      ['a', 'c'],
      ['a', 'b', 'c'],
    ]);
    expect(r.modal).toEqual(['a', 'b']);
    expect(r.variants).toHaveLength(3);
    expect(r.variants[0]).toEqual({ sequence: ['a', 'b'], count: 3 });
  });

  it('breaks ties by first appearance', () => {
    const r = computeSequenceStats([['a'], ['b'], ['a'], ['b']]);
    // Both ['a'] and ['b'] appear twice; ['a'] wins because it was first.
    expect(r.modal).toEqual(['a']);
    expect(r.variants.map((v) => v.sequence)).toContainEqual(['a']);
    expect(r.variants.map((v) => v.sequence)).toContainEqual(['b']);
  });

  it('sorts variants by count descending', () => {
    const r = computeSequenceStats([['x'], ['y'], ['y'], ['y'], ['z'], ['z']]);
    expect(r.variants[0].sequence).toEqual(['y']);
    expect(r.variants[0].count).toBe(3);
    expect(r.variants[1].sequence).toEqual(['z']);
    expect(r.variants[1].count).toBe(2);
    expect(r.variants[2].sequence).toEqual(['x']);
    expect(r.variants[2].count).toBe(1);
  });

  it('handles empty sequences (no tools called) as a valid variant', () => {
    const r = computeSequenceStats([[], [], ['a']]);
    expect(r.modal).toEqual([]);
    expect(r.variants.find((v) => v.sequence.length === 0)?.count).toBe(2);
  });
});
