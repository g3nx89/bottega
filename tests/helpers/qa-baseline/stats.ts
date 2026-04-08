/**
 * Quantile math for baseline aggregation. Pure functions; no IO.
 *
 * Chosen over a library to keep the helper surface small and to control
 * the specific definition of percentile (we use "nearest rank" — the
 * value at position ceil(p * N) after sorting — which is stable for small
 * N and degenerates cleanly at N=1).
 */

import type { QuantileStats } from './schema.js';

/**
 * Compute QuantileStats from a sample array. Returns null if the sample
 * is empty (callers turn this into the JSON `null` representation for
 * manual steps). Throws on non-finite values so upstream bugs surface
 * instead of producing silent NaN baselines.
 */
export function computeStats(samples: readonly number[]): QuantileStats | null {
  if (samples.length === 0) return null;
  for (const s of samples) {
    if (!Number.isFinite(s)) {
      throw new Error(`computeStats: non-finite sample ${s}`);
    }
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;

  const mean = sorted.reduce((acc, v) => acc + v, 0) / n;
  // Population stddev (N denominator) — we're describing the observed
  // runs, not estimating a population from a subset.
  const variance = sorted.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  return {
    min: sorted[0],
    p50: percentileNearestRank(sorted, 0.5),
    p90: percentileNearestRank(sorted, 0.9),
    p95: percentileNearestRank(sorted, 0.95),
    max: sorted[n - 1],
    mean,
    stddev,
    samples: n,
  };
}

/**
 * Nearest-rank percentile on a pre-sorted array. For p=0.95 and n=5,
 * returns sorted[ceil(0.95 * 5) - 1] = sorted[4] = max. For n=1, returns
 * the single value regardless of p. This is the method used by most
 * monitoring systems (e.g., Prometheus histogram quantile).
 */
export function percentileNearestRank(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) {
    throw new Error('percentileNearestRank: empty array');
  }
  if (p <= 0) return sortedAsc[0];
  if (p >= 1) return sortedAsc[sortedAsc.length - 1];
  const rank = Math.ceil(p * sortedAsc.length);
  return sortedAsc[rank - 1];
}

/**
 * Compute the modal (most frequent) sequence in an array of sequences,
 * plus the full variant list with counts. Ties broken by first appearance.
 * Used for `toolSequences` aggregation in the baseline.
 */
export function computeSequenceStats(sequences: readonly (readonly string[])[]): {
  modal: string[];
  variants: Array<{ sequence: string[]; count: number }>;
} {
  if (sequences.length === 0) {
    return { modal: [], variants: [] };
  }

  // Group by stringified sequence, preserving first-seen order for tie-breaking.
  const order: string[] = [];
  const counts = new Map<string, { sequence: string[]; count: number }>();
  for (const seq of sequences) {
    const key = JSON.stringify(seq);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(key, { sequence: [...seq], count: 1 });
      order.push(key);
    }
  }

  // Modal: the sequence with the highest count; ties broken by first appearance.
  let modalKey = order[0];
  for (const key of order) {
    if (counts.get(key)!.count > counts.get(modalKey)!.count) {
      modalKey = key;
    }
  }

  // Variants: sorted by count desc, then by first-seen order for determinism.
  const variants = order.map((k) => counts.get(k)!).sort((a, b) => b.count - a.count);

  return { modal: counts.get(modalKey)!.sequence, variants };
}
