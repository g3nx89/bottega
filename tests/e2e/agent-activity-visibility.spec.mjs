/**
 * Agent activity visibility E2E tests.
 *
 * Verifies the renderer surfaces that make the agent's current activity
 * visible to the user:
 *   - Persistent status strip (thinking / quality check / retrying)
 *   - Tool card elapsed timer (generalized across all tools)
 *   - Collapsible thinking transcript (accumulates thinking_delta text)
 *   - Stall warning class when phase elapsed exceeds threshold
 *   - Stuck-bubble guard regression (late events must not re-create strip)
 *   - Per-tab isolation for multi-slot sessions
 *
 * Pattern: launch Electron, inject IPC events from main via webContents.send,
 * assert DOM state in the renderer — no real agent turn is started so tests
 * stay deterministic and sub-2-second each.
 *
 * Run: npm run test:e2e
 */

import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch.mjs';

/** @type {import('@playwright/test').ElectronApplication} */
let app;
/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
  // Ensure at least one tab exists.
  const tabs = await window.evaluate(() => window.api.listTabs());
  if (tabs.length === 0) {
    await window.evaluate(() => window.api.createTab());
    await window.waitForFunction(
      () => window.api.listTabs().then((t) => t.length > 0),
      { timeout: 5000 },
    );
  }
});

test.afterAll(async () => {
  if (app) await app.close();
});

/** Send an IPC message from main to the focused renderer with variadic args. */
async function sendFromMain(channel, args) {
  await app.evaluate(
    ({ BrowserWindow }, payload) => {
      const wins = BrowserWindow.getAllWindows();
      const win = wins[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send(payload.channel, ...payload.args);
      }
    },
    { channel, args },
  );
}

/** Flip isStreaming on a slot so our handler guards allow the status strip. */
async function setStreaming(slotId, streaming) {
  await window.evaluate(
    ({ id, s }) => {
      // @ts-ignore
      const tab = window.__bottegaTabs?.get?.(id);
      if (tab) tab.isStreaming = s;
    },
    { id: slotId, s: streaming },
  );
}

/** Reset DOM between scenarios — clear chat container + status/thinking state. */
async function resetTab(slotId) {
  await window.evaluate((id) => {
    // @ts-ignore
    const tab = window.__bottegaTabs?.get?.(id);
    if (!tab) return;
    tab.isStreaming = false;
    if (tab.status) {
      clearInterval(tab.status.timer);
      tab.status.el.remove();
      tab.status = null;
    }
    if (tab.thinking) {
      tab.thinking.buffer.dispose();
      tab.thinking = null;
    }
    if (tab.chatContainer) {
      while (tab.chatContainer.firstChild) tab.chatContainer.removeChild(tab.chatContainer.firstChild);
    }
    tab.currentAssistantBubble = null;
  }, slotId);
}

async function getActiveSlotId() {
  const id = await window.evaluate(() => {
    // @ts-ignore
    return window.__bottegaActiveTabId ?? null;
  });
  return id;
}

test.describe('agent-activity-visibility', () => {
  test('StatusStrip global exposes pure helpers', async () => {
    const shape = await window.evaluate(() => ({
      hasPickLabel: typeof window.StatusStrip?.pickLabel === 'function',
      hasBuffer: typeof window.StatusStrip?.createThinkingBuffer === 'function',
      hasStall: typeof window.StatusStrip?.computeStallClass === 'function',
    }));
    expect(shape).toEqual({ hasPickLabel: true, hasBuffer: true, hasStall: true });
  });

  test('status strip appears with Thinking label on agent:thinking', async () => {
    const slotId = await getActiveSlotId();
    await resetTab(slotId);
    await setStreaming(slotId, true);

    await sendFromMain('agent:thinking', [slotId, 'hello from the model']);
    await window.waitForSelector('[data-testid="agent-status-strip"]', { timeout: 2000 });

    const label = await window.textContent('[data-testid="agent-status-label"]');
    expect(label).toBe('Thinking');
    const elapsed = await window.textContent('[data-testid="agent-status-elapsed"]');
    expect(elapsed).toMatch(/^\d+s$/);

    await resetTab(slotId);
  });

  test('status strip switches label to Quality check on judge:running', async () => {
    const slotId = await getActiveSlotId();
    await resetTab(slotId);
    await setStreaming(slotId, true);

    await sendFromMain('agent:thinking', [slotId, 'warming up']);
    await window.waitForSelector('[data-testid="agent-status-strip"]');
    await sendFromMain('judge:running', [slotId]);

    await expect(window.locator('[data-testid="agent-status-label"]')).toHaveText('Quality check', {
      timeout: 1500,
    });
    const kind = await window.getAttribute('[data-testid="agent-status-strip"]', 'data-kind');
    expect(kind).toBe('judging');

    await resetTab(slotId);
  });

  test('status strip shows Retrying (N/M) on judge:retry-start', async () => {
    const slotId = await getActiveSlotId();
    await resetTab(slotId);
    await setStreaming(slotId, true);

    await sendFromMain('judge:running', [slotId]);
    await window.waitForSelector('[data-testid="agent-status-strip"]');
    await sendFromMain('judge:retry-start', [slotId, 1, 2]);

    await expect(window.locator('[data-testid="agent-status-label"]')).toHaveText('Retrying (1/2)', {
      timeout: 1500,
    });

    await resetTab(slotId);
  });

  test('status strip is removed on agent:end', async () => {
    const slotId = await getActiveSlotId();
    await resetTab(slotId);
    await setStreaming(slotId, true);

    await sendFromMain('agent:thinking', [slotId, 'x']);
    await window.waitForSelector('[data-testid="agent-status-strip"]');

    // Flip isStreaming off BEFORE agent:end so the handler's internal cleanup
    // path runs (it reads tab.isStreaming to branch, but removeThinkingIndicator
    // is unconditional).
    await sendFromMain('agent:end', [slotId]);
    await window.waitForFunction(
      () => !document.querySelector('[data-testid="agent-status-strip"]'),
      { timeout: 2000 },
    );

    await resetTab(slotId);
  });

  test('stuck-bubble guard: late thinking after agent:end does not re-create strip', async () => {
    const slotId = await getActiveSlotId();
    await resetTab(slotId);
    await setStreaming(slotId, true);

    await sendFromMain('agent:thinking', [slotId, 'turn 1']);
    await window.waitForSelector('[data-testid="agent-status-strip"]');
    await sendFromMain('agent:end', [slotId]);
    await window.waitForFunction(
      () => !document.querySelector('[data-testid="agent-status-strip"]'),
    );

    // Straggler thinking_delta after turn finalized — must be ignored.
    await sendFromMain('agent:thinking', [slotId, 'late straggler']);
    await window.waitForTimeout(150);
    const present = await window.locator('[data-testid="agent-status-strip"]').count();
    expect(present).toBe(0);

    await resetTab(slotId);
  });

  test('tool elapsed timer shows after 3s and clears on tool-end', async () => {
    const slotId = await getActiveSlotId();
    await resetTab(slotId);
    await setStreaming(slotId, true);

    // Assistant bubble must exist before tool card appends into it.
    await window.evaluate((id) => {
      // @ts-ignore
      const tab = window.__bottegaTabs?.get?.(id);
      if (tab) tab.currentAssistantBubble = null;
    }, slotId);

    await sendFromMain('agent:tool-start', [slotId, 'figma_execute', 'tc-1']);
    await window.waitForSelector('[data-testid="tool-card"]');

    // Element is present immediately but display: none until 3s.
    await window.waitForFunction(
      () => {
        const el = document.querySelector('.tool-card .tool-elapsed');
        if (!el) return false;
        const style = getComputedStyle(el);
        return style.display !== 'none' && /^\d+s$/.test(el.textContent || '');
      },
      { timeout: 5000 },
    );

    await sendFromMain('agent:tool-end', [slotId, 'figma_execute', 'tc-1', true, { ok: true }]);
    await window.waitForFunction(
      () => !document.querySelector('.tool-card .tool-elapsed'),
      { timeout: 2000 },
    );

    await resetTab(slotId);
  });

  test('thinking transcript accumulates delta text in collapsed details', async () => {
    const slotId = await getActiveSlotId();
    await resetTab(slotId);
    await setStreaming(slotId, true);

    await sendFromMain('agent:thinking', [slotId, 'First chunk. ']);
    await sendFromMain('agent:thinking', [slotId, 'Second chunk. ']);
    await sendFromMain('agent:thinking', [slotId, 'Third chunk.']);

    await window.waitForSelector('[data-testid="thinking-transcript"]');
    // Default closed — no `open` attribute.
    const isOpen = await window.evaluate(
      () => document.querySelector('[data-testid="thinking-transcript"]')?.hasAttribute('open') ?? false,
    );
    expect(isOpen).toBe(false);

    // Wait for debounce flush (50ms) + small buffer.
    await window.waitForFunction(
      () => {
        const el = document.querySelector('[data-testid="thinking-transcript-content"]');
        return el && el.textContent?.includes('Third chunk.');
      },
      { timeout: 1000 },
    );
    const text = await window.textContent('[data-testid="thinking-transcript-content"]');
    expect(text).toBe('First chunk. Second chunk. Third chunk.');

    await resetTab(slotId);
  });

  const STALL_PHASES = [
    { kind: 'thinking', trigger: ['agent:thinking', (id) => [id, 'hmm']] },
    { kind: 'judging', trigger: ['judge:running', (id) => [id]] },
    { kind: 'retrying', trigger: ['judge:retry-start', (id) => [id, 1, 2]] },
  ];

  for (const { kind, trigger } of STALL_PHASES) {
    test(`stall class applied when ${kind} elapsed exceeds threshold`, async () => {
      const slotId = await getActiveSlotId();
      await resetTab(slotId);
      await setStreaming(slotId, true);

      const [channel, payloadFn] = trigger;
      await sendFromMain(channel, payloadFn(slotId));
      await window.waitForSelector('[data-testid="agent-status-strip"]');

      await window.evaluate(
        ({ id, phaseKind }) => {
          // @ts-ignore
          const tab = window.__bottegaTabs?.get?.(id);
          if (!tab?.status) return;
          const threshold = window.StatusStrip?.STALL_THRESHOLDS_MS?.[phaseKind] ?? 30_000;
          tab.status.startedAt = Date.now() - (threshold + 1_000);
        },
        { id: slotId, phaseKind: kind },
      );

      await window.waitForFunction(
        () =>
          document
            .querySelector('[data-testid="agent-status-strip"]')
            ?.classList.contains('agent-status-stall'),
        { timeout: 2000 },
      );

      await resetTab(slotId);
    });
  }

  test('status strip is isolated per tab', async () => {
    const tabCount = await window.evaluate(() => window.api.listTabs().then((t) => t.length));
    if (tabCount < 2) {
      await window.evaluate(() => window.api.createTab());
      await window.waitForFunction(
        () => window.api.listTabs().then((t) => t.length >= 2),
        { timeout: 5000 },
      );
    }

    const ids = await window.evaluate(() => window.api.listTabs().then((t) => t.map((x) => x.id)));
    const [slotA, slotB] = ids;

    await resetTab(slotA);
    await resetTab(slotB);
    await setStreaming(slotA, true);
    await setStreaming(slotB, true);

    await sendFromMain('agent:thinking', [slotA, 'only A thinks']);
    await window.waitForTimeout(200);

    const stripsInA = await window.evaluate((id) => {
      // @ts-ignore
      const tab = window.__bottegaTabs?.get?.(id);
      return tab?.chatContainer?.querySelectorAll('[data-testid="agent-status-strip"]').length ?? 0;
    }, slotA);
    const stripsInB = await window.evaluate((id) => {
      // @ts-ignore
      const tab = window.__bottegaTabs?.get?.(id);
      return tab?.chatContainer?.querySelectorAll('[data-testid="agent-status-strip"]').length ?? 0;
    }, slotB);

    expect(stripsInA).toBe(1);
    expect(stripsInB).toBe(0);

    await resetTab(slotA);
    await resetTab(slotB);
  });
});
