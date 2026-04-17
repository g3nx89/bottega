/**
 * Pure logic for the agent activity status strip and thinking transcript.
 *
 * Non-module script: assigns to `window.StatusStrip` for app.js consumption.
 * Also CommonJS-compatible (module.exports) so vitest can import directly
 * without a build step.
 */
((globalRef) => {
  'use strict';

  // Priority order: retrying > judging > thinking > working (fallback).
  function pickLabel(state) {
    if (state && state.retrying) {
      const { attempt, max } = state.retrying;
      return { label: 'Retrying (' + attempt + '/' + max + ')', kind: 'retrying' };
    }
    if (state && state.judging) return { label: 'Quality check', kind: 'judging' };
    if (state && state.thinking) return { label: 'Thinking', kind: 'thinking' };
    return { label: 'Working', kind: 'working' };
  }

  function createThinkingBuffer(opts) {
    const flushMs = opts && opts.flushMs != null ? opts.flushMs : 50;
    const onFlush = opts && opts.onFlush;
    const _set = (opts && opts.setTimeoutImpl) || setTimeout;
    const _clear = (opts && opts.clearTimeoutImpl) || clearTimeout;
    let buffer = '';
    let timer = null;
    let disposed = false;

    function doFlush() {
      timer = null;
      if (!buffer) return;
      const payload = buffer;
      buffer = '';
      if (onFlush) onFlush(payload);
    }

    function append(delta) {
      if (disposed) return;
      if (delta == null || delta === '') return;
      buffer += String(delta);
      if (timer != null) _clear(timer);
      timer = _set(doFlush, flushMs);
    }

    function flushNow() {
      if (disposed) return;
      if (timer != null) {
        _clear(timer);
        timer = null;
      }
      doFlush();
    }

    function dispose() {
      disposed = true;
      if (timer != null) {
        _clear(timer);
        timer = null;
      }
      buffer = '';
    }

    function pendingSize() {
      return buffer.length;
    }

    return { append, flushNow, dispose, pendingSize };
  }

  const STALL_THRESHOLDS_MS = {
    thinking: 30000,
    judging: 45000,
    retrying: 45000,
    tool: 60000,
    working: 60000,
  };

  function computeStallClass(kind, elapsedMs) {
    const threshold = STALL_THRESHOLDS_MS[kind];
    if (threshold === undefined) return null;
    if (typeof elapsedMs !== 'number' || !Number.isFinite(elapsedMs)) return null;
    return elapsedMs >= threshold ? 'agent-status-stall' : null;
  }

  function formatElapsedSec(startedAt, now) {
    const t = (typeof now === 'function' ? now() : Date.now()) - startedAt;
    if (!Number.isFinite(t) || t < 0) return '0s';
    return Math.floor(t / 1000) + 's';
  }

  // Bounded append: returns current + incoming, or the tail `keepChars` of
  // that concatenation if the total would exceed `maxChars`. Keeps the
  // thinking transcript's DOM text node from growing unbounded on long runs.
  function capAppendText(current, incoming, maxChars, keepChars) {
    const base = typeof current === 'string' ? current : '';
    const add = typeof incoming === 'string' ? incoming : '';
    const next = base + add;
    if (next.length <= maxChars) return next;
    return next.slice(next.length - keepChars);
  }

  /**
   * Attach an elapsed-time counter to a tool card element.
   * Creates a <span class="tool-elapsed"> child, keeps it hidden for the
   * first `showAfterMs` (default 3s), updates every 1s, and adds a stall
   * class once elapsed crosses the tool threshold.
   *
   * Injection points (all optional — defaults target the browser):
   *   createElement, stallThresholdMs, showAfterMs, tickMs, now,
   *   setInterval, clearInterval, setTimeout, clearTimeout
   *
   * Returns { detach, elapsedEl, tick } — `tick()` forces a manual update
   * so tests can drive the counter deterministically.
   */
  function attachElapsedTimer(card, opts) {
    if (!card) throw new Error('attachElapsedTimer: card required');
    const options = opts || {};
    const doc = options.createElement
      ? { createElement: options.createElement }
      : typeof document !== 'undefined'
        ? document
        : null;
    if (!doc) throw new Error('attachElapsedTimer: no document available');
    const now = options.now || (() => Date.now());
    const tickMs = options.tickMs != null ? options.tickMs : 1000;
    const showAfterMs = options.showAfterMs != null ? options.showAfterMs : 3000;
    const stallThreshold = options.stallThresholdMs != null ? options.stallThresholdMs : STALL_THRESHOLDS_MS.tool;
    const setIntervalImpl = options.setInterval || setInterval;
    const clearIntervalImpl = options.clearInterval || clearInterval;
    const setTimeoutImpl = options.setTimeout || setTimeout;
    const clearTimeoutImpl = options.clearTimeout || clearTimeout;

    const startTime = now();
    const elapsedEl = doc.createElement('span');
    elapsedEl.className = 'tool-elapsed';
    elapsedEl.style.display = 'none';
    card.appendChild(elapsedEl);

    function tick() {
      const ms = now() - startTime;
      const sec = Math.max(0, Math.floor(ms / 1000));
      elapsedEl.textContent = sec + 's';
      if (ms >= stallThreshold) elapsedEl.classList.add('tool-elapsed-stall');
    }

    const intervalHandle = setIntervalImpl(tick, tickMs);
    const showTimeoutHandle = setTimeoutImpl(() => {
      elapsedEl.style.display = '';
    }, showAfterMs);

    card._elapsedTimer = intervalHandle;
    card._elapsedShowTimeout = showTimeoutHandle;

    function detach() {
      clearIntervalImpl(intervalHandle);
      clearTimeoutImpl(showTimeoutHandle);
      card._elapsedTimer = null;
      card._elapsedShowTimeout = null;
      if (elapsedEl.parentNode) elapsedEl.parentNode.removeChild(elapsedEl);
    }

    return { detach, elapsedEl, tick };
  }

  const api = {
    pickLabel,
    createThinkingBuffer,
    computeStallClass,
    formatElapsedSec,
    capAppendText,
    attachElapsedTimer,
    STALL_THRESHOLDS_MS,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else if (globalRef) {
    globalRef.StatusStrip = api;
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : undefined);
