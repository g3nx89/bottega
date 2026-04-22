import { rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { launchApp } from '../helpers/launch.mjs';

/** @type {import('@playwright/test').ElectronApplication | undefined} */
let app;
/** @type {import('@playwright/test').Page | undefined} */
let window;
/** @type {string | undefined} */
let stateDir;

async function seedCheckpoint(page, fileKey, overrides = {}) {
  return page.evaluate(
    async ([nextFileKey, nextOverrides]) => {
      await window.api.createTab(nextFileKey, 'Rewind Smoke');
      await window.api.__testSeedRewindCheckpoint({
        fileKey: nextFileKey,
        prompt: 'seed checkpoint',
        ...nextOverrides,
      });
    },
    [fileKey, overrides],
  );
}

async function installRestoreHooks(page, undoToken = 'undo-smoke') {
  await page.evaluate((token) => {
    window.rewindController.__setTestOverrides({
      restore: (fileKey) =>
        window.api.__testSimulateRewindRestore(fileKey, {
          success: true,
          restoredMutations: 1,
          skippedMutations: 0,
          undoToken: token,
        }),
      undoRestore: (fileKey) =>
        window.api.__testSimulateRewindUndo(fileKey, {
          success: true,
          restoredMutations: 1,
          skippedMutations: 0,
        }),
    });
  }, undoToken);
}

test.beforeEach(async () => {
  ({ app, window, stateDir } = await launchApp({
    env: {
      BOTTEGA_AGENT_TEST: '1',
      BOTTEGA_TEST_MOCK_AUTH: '1',
      BOTTEGA_SKIP_RESTORE: '1',
    },
  }));
  await window.evaluate(() => window.api.__testResetMetrics());
});

test.afterEach(async () => {
  if (window) {
    try {
      await window.evaluate(() => window.api.__testResetMetrics());
    } catch {}
  }
  if (app) {
    await app.close();
  }
  app = undefined;
  window = undefined;
  if (stateDir) {
    rmSync(stateDir, { recursive: true, force: true });
  }
  stateDir = undefined;
});

test.describe('rewind modal smoke', () => {
  test('shows the footer chip and opens the modal list', async () => {
    await expect(window.locator('#rewind-chip')).toBeHidden();
    await seedCheckpoint(window, 'rewind-chip-file');
    await expect(window.locator('#rewind-chip')).toBeVisible();
    await expect(window.locator('#rewind-count')).toHaveText('1');

    await window.click('#rewind-chip');
    await expect(window.locator('#rewind-overlay')).toBeVisible();
    await expect(window.locator('.rewind-item')).toHaveCount(1);
  });

  test('restore shows a success toast and increments rewind restore metrics', async () => {
    await seedCheckpoint(window, 'rewind-restore-file');
    await installRestoreHooks(window);

    await window.click('#rewind-chip');
    await window.click('.rewind-restore');

    await expect(window.locator('.rewind-toast')).toContainText('Restored 1 mutation');
    await expect(window.locator('#rewind-undo-btn')).toBeVisible();

    const metrics = await window.evaluate(() => window.api.__testGetMetrics());
    expect(metrics.rewind.restoreCompleted).toBe(1);
  });

  test('undo last rewind shows a toast and increments rewind undo metrics', async () => {
    await seedCheckpoint(window, 'rewind-undo-file');
    await installRestoreHooks(window, 'undo-smoke-2');

    await window.click('#rewind-chip');
    await window.click('.rewind-restore');
    await expect(window.locator('#rewind-undo-btn')).toBeVisible();

    await window.click('#rewind-undo-btn');
    await expect(window.locator('.rewind-toast')).toContainText('Undo restored 1 mutation');

    const metrics = await window.evaluate(() => window.api.__testGetMetrics());
    expect(metrics.rewind.undoRestore.success).toBe(1);
  });

  test('plugin outdated disables the chip and updates the tooltip', async () => {
    await window.evaluate(async () => {
      await window.api.createTab('rewind-outdated-file', 'Rewind Smoke');
      await window.api.__testEmitRewindPluginOutdated('rewind-outdated-file');
    });

    await expect(window.locator('#rewind-chip')).toBeVisible();
    await expect(window.locator('#rewind-chip')).toHaveClass(/disabled/);
    await expect(window.locator('#rewind-chip')).toHaveAttribute('title', /update the Figma plugin/i);
  });

  test('executeTouched checkpoint renders non-restorable badge and disables the restore button', async () => {
    await seedCheckpoint(window, 'rewind-exec-file', {
      executeTouched: true,
      restorableCount: 0,
      nonRestorableCount: 2,
      prompt: 'paint then execute',
    });

    await window.click('#rewind-chip');
    await expect(window.locator('.rewind-item')).toHaveCount(1);
    const item = window.locator('.rewind-item').first();
    await expect(item).toHaveClass(/non-restorable/);
    await expect(item.locator('.badge-non-restorable')).toHaveText('Non-restorable');
    await expect(item.locator('.rewind-restore')).toBeDisabled();
    await expect(item.locator('.rewind-restore')).toHaveAttribute(
      'title',
      /arbitrary code execution and cannot be restored/i,
    );

    // Clicking the item body (not the button) surfaces the explanatory toast.
    await item.locator('.rewind-item-main').click();
    await expect(window.locator('.rewind-toast')).toContainText('figma_execute');
  });

  test('partial checkpoint shows Partial badge alongside restorable count', async () => {
    await seedCheckpoint(window, 'rewind-partial-file', {
      restorableCount: 1,
      nonRestorableCount: 1,
    });

    await window.click('#rewind-chip');
    const item = window.locator('.rewind-item').first();
    await expect(item.locator('.badge-partial')).toHaveText('Partial');
    await expect(item.locator('.badge-restorable')).toHaveText('1 restorable');
    await expect(item.locator('.rewind-restore')).toBeEnabled();
  });

  test('checkpoints render newest-first regardless of seed order', async () => {
    const baseTime = Date.now() - 60_000;
    await window.evaluate(async (ts) => {
      await window.api.createTab('rewind-order-file', 'Rewind Order');
      await window.api.__testSeedRewindCheckpoint({
        fileKey: 'rewind-order-file',
        prompt: 'oldest',
        timestamp: ts,
      });
      await window.api.__testSeedRewindCheckpoint({
        fileKey: 'rewind-order-file',
        prompt: 'newest',
        timestamp: ts + 20_000,
      });
      await window.api.__testSeedRewindCheckpoint({
        fileKey: 'rewind-order-file',
        prompt: 'middle',
        timestamp: ts + 10_000,
      });
    }, baseTime);

    await window.click('#rewind-chip');
    await expect(window.locator('.rewind-item')).toHaveCount(3);
    // Poll rather than a one-shot read — rewind:checkpoint-added events are
    // delivered asynchronously and can arrive after the overlay is rendered.
    await expect
      .poll(async () => window.locator('.rewind-item .rewind-prompt').allTextContents())
      .toEqual(['newest', 'middle', 'oldest']);
  });

  test('restore failure surfaces an error toast and does not arm the undo button', async () => {
    await seedCheckpoint(window, 'rewind-fail-file');
    await window.evaluate(() => {
      window.rewindController.__setTestOverrides({
        restore: (fileKey) =>
          window.api.__testSimulateRewindRestore(fileKey, {
            success: false,
            restoredMutations: 0,
            skippedMutations: 0,
            error: 'Boom from test',
          }),
      });
    });

    await window.click('#rewind-chip');
    await window.click('.rewind-restore');

    await expect(window.locator('.rewind-toast')).toContainText('Boom from test');
    await expect(window.locator('#rewind-undo-btn')).toBeHidden();

    const metrics = await window.evaluate(() => window.api.__testGetMetrics());
    expect(metrics.rewind.restoreCompleted).toBe(0);
  });

  test('Escape closes the modal and restores aria-hidden on the overlay', async () => {
    await seedCheckpoint(window, 'rewind-escape-file');
    await window.click('#rewind-chip');
    await expect(window.locator('#rewind-overlay')).toBeVisible();
    await expect(window.locator('#rewind-overlay')).toHaveAttribute('aria-hidden', 'false');

    await window.keyboard.press('Escape');
    await expect(window.locator('#rewind-overlay')).toBeHidden();
    await expect(window.locator('#rewind-overlay')).toHaveAttribute('aria-hidden', 'true');
  });

  test('switching the active fileKey swaps the checkpoint list in isolation', async () => {
    // app.js auto-binds the rewindController whenever a tab is created or switched.
    // To make this test deterministic, seed both fileKeys first, then flip via
    // a helper that awaits the resulting bind before resolving.
    async function bindAndSettle(fileKey) {
      await window.evaluate(async (key) => {
        await window.rewindController.bindActiveFileKey(key);
      }, fileKey);
      // After bind completes, syncChip has already run — poll the controller
      // state to confirm the renderer observed the switch before the next step.
      await expect
        .poll(async () => window.evaluate(() => window.rewindController.__getState().activeFileKey))
        .toBe(fileKey);
    }

    await window.evaluate(async () => {
      await window.api.createTab('rewind-multi-a', 'File A');
      await window.api.createTab('rewind-multi-b', 'File B');
      await window.api.__testSeedRewindCheckpoint({ fileKey: 'rewind-multi-a', prompt: 'only on A' });
    });

    await bindAndSettle('rewind-multi-a');
    await expect(window.locator('#rewind-chip')).toBeVisible();
    await expect(window.locator('#rewind-count')).toHaveText('1');

    await bindAndSettle('rewind-multi-b');
    await expect(window.locator('#rewind-chip')).toBeHidden();

    await bindAndSettle('rewind-multi-a');
    await expect(window.locator('#rewind-chip')).toBeVisible();
    await expect(window.locator('#rewind-count')).toHaveText('1');
    await window.click('#rewind-chip');
    await expect(window.locator('.rewind-item .rewind-prompt')).toHaveText('only on A');
  });
});
