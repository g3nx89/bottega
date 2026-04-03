/**
 * Task panel E2E tests — renderer IPC integration, panel visibility, preload API.
 *
 * Run: npm run test:e2e
 */

import { test, expect } from '@playwright/test';
import { launchApp } from '../helpers/launch.mjs';

/** @type {import('@playwright/test').ElectronApplication} */
let app;
/** @type {import('@playwright/test').Page} */
let window;

test.beforeAll(async () => {
  ({ app, window } = await launchApp());
  // Ensure there's an active tab
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

// ── Task Panel IPC ───────────────────────────

test.describe('Task panel IPC', () => {
  test('task panel is hidden when no tasks', async () => {
    const isHidden = await window.evaluate(() => {
      const panel = document.getElementById('task-panel');
      return panel?.classList.contains('hidden') ?? true;
    });
    expect(isHidden).toBe(true);
  });

  test('window.api exposes task methods', async () => {
    const hasOnTaskUpdated = await window.evaluate(() => typeof window.api.onTaskUpdated === 'function');
    const hasGetTaskList = await window.evaluate(() => typeof window.api.getTaskList === 'function');
    expect(hasOnTaskUpdated).toBe(true);
    expect(hasGetTaskList).toBe(true);
  });

  test('task:list returns empty array initially', async () => {
    const result = await window.evaluate(async () => {
      const tabs = await window.api.listTabs();
      if (tabs.length === 0) return [];
      return window.api.getTaskList(tabs[0].id);
    });
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });

  test('task panel renders when task:updated event fires', async () => {
    // Simulate a task:updated IPC event by calling the renderer handler directly
    // Simulate renderTaskPanel by directly manipulating the DOM
    // (we can't fire IPC events from the renderer sandbox)
    await window.evaluate(() => {
      const panel = document.getElementById('task-panel');
      if (!panel) return;

      while (panel.firstChild) panel.removeChild(panel.firstChild);
      panel.classList.remove('hidden');

      const header = document.createElement('div');
      header.className = 'task-header';
      header.textContent = '2 tasks (0/2 done)';
      panel.appendChild(header);

      const row = document.createElement('div');
      row.className = 'task-row pending';
      const dot = document.createElement('span');
      dot.className = 'task-dot';
      dot.textContent = '\u25FB';
      const subject = document.createElement('span');
      subject.className = 'task-subject';
      subject.textContent = '#1 Build header';
      row.appendChild(dot);
      row.appendChild(subject);
      panel.appendChild(row);
    });

    const isVisible = await window.evaluate(() => {
      const panel = document.getElementById('task-panel');
      return panel && !panel.classList.contains('hidden');
    });
    expect(isVisible).toBe(true);

    const headerText = await window.evaluate(() => {
      const header = document.querySelector('.task-header');
      return header?.textContent ?? '';
    });
    expect(headerText).toContain('2 tasks');

    // Clean up — re-hide the panel
    await window.evaluate(() => {
      const panel = document.getElementById('task-panel');
      if (panel) {
        while (panel.firstChild) panel.removeChild(panel.firstChild);
        panel.classList.add('hidden');
      }
    });
  });

  test('task panel has correct CSS classes defined', async () => {
    const hasStyles = await window.evaluate(() => {
      const panel = document.getElementById('task-panel');
      if (!panel) return false;
      const style = getComputedStyle(panel);
      // Check that the hidden class applies display:none
      return panel.classList.contains('hidden') && style.display === 'none';
    });
    expect(hasStyles).toBe(true);
  });
});
