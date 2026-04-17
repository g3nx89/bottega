import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
// Import as CommonJS — status-strip.js sits under src/renderer/ which carries
// a nested package.json forcing "type": "commonjs", so module.exports is
// populated when loaded via require().
const StatusStrip = require('../../../src/renderer/status-strip.js') as {
  pickLabel: (state: any) => { label: string; kind: string };
  createThinkingBuffer: (opts?: any) => {
    append: (s: string) => void;
    flushNow: () => void;
    dispose: () => void;
    pendingSize: () => number;
  };
  computeStallClass: (kind: string, elapsedMs: number) => string | null;
  formatElapsedSec: (startedAt: number, now?: () => number) => string;
  capAppendText: (current: string, incoming: string, maxChars: number, keepChars: number) => string;
  STALL_THRESHOLDS_MS: Record<string, number>;
};

describe('status-strip / pickLabel', () => {
  it('returns "Working" when state is empty', () => {
    expect(StatusStrip.pickLabel(undefined)).toEqual({ label: 'Working', kind: 'working' });
    expect(StatusStrip.pickLabel({})).toEqual({ label: 'Working', kind: 'working' });
  });

  it('returns "Thinking" when thinking flag present', () => {
    expect(StatusStrip.pickLabel({ thinking: true })).toEqual({
      label: 'Thinking',
      kind: 'thinking',
    });
  });

  it('prefers "Quality check" over thinking', () => {
    expect(StatusStrip.pickLabel({ thinking: true, judging: true })).toEqual({
      label: 'Quality check',
      kind: 'judging',
    });
  });

  it('prefers retrying over judging and thinking', () => {
    const out = StatusStrip.pickLabel({
      thinking: true,
      judging: true,
      retrying: { attempt: 2, max: 3 },
    });
    expect(out).toEqual({ label: 'Retrying (2/3)', kind: 'retrying' });
  });

  it('formats retry attempt/max correctly at edges', () => {
    expect(StatusStrip.pickLabel({ retrying: { attempt: 1, max: 1 } })).toEqual({
      label: 'Retrying (1/1)',
      kind: 'retrying',
    });
    expect(StatusStrip.pickLabel({ retrying: { attempt: 5, max: 10 } }).label).toBe('Retrying (5/10)');
  });
});

describe('status-strip / createThinkingBuffer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces multiple deltas within flushMs into a single flush', () => {
    const onFlush = vi.fn();
    const buf = StatusStrip.createThinkingBuffer({ flushMs: 50, onFlush });

    buf.append('a');
    vi.advanceTimersByTime(20);
    buf.append('b');
    vi.advanceTimersByTime(20);
    buf.append('c');
    vi.advanceTimersByTime(50);

    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith('abc');
    buf.dispose();
  });

  it('fires separate flushes when deltas are spaced further than flushMs apart', () => {
    const onFlush = vi.fn();
    const buf = StatusStrip.createThinkingBuffer({ flushMs: 50, onFlush });

    buf.append('first');
    vi.advanceTimersByTime(60);
    buf.append('second');
    vi.advanceTimersByTime(60);

    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush).toHaveBeenNthCalledWith(1, 'first');
    expect(onFlush).toHaveBeenNthCalledWith(2, 'second');
    buf.dispose();
  });

  it('flushNow emits immediately and resets pending buffer', () => {
    const onFlush = vi.fn();
    const buf = StatusStrip.createThinkingBuffer({ flushMs: 500, onFlush });

    buf.append('abc');
    expect(buf.pendingSize()).toBe(3);
    buf.flushNow();
    expect(onFlush).toHaveBeenCalledWith('abc');
    expect(buf.pendingSize()).toBe(0);
    buf.dispose();
  });

  it('ignores null/undefined/empty-string deltas', () => {
    const onFlush = vi.fn();
    const buf = StatusStrip.createThinkingBuffer({ flushMs: 50, onFlush });

    buf.append(null as unknown as string);
    buf.append(undefined as unknown as string);
    buf.append('');
    vi.advanceTimersByTime(100);

    expect(onFlush).not.toHaveBeenCalled();
    buf.dispose();
  });

  it('dispose() cancels pending flush and drops subsequent appends', () => {
    const onFlush = vi.fn();
    const buf = StatusStrip.createThinkingBuffer({ flushMs: 50, onFlush });

    buf.append('abc');
    buf.dispose();
    vi.advanceTimersByTime(200);
    buf.append('xyz');
    vi.advanceTimersByTime(200);

    expect(onFlush).not.toHaveBeenCalled();
  });

  it('uses injected setTimeout / clearTimeout implementations', () => {
    const setSpy = vi.fn((fn, _ms) => {
      return fn; // return a fake handle
    }) as unknown as typeof setTimeout;
    const clearSpy = vi.fn();

    const buf = StatusStrip.createThinkingBuffer({
      flushMs: 50,
      onFlush: () => {},
      setTimeoutImpl: setSpy,
      clearTimeoutImpl: clearSpy,
    });

    buf.append('a');
    buf.append('b'); // triggers clear + new timer
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    buf.dispose();
  });
});

describe('status-strip / computeStallClass', () => {
  it('returns null below threshold for each phase kind', () => {
    expect(StatusStrip.computeStallClass('thinking', 29_999)).toBeNull();
    expect(StatusStrip.computeStallClass('judging', 44_999)).toBeNull();
    expect(StatusStrip.computeStallClass('retrying', 44_999)).toBeNull();
    expect(StatusStrip.computeStallClass('tool', 59_999)).toBeNull();
    expect(StatusStrip.computeStallClass('working', 59_999)).toBeNull();
  });

  it('returns stall class at or above threshold', () => {
    expect(StatusStrip.computeStallClass('thinking', 30_000)).toBe('agent-status-stall');
    expect(StatusStrip.computeStallClass('judging', 45_000)).toBe('agent-status-stall');
    expect(StatusStrip.computeStallClass('retrying', 60_000)).toBe('agent-status-stall');
    expect(StatusStrip.computeStallClass('tool', 60_000)).toBe('agent-status-stall');
    expect(StatusStrip.computeStallClass('working', 61_000)).toBe('agent-status-stall');
  });

  it('returns null for unknown kinds', () => {
    expect(StatusStrip.computeStallClass('unknown', 999_999)).toBeNull();
    expect(StatusStrip.computeStallClass('', 999_999)).toBeNull();
  });

  it('returns null for non-finite elapsed values', () => {
    expect(StatusStrip.computeStallClass('thinking', Number.NaN)).toBeNull();
    expect(StatusStrip.computeStallClass('thinking', Number.POSITIVE_INFINITY)).toBeNull();
    expect(StatusStrip.computeStallClass('thinking', 'not a number' as unknown as number)).toBeNull();
  });

  it('exposes thresholds map', () => {
    expect(StatusStrip.STALL_THRESHOLDS_MS.thinking).toBe(30_000);
    expect(StatusStrip.STALL_THRESHOLDS_MS.judging).toBe(45_000);
    expect(StatusStrip.STALL_THRESHOLDS_MS.retrying).toBe(45_000);
    expect(StatusStrip.STALL_THRESHOLDS_MS.tool).toBe(60_000);
    expect(StatusStrip.STALL_THRESHOLDS_MS.working).toBe(60_000);
  });
});

describe('status-strip / formatElapsedSec', () => {
  it('returns floor of seconds since startedAt', () => {
    const now = () => 10_500;
    expect(StatusStrip.formatElapsedSec(8_000, now)).toBe('2s');
    expect(StatusStrip.formatElapsedSec(10_000, now)).toBe('0s');
  });

  it('clamps negative diffs to 0s', () => {
    expect(StatusStrip.formatElapsedSec(5_000, () => 3_000)).toBe('0s');
  });

  it('falls back to Date.now() when no override given', () => {
    const startedAt = Date.now() - 1_500;
    const out = StatusStrip.formatElapsedSec(startedAt);
    expect(out).toMatch(/^\d+s$/);
  });
});

describe('status-strip / capAppendText', () => {
  it('returns concatenation when total is under max', () => {
    expect(StatusStrip.capAppendText('abc', 'def', 100, 50)).toBe('abcdef');
  });

  it('returns tail slice of keepChars when total exceeds max', () => {
    const current = 'x'.repeat(10);
    const incoming = 'y'.repeat(20);
    // total=30, max=25 → trim to keepChars=8 tail
    const out = StatusStrip.capAppendText(current, incoming, 25, 8);
    expect(out.length).toBe(8);
    expect(out).toBe('y'.repeat(8));
  });

  it('preserves tail content (not head) when truncating', () => {
    const current = 'AAAA';
    const incoming = 'BBBBCCCC';
    const out = StatusStrip.capAppendText(current, incoming, 8, 4);
    expect(out).toBe('CCCC');
  });

  it('handles 512KB/256KB thresholds used by the thinking transcript', () => {
    const MAX = 512 * 1024;
    const KEEP = 256 * 1024;
    const current = 'a'.repeat(MAX - 10);
    const incoming = 'b'.repeat(50);
    const out = StatusStrip.capAppendText(current, incoming, MAX, KEEP);
    // total (MAX+40) exceeds MAX → tail slice of KEEP
    expect(out.length).toBe(KEEP);
    // Tail preserved: last 50 chars should be the newest `b`s
    expect(out.slice(-50)).toBe('b'.repeat(50));
  });

  it('is a no-op at exactly max length (boundary)', () => {
    const current = 'a'.repeat(99);
    const incoming = 'b';
    const out = StatusStrip.capAppendText(current, incoming, 100, 50);
    expect(out.length).toBe(100);
    expect(out.endsWith('b')).toBe(true);
  });

  it('tolerates non-string inputs defensively', () => {
    expect(StatusStrip.capAppendText(null as unknown as string, 'x', 10, 5)).toBe('x');
    expect(StatusStrip.capAppendText('x', undefined as unknown as string, 10, 5)).toBe('x');
    expect(StatusStrip.capAppendText(null as unknown as string, null as unknown as string, 10, 5)).toBe('');
  });
});
