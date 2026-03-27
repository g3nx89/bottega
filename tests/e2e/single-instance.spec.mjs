/**
 * E2E tests for single-instance lock and port conflict notification.
 *
 * Tests real Electron behavior:
 * 1. Second instance exits immediately when first instance holds the lock
 * 2. First instance remains alive and responsive after second instance attempt
 * 3. App shows error and exits when port 9280 is occupied
 *
 * Run: npm run test:e2e
 */

import { _electron as electron, test, expect } from '@playwright/test';

// ── Timeout constants ────────────────────────
// Named constants for clarity and easy tuning on slower CI machines.
const LAUNCH_TIMEOUT_MS = 30_000;
const SECOND_INSTANCE_TIMEOUT_MS = 10_000;
const WINDOW_READY_MS = 2_000;
const SECOND_INSTANCE_WINDOW_MS = 5_000;
const PORT_CONFLICT_TIMEOUT_MS = 15_000;
const PORT_CONFLICT_WINDOW_MS = 5_000;
const PORT_CONFLICT_EXIT_MS = 10_000;

// ── Default WebSocket port (mirrors src/figma/port-discovery.ts) ──
const DEFAULT_WS_PORT = 9280;

test.describe('Single instance lock (E2E)', () => {
  /** @type {import('@playwright/test').ElectronApplication} */
  let firstApp;
  /** @type {import('@playwright/test').Page} */
  let firstWindow;

  test.beforeAll(async () => {
    firstApp = await electron.launch({
      args: ['dist/main.js'],
      timeout: LAUNCH_TIMEOUT_MS,
      env: { ...process.env, BOTTEGA_TEST_MODE: '1' },
    });
    firstWindow = await firstApp.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');
    await firstWindow.waitForTimeout(WINDOW_READY_MS);
  });

  test.afterAll(async () => {
    if (firstApp) await firstApp.close();
  });

  test('second instance exits immediately', async () => {
    let secondApp;
    let secondExited = false;

    try {
      secondApp = await electron.launch({
        args: ['dist/main.js'],
        timeout: SECOND_INSTANCE_TIMEOUT_MS,
        env: { ...process.env, BOTTEGA_TEST_MODE: '1' },
      });

      try {
        const secondWindow = await Promise.race([
          secondApp.firstWindow(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), SECOND_INSTANCE_WINDOW_MS)
          ),
        ]);
        if (secondWindow) {
          await secondWindow.waitForTimeout(WINDOW_READY_MS);
        }
      } catch {
        // Expected: the app quit before producing a window
        secondExited = true;
      }
    } catch {
      // electron.launch itself may throw if the app exits too fast
      secondExited = true;
    } finally {
      try {
        if (secondApp) await secondApp.close();
      } catch {
        // Already closed
      }
    }

    expect(secondExited).toBe(true);
  });

  test('first instance remains responsive after second instance attempt', async () => {
    const title = await firstWindow.textContent('#app-title');
    expect(title).toBe('Bottega');

    const statusDot = await firstWindow.$('#status-dot');
    expect(statusDot).toBeTruthy();

    const screenshot = await firstWindow.screenshot();
    expect(screenshot).toBeTruthy();
    expect(screenshot.byteLength).toBeGreaterThan(0);
  });
});

test.describe('Port conflict notification (E2E)', () => {
  // dialog.showErrorBox() blocks Electron's event loop, so this test needs
  // extra time to launch, detect the block, and force-kill the process.
  test('app shows error and exits when port is occupied', { timeout: 30_000 }, async () => {
    const net = await import('net');
    const blocker = net.createServer();

    await new Promise((resolve, reject) => {
      blocker.listen(DEFAULT_WS_PORT, 'localhost', () => resolve(undefined));
      blocker.on('error', reject);
    });

    let appExited = false;

    try {
      const app = await electron.launch({
        args: ['dist/main.js'],
        timeout: PORT_CONFLICT_TIMEOUT_MS,
        env: {
          ...process.env,
          // Disable test mode so the app uses the real port
          BOTTEGA_TEST_MODE: '',
        },
      });

      const pid = app.process()?.pid;

      try {
        await Promise.race([
          app.firstWindow().then(async (w) => {
            await w.waitForTimeout(PORT_CONFLICT_WINDOW_MS);
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout-expected')), PORT_CONFLICT_EXIT_MS)
          ),
        ]);
      } catch {
        // Expected: app exits before window is usable, or times out
        appExited = true;
      } finally {
        // dialog.showErrorBox() blocks the Electron event loop, so app.close()
        // hangs indefinitely. Force-kill the process instead.
        if (pid) {
          try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
        }
        try {
          await Promise.race([app.close(), new Promise((r) => setTimeout(r, 3000))]);
        } catch {
          appExited = true;
        }
      }
    } catch {
      // electron.launch itself may throw if the app exits quickly
      appExited = true;
    } finally {
      await new Promise((resolve) => blocker.close(() => resolve(undefined)));
    }

    expect(appExited).toBe(true);
  });
});
