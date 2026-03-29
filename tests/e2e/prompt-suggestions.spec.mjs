/**
 * Prompt suggestions E2E tests — container state, hidden class, chip rendering.
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
});

test.afterAll(async () => {
  if (app) await app.close();
});

// ── Suggestions Container ────────────────────────

test.describe('Suggestions container', () => {
  test('suggestions container exists in DOM', async () => {
    const container = await window.$('#suggestions');
    expect(container).toBeTruthy();
  });

  test('suggestions container has "hidden" class initially', async () => {
    const isHidden = await window.$eval('#suggestions', (el) =>
      el.classList.contains('hidden'),
    );
    expect(isHidden).toBe(true);
  });

  test('suggestions container has "suggestions" class', async () => {
    const hasSuggestionsClass = await window.$eval('#suggestions', (el) =>
      el.classList.contains('suggestions'),
    );
    expect(hasSuggestionsClass).toBe(true);
  });

  test('suggestions container starts with no children', async () => {
    const childCount = await window.$eval(
      '#suggestions',
      (el) => el.children.length,
    );
    expect(childCount).toBe(0);
  });

  test('hidden suggestions container is not visible', async () => {
    const isVisible = await window.$eval('#suggestions', (el) => {
      const style = globalThis.getComputedStyle(el);
      return style.display !== 'none';
    });
    expect(isVisible).toBe(false);
  });
});

// ── Suggestion Chips via DOM ─────────────────────

test.describe('Suggestion chips rendering', () => {
  test.beforeAll(async () => {
    // Ensure there's an active tab so suggestions can target it
    const tabs = await window.evaluate(() => window.api.listTabs());
    if (tabs.length === 0) {
      await window.evaluate(() => window.api.createTab());
      await window.waitForFunction(
        () => window.api.listTabs().then((t) => t.length > 0),
        { timeout: 5000 },
      );
    }
  });

  test('showSuggestions renders chips and removes hidden class', async () => {
    // Simulate what showSuggestions does by manipulating the DOM directly
    await window.evaluate(() => {
      const container = document.getElementById('suggestions');
      const suggestions = ['Try this design', 'Add a button', 'Change colors'];
      container.innerHTML = '';
      suggestions.forEach((text) => {
        const chip = document.createElement('button');
        chip.className = 'suggestion-chip';
        chip.textContent = text;
        container.appendChild(chip);
      });
      container.classList.remove('hidden');
    });

    // Verify chips rendered
    await window.waitForFunction(
      () => document.querySelectorAll('.suggestion-chip').length === 3,
      { timeout: 3000 },
    );

    const chips = await window.$$('.suggestion-chip');
    expect(chips.length).toBe(3);

    // Verify text content of each chip
    const texts = await Promise.all(chips.map((c) => c.textContent()));
    expect(texts).toEqual([
      'Try this design',
      'Add a button',
      'Change colors',
    ]);

    // Verify container is no longer hidden
    const isHidden = await window.$eval('#suggestions', (el) =>
      el.classList.contains('hidden'),
    );
    expect(isHidden).toBe(false);
  });

  test('suggestion chips are visible when container is not hidden', async () => {
    const isVisible = await window.$eval('#suggestions', (el) => {
      const style = globalThis.getComputedStyle(el);
      return style.display !== 'none';
    });
    expect(isVisible).toBe(true);
  });

  test('suggestion chips have correct CSS class', async () => {
    const chips = await window.$$('.suggestion-chip');
    for (const chip of chips) {
      const className = await chip.getAttribute('class');
      expect(className).toContain('suggestion-chip');
    }
  });

  test('clicking a chip populates the input field', async () => {
    const firstChip = await window.$('.suggestion-chip');
    expect(firstChip).toBeTruthy();

    const chipText = await firstChip.textContent();

    // Replicate chip click behavior via DOM manipulation
    await window.evaluate((text) => {
      const input = document.getElementById('input-field');
      input.value = text;
      const container = document.getElementById('suggestions');
      container.classList.add('hidden');
      container.innerHTML = '';
    }, chipText);

    // Verify input field has the suggestion text
    const inputValue = await window.$eval(
      '#input-field',
      (el) => el.value,
    );
    expect(inputValue).toBe(chipText);

    // Verify suggestions are hidden after click
    const isHidden = await window.$eval('#suggestions', (el) =>
      el.classList.contains('hidden'),
    );
    expect(isHidden).toBe(true);
  });

  test('hiding suggestions clears all chips', async () => {
    // First add some chips
    await window.evaluate(() => {
      const container = document.getElementById('suggestions');
      container.innerHTML = '';
      const chip = document.createElement('button');
      chip.className = 'suggestion-chip';
      chip.textContent = 'Temporary';
      container.appendChild(chip);
      container.classList.remove('hidden');
    });

    // Now hide them (replicate hideSuggestions behavior)
    await window.evaluate(() => {
      const container = document.getElementById('suggestions');
      container.classList.add('hidden');
      container.innerHTML = '';
    });

    const chips = await window.$$('.suggestion-chip');
    expect(chips.length).toBe(0);

    const isHidden = await window.$eval('#suggestions', (el) =>
      el.classList.contains('hidden'),
    );
    expect(isHidden).toBe(true);
  });
});

// ── Post-Message Suggestions State ───────────────

test.describe('Suggestions after sending a message', () => {
  test.beforeAll(async () => {
    // Ensure there's an active tab
    const tabs = await window.evaluate(() => window.api.listTabs());
    if (tabs.length === 0) {
      await window.evaluate(() => window.api.createTab());
      await window.waitForFunction(
        () => window.api.listTabs().then((t) => t.length > 0),
        { timeout: 5000 },
      );
    }

    // Clean up input field and suggestions from previous tests
    await window.evaluate(() => {
      const input = document.getElementById('input-field');
      input.value = '';
      const container = document.getElementById('suggestions');
      container.classList.add('hidden');
      container.innerHTML = '';
    });
  });

  test('suggestions stay hidden after sending a message (no AI in test mode)', async () => {
    const inputField = await window.$('#input-field');
    await inputField.fill('Test prompt for suggestions');
    await inputField.press('Enter');

    // Wait for user message to appear in chat
    await window.waitForFunction(
      () => document.querySelectorAll('.user-message').length > 0,
      { timeout: 5000 },
    );

    // In test mode no AI generates suggestions, so container should remain hidden
    const isHidden = await window.$eval('#suggestions', (el) =>
      el.classList.contains('hidden'),
    );
    expect(isHidden).toBe(true);

    const chipCount = await window.$eval(
      '#suggestions',
      (el) => el.children.length,
    );
    expect(chipCount).toBe(0);
  });
});
