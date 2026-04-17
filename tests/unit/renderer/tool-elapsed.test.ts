import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const StatusStrip = require('../../../src/renderer/status-strip.js') as {
  attachElapsedTimer: (
    card: any,
    opts?: {
      createElement?: (tag: string) => any;
      now?: () => number;
      tickMs?: number;
      showAfterMs?: number;
      stallThresholdMs?: number;
      setInterval?: typeof setInterval;
      clearInterval?: typeof clearInterval;
      setTimeout?: typeof setTimeout;
      clearTimeout?: typeof clearTimeout;
    },
  ) => { detach: () => void; elapsedEl: any; tick: () => void };
  STALL_THRESHOLDS_MS: Record<string, number>;
};

type FakeElement = {
  tagName: string;
  children: FakeElement[];
  parentNode: FakeElement | null;
  className: string;
  classList: { list: Set<string>; add: (c: string) => void; contains: (c: string) => boolean };
  style: Record<string, string>;
  _textContent: string;
  textContent: string;
  appendChild: (child: FakeElement) => FakeElement;
  removeChild: (child: FakeElement) => FakeElement;
  // Set by attachElapsedTimer for legacy cleanup in completeToolCard.
  _elapsedTimer?: ReturnType<typeof setInterval> | null;
  _elapsedShowTimeout?: ReturnType<typeof setTimeout> | null;
};

function makeElement(tag: string): FakeElement {
  const el: FakeElement = {
    tagName: tag,
    children: [],
    parentNode: null,
    className: '',
    classList: {
      list: new Set<string>(),
      add(c) {
        this.list.add(c);
      },
      contains(c) {
        return this.list.has(c);
      },
    },
    style: {},
    _textContent: '',
    get textContent() {
      return this._textContent;
    },
    set textContent(v: string) {
      this._textContent = String(v);
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      const idx = this.children.indexOf(child);
      if (idx >= 0) {
        this.children.splice(idx, 1);
        child.parentNode = null;
      }
      return child;
    },
  };
  return el;
}

describe('status-strip / attachElapsedTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a hidden tool-elapsed span on attach', () => {
    const card = makeElement('div');
    const { elapsedEl } = StatusStrip.attachElapsedTimer(card, {
      createElement: makeElement,
      now: () => 0,
    });

    expect(card.children).toHaveLength(1);
    expect(elapsedEl.className).toBe('tool-elapsed');
    expect(elapsedEl.style.display).toBe('none');
    expect(elapsedEl.textContent).toBe('');
  });

  it('reveals the span after showAfterMs and updates every tickMs', () => {
    const card = makeElement('div');
    let clock = 0;
    const ctrl = StatusStrip.attachElapsedTimer(card, {
      createElement: makeElement,
      now: () => clock,
      showAfterMs: 3000,
      tickMs: 1000,
      stallThresholdMs: 60_000,
    });

    // Before showAfterMs → still hidden.
    clock = 1500;
    vi.advanceTimersByTime(1000);
    expect(ctrl.elapsedEl.style.display).toBe('none');
    expect(ctrl.elapsedEl.textContent).toBe('1s');

    clock = 3500;
    vi.advanceTimersByTime(2000); // triggers both tick + show timeout
    expect(ctrl.elapsedEl.style.display).toBe('');
    expect(ctrl.elapsedEl.textContent).toBe('3s');

    clock = 10_000;
    vi.advanceTimersByTime(7000);
    expect(ctrl.elapsedEl.textContent).toBe('10s');
  });

  it('adds tool-elapsed-stall class once elapsed crosses threshold', () => {
    const card = makeElement('div');
    let clock = 0;
    const ctrl = StatusStrip.attachElapsedTimer(card, {
      createElement: makeElement,
      now: () => clock,
      stallThresholdMs: 5000,
      tickMs: 1000,
      showAfterMs: 0,
    });

    clock = 4000;
    vi.advanceTimersByTime(4000);
    expect(ctrl.elapsedEl.classList.contains('tool-elapsed-stall')).toBe(false);

    clock = 5100;
    vi.advanceTimersByTime(1000);
    expect(ctrl.elapsedEl.classList.contains('tool-elapsed-stall')).toBe(true);
  });

  it('detach clears interval/timeout and removes the span', () => {
    const card = makeElement('div');
    const ctrl = StatusStrip.attachElapsedTimer(card, {
      createElement: makeElement,
      now: () => Date.now(),
    });

    expect(card.children).toHaveLength(1);
    expect(card._elapsedTimer).toBeTruthy();
    expect(card._elapsedShowTimeout).toBeTruthy();

    ctrl.detach();

    expect(card.children).toHaveLength(0);
    expect(card._elapsedTimer).toBeNull();
    expect(card._elapsedShowTimeout).toBeNull();
  });

  it('tick() forces a manual counter update without waiting for interval', () => {
    const card = makeElement('div');
    let clock = 0;
    const ctrl = StatusStrip.attachElapsedTimer(card, {
      createElement: makeElement,
      now: () => clock,
    });

    clock = 7500;
    ctrl.tick();
    expect(ctrl.elapsedEl.textContent).toBe('7s');
  });

  it('uses injected setInterval / clearInterval implementations', () => {
    const card = makeElement('div');
    const setIntervalSpy = vi.fn(() => 42 as unknown as NodeJS.Timeout);
    const clearIntervalSpy = vi.fn();
    const setTimeoutSpy = vi.fn(() => 43 as unknown as NodeJS.Timeout);
    const clearTimeoutSpy = vi.fn();

    const ctrl = StatusStrip.attachElapsedTimer(card, {
      createElement: makeElement,
      now: () => 0,
      setInterval: setIntervalSpy as unknown as typeof setInterval,
      clearInterval: clearIntervalSpy as unknown as typeof clearInterval,
      setTimeout: setTimeoutSpy as unknown as typeof setTimeout,
      clearTimeout: clearTimeoutSpy as unknown as typeof clearTimeout,
    });

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setTimeoutSpy).toHaveBeenCalledTimes(1);

    ctrl.detach();

    expect(clearIntervalSpy).toHaveBeenCalledWith(42);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(43);
  });

  it('falls back to STALL_THRESHOLDS_MS.tool when stallThresholdMs omitted', () => {
    const card = makeElement('div');
    let clock = 0;
    const ctrl = StatusStrip.attachElapsedTimer(card, {
      createElement: makeElement,
      now: () => clock,
      tickMs: 1000,
      showAfterMs: 0,
    });

    clock = StatusStrip.STALL_THRESHOLDS_MS.tool - 1;
    vi.advanceTimersByTime(clock);
    expect(ctrl.elapsedEl.classList.contains('tool-elapsed-stall')).toBe(false);

    clock = StatusStrip.STALL_THRESHOLDS_MS.tool;
    vi.advanceTimersByTime(1000);
    expect(ctrl.elapsedEl.classList.contains('tool-elapsed-stall')).toBe(true);
  });

  it('throws when card argument is missing', () => {
    expect(() => StatusStrip.attachElapsedTimer(null as unknown as FakeElement)).toThrow(/card required/);
  });
});
