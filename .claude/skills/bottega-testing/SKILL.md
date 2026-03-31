---
name: bottega-testing
description: Use when writing, running, or debugging tests for Bottega. Covers Playwright-Electron smoke tests, tool unit testing, WebSocket mock strategies, compression e2e tests, and the build-test cycle. Triggers include "write test", "run tests", "test tool", "smoke test", "e2e test", "mock WebSocket", "test compression", "playwright electron".
---

# Bottega — Testing Guide

## When to Use

- Writing tests for new or existing tools
- Running the Playwright-Electron smoke test
- Testing compression infrastructure
- Debugging test failures
- Setting up mocks for the WebSocket bridge or Pi SDK

## Test Infrastructure

```
tests/
├── electron-smoke.mjs           — Playwright-Electron smoke test (app launches, UI renders)
├── agent-pipeline.test.ts       — Agent session lifecycle tests
├── compression-e2e.test.ts      — End-to-end compression pipeline tests
├── figma-api.test.ts            — Figma REST API client tests
├── icon-loader.test.ts          — Iconify icon loading/caching tests
├── image-gen-config.test.ts     — Image generation config tests
├── ipc-handlers.test.ts         — IPC handler tests
├── jsx-parser.test.ts           — JSX→TreeNode pipeline tests
├── operation-queue.test.ts      — Mutation serializer tests
├── prompt-builders.test.ts      — Image gen prompt builder tests
├── prompt-suggester.test.ts     — Follow-up suggestion tests
├── scripted-session.test.ts     — Scripted agent session tests
├── system-prompt.test.ts        — System prompt generation tests
├── text-result.test.ts          — textResult wrapper tests
├── tools-schema.test.ts         — Tool schema validation tests
├── websocket-connector.test.ts  — WebSocket connector tests
├── websocket-server.test.ts     — WebSocket server tests
├── with-abort-check.test.ts     — Abort signal wrapper tests
├── tools/                       — Per-tool-file unit tests
│   ├── components.test.ts
│   ├── core.test.ts
│   ├── discovery.test.ts
│   ├── image-gen.test.ts
│   ├── jsx-render.test.ts
│   ├── manipulation.test.ts
│   └── tokens.test.ts
├── compression/                 — Compression module unit tests
│   ├── compression-config.test.ts
│   ├── design-system-cache.test.ts
│   ├── execute-enricher.test.ts
│   ├── extension-factory.test.ts
│   ├── metrics.test.ts
│   ├── mutation-compressor.test.ts
│   └── project-tree.test.ts
└── e2e/                         — End-to-end Playwright-Electron tests
    ├── build-smoke.spec.mjs
    └── electron-app.spec.mjs
```

## Running Tests

```bash
# All tests (unit + integration, no Electron needed)
npm test                        # vitest run

# Specific test suites
npx vitest run tests/tools/     # Tool unit tests (7 files)
npx vitest run tests/compression/ # Compression unit tests (7 files)
npx vitest run tests/compression-e2e.test.ts  # Compression e2e

# Smoke test (requires built app + display)
node scripts/build.mjs && node tests/electron-smoke.mjs

# Type check (catches most issues without running)
npx tsc --noEmit

# Lint
npm run lint                    # biome check src/ tests/

# Debug mode (attach DevTools or Playwright)
npx electron --remote-debugging-port=9222 dist/main.js
```

## Test Categories

### 1. Playwright-Electron Smoke Tests

The smoke test (`tests/electron-smoke.mjs`) verifies the app launches and the basic UI renders. Uses `@playwright/test`'s Electron support:

```javascript
const { _electron: electron } = require('playwright');

// Launch the built app
const app = await electron.launch({
  args: ['dist/main.js'],
});

// Get the main window
const window = await app.firstWindow();

// Verify UI loaded
await window.waitForSelector('.chat-container');
const title = await window.title();
assert(title.includes('Bottega'));

await app.close();
```

**Key patterns:**
- Always build first (`node scripts/build.mjs`)
- Use `app.firstWindow()` to get the BrowserWindow
- The app starts a WebSocket server on port 9223 — tests that need Figma must mock the bridge
- Use timeouts for WS connection (the app waits for Figma Desktop Bridge)

### 2. Tool Unit Tests

Tools can be tested by mocking the connector and operationQueue:

```typescript
import { describe, it, expect, vi } from 'vitest';

// Mock connector
const mockConnector = {
  setNodeFills: vi.fn().mockResolvedValue({ success: true }),
  executeCodeViaUI: vi.fn().mockResolvedValue('{"success":true}'),
  captureScreenshot: vi.fn().mockResolvedValue({ image: { base64: 'abc' } }),
  // ... add methods as needed
};

// Mock operation queue (execute fn immediately)
const mockQueue = {
  execute: vi.fn(async (fn) => fn()),
};

// Mock deps
const deps = {
  connector: mockConnector as any,
  operationQueue: mockQueue as any,
  wsServer: { isClientConnected: () => true, getConnectedFileInfo: () => ({}) } as any,
  figmaAPI: {} as any,
};

// Import and create tools
import { createManipulationTools } from '../src/main/tools/manipulation.js';
const tools = createManipulationTools(deps);

describe('figma_set_fills', () => {
  const tool = tools.find(t => t.name === 'figma_set_fills')!;

  it('should call connector with nodeId and fills', async () => {
    const fills = [{ type: 'SOLID', color: '#FF0000' }];
    await tool.execute('call-1', { nodeId: '1:2', fills }, undefined, undefined, undefined);

    expect(mockConnector.setNodeFills).toHaveBeenCalledWith('1:2', fills);
    expect(mockQueue.execute).toHaveBeenCalled();
  });
});
```

**Key patterns:**
- Mock `operationQueue.execute` to run fn immediately (bypass serialization in tests)
- Mock connector methods relevant to the tool under test
- Test the tool found via `tools.find(t => t.name === 'tool_name')`
- Verify connector was called with correct params
- Verify result matches `textResult()` format

### 3. WebSocket Bridge Mocking

For integration tests that need to simulate the Figma Desktop Bridge:

```typescript
import { WebSocket, WebSocketServer } from 'ws';

// Create a fake Figma plugin bridge
const fakePlugin = new WebSocketServer({ port: 9223 });

fakePlugin.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    // Simulate plugin responses based on command type
    if (msg.type === 'EXECUTE_CODE') {
      ws.send(JSON.stringify({
        id: msg.id,
        type: 'RESULT',
        result: JSON.stringify({ success: true }),
      }));
    }

    if (msg.type === 'SCREENSHOT') {
      ws.send(JSON.stringify({
        id: msg.id,
        type: 'RESULT',
        result: { image: { base64: 'fake-png-data', format: 'PNG' } },
      }));
    }
  });

  // Simulate file connection event
  ws.send(JSON.stringify({
    type: 'FILE_CONNECTED',
    fileKey: 'abc123',
    fileName: 'Test File',
  }));
});

// Cleanup
afterAll(() => fakePlugin.close());
```

**Key patterns:**
- Start the fake WS server BEFORE creating FigmaCore
- Match the message protocol (id-based correlation for request/response)
- Simulate `FILE_CONNECTED` to trigger the `fileConnected` event
- Always clean up the server in `afterAll`

### 4. Compression Tests

Compression modules are pure functions/classes — easy to unit test without Electron:

```typescript
import { CompressionConfigManager } from '../src/main/compression/compression-config.js';
import { DesignSystemCache } from '../src/main/compression/design-system-cache.js';
import { projectTree } from '../src/main/compression/project-tree.js';

describe('projectTree', () => {
  it('should project tree at minimal detail', () => {
    const tree = {
      id: '1:1', type: 'FRAME', name: 'Container',
      children: [{ id: '1:2', type: 'TEXT', name: 'Title', characters: 'Hello' }],
    };
    const projected = projectTree(tree, 'minimal');
    // Verify minimal output excludes layout details
  });
});

describe('DesignSystemCache', () => {
  it('should cache and return within TTL', () => {
    const cache = new DesignSystemCache(60000);
    cache.set({ variables: [], components: [] });
    expect(cache.get(false)).toEqual({ variables: [], components: [] });
  });

  it('should invalidate on demand', () => {
    const cache = new DesignSystemCache(60000);
    cache.set({ variables: [], components: [] });
    cache.invalidate();
    expect(cache.get(false)).toBeNull();
  });
});
```

### 5. JSX Parser Tests

Test the JSX→TreeNode pipeline independently:

```typescript
import { parseJsx } from '../src/main/jsx-parser.js';

describe('parseJsx', () => {
  it('should parse simple frame', () => {
    const tree = parseJsx('<Frame w={100} h={50} bg="#FF0000" name="Test" />');
    expect(tree.type).toBe('frame');
    expect(tree.props.w).toBe(100);
    expect(tree.props.bg).toBe('#FF0000');
  });

  it('should parse nested elements', () => {
    const tree = parseJsx(`
      <Frame flex="col" gap={8}>
        <Text fontSize={16}>Hello</Text>
        <Rectangle w={100} h={2} bg="#EEE" />
      </Frame>
    `);
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].type).toBe('text');
  });

  it('should handle Icon elements', () => {
    const tree = parseJsx('<Icon name="mdi:home" size={24} />');
    expect(tree.type).toBe('icon');
    expect(tree.props.name).toBe('mdi:home');
  });
});
```

### 6. IPC Handler Tests

Test IPC handlers by mocking Electron's ipcMain and BrowserWindow:

```typescript
const mockWebContents = { send: vi.fn() };
const mockWindow = { webContents: mockWebContents, isAlwaysOnTop: () => false, setAlwaysOnTop: vi.fn() };

const mockSession = {
  prompt: vi.fn(),
  abort: vi.fn(),
  subscribe: vi.fn(),
};

// Capture registered handlers
const handlers: Record<string, Function> = {};
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: Function) => { handlers[channel] = handler; },
  },
  shell: { openExternal: vi.fn() },
}));

// Now call setupIpcHandlers and test individual channels
setupIpcHandlers(mockSession, mockWindow as any, mockInfra);

// Test
await handlers['agent:prompt'](null, 'Design a button');
expect(mockSession.prompt).toHaveBeenCalledWith('Design a button');
```

## Build-Test Cycle

```bash
# 1. Make changes to source
# 2. Build (fast — esbuild)
node scripts/build.mjs

# 3. Type check
npx tsc --noEmit

# 4. Unit tests
npm test

# 5. Smoke test (requires display for Electron)
node tests/electron-smoke.mjs

# 6. Manual test: launch and verify
npx electron dist/main.js
```

## Playwright-Electron Advanced Patterns

### Electron Test Fixture (Reusable)

Create a shared fixture for all Electron tests:

```typescript
// tests/fixtures/electron.ts
import { test as base, _electron as electron, ElectronApplication, Page } from '@playwright/test';

type ElectronFixtures = {
  electronApp: ElectronApplication;
  window: Page;
};

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const electronApp = await electron.launch({
      args: ['dist/main.js'],
      env: { ...process.env, NODE_ENV: 'test' },
    });
    await use(electronApp);
    await electronApp.close();
  },
  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    await use(window);
  },
});

export { expect } from '@playwright/test';
```

### Testing Main Process via electronApp.evaluate()

Access Electron main process APIs directly from tests:

```typescript
import { test, expect } from './fixtures/electron';

test('check window properties', async ({ electronApp }) => {
  const bounds = await electronApp.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return win.getBounds();
  });
  expect(bounds.width).toBe(480);
  expect(bounds.height).toBe(720);
});

test('window is not always-on-top by default', async ({ electronApp }) => {
  const isOnTop = await electronApp.evaluate(async ({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].isAlwaysOnTop();
  });
  expect(isOnTop).toBe(false);
});
```

### Testing Preload API (window.api)

Verify the contextBridge exposed API works end-to-end:

```typescript
test('window.api is exposed', async ({ window }) => {
  const apiKeys = await window.evaluate(() => {
    return Object.keys((window as any).api);
  });
  expect(apiKeys).toContain('sendPrompt');
  expect(apiKeys).toContain('onTextDelta');
  expect(apiKeys).toContain('togglePin');
});
```

### Testing IPC Round-Trips via Playwright

Test IPC from renderer → main → renderer:

```typescript
test('toggle pin via IPC', async ({ electronApp, window }) => {
  // Call via preload API
  const isPinned = await window.evaluate(async () => {
    return await (window as any).api.togglePin();
  });
  expect(isPinned).toBe(true);

  // Verify in main process
  const isOnTop = await electronApp.evaluate(async ({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].isAlwaysOnTop();
  });
  expect(isOnTop).toBe(true);
});
```

### Mock IPC Handlers in Main Process

Override specific IPC handlers for test isolation:

```typescript
test('mock agent prompt for testing', async ({ electronApp, window }) => {
  // Replace the real agent:prompt handler with a mock
  await electronApp.evaluate(async ({ ipcMain }) => {
    ipcMain.removeHandler('agent:prompt');
    ipcMain.handle('agent:prompt', async (_event, text) => {
      // Simulate instant response without real LLM call
      const win = require('electron').BrowserWindow.getAllWindows()[0];
      win.webContents.send('agent:text-delta', `Echo: ${text}`);
      win.webContents.send('agent:end');
    });
  });

  // Now test the UI interaction
  await window.evaluate(async () => {
    await (window as any).api.sendPrompt('test message');
  });

  // Verify renderer received the mocked response
  await expect(window.locator('.message-content')).toContainText('Echo: test message');
});
```

### WebSocket Monitoring in Playwright

For tests that exercise the real WebSocket bridge:

```typescript
test('monitor WS messages to Figma bridge', async ({ window }) => {
  const wsMessages: string[] = [];

  // Intercept WebSocket frames in the renderer
  window.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      wsMessages.push(frame.payload as string);
    });
    ws.on('framereceived', (frame) => {
      wsMessages.push(frame.payload as string);
    });
  });

  // Trigger an action that sends a WS command
  // ...

  // Verify the expected WS traffic
  await expect.poll(() => wsMessages.length).toBeGreaterThan(0);
});
```

### WebSocket Mock Fixture for Figma Bridge

Replace the real Figma bridge with a mock in Playwright tests:

```typescript
// tests/fixtures/mock-figma-bridge.ts
import { WebSocketServer } from 'ws';

export function createMockFigmaBridge(port = 9224) {
  const commands: any[] = [];

  const wss = new WebSocketServer({ port });
  wss.on('connection', (ws) => {
    // Auto-connect a fake file
    ws.send(JSON.stringify({
      type: 'FILE_CONNECTED',
      fileKey: 'test-file-key',
      fileName: 'Test Design',
    }));

    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      commands.push(msg);

      // Auto-respond to common commands
      const response = { id: msg.id, type: 'RESULT' };

      switch (msg.type) {
        case 'EXECUTE_CODE':
          ws.send(JSON.stringify({ ...response, result: '{"success":true}' }));
          break;
        case 'SCREENSHOT':
          ws.send(JSON.stringify({
            ...response,
            result: { image: { base64: 'iVBOR...', format: 'PNG' } },
          }));
          break;
        default:
          ws.send(JSON.stringify({ ...response, result: '{"ok":true}' }));
      }
    });
  });

  return {
    server: wss,
    getCommands: () => [...commands],
    close: () => new Promise<void>((resolve) => wss.close(() => resolve())),
  };
}
```

### Connection Loss & Reconnection Testing

Test the app's behavior when the Figma bridge disconnects:

```typescript
test('shows disconnected state when bridge drops', async ({ window }) => {
  // Verify initially connected
  await expect(window.locator('.figma-status')).toContainText('Connected');

  // Kill the mock bridge to simulate disconnect
  await mockBridge.close();

  // Verify UI shows disconnected state
  await expect(window.locator('.figma-status')).toContainText('Disconnected');
});
```

## Debugging Test Failures

### Playwright Trace Viewer

When smoke tests fail in CI:

```bash
# Enable traces
PWDEBUG=1 node tests/electron-smoke.mjs

# View trace file
npx playwright show-trace test-results/trace.zip
```

### Playwright Config for Traces

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  retries: process.env.CI ? 2 : 0,
  use: {
    trace: 'on-first-retry',    // capture trace on retry
    screenshot: 'only-on-failure',
  },
});
```

### Debug Assertions

Use Playwright's auto-retry assertions (NOT manual waits):

```typescript
// CORRECT — auto-retries until timeout
await expect(window.locator('.chat-container')).toBeVisible();
await expect(window.locator('.message')).toContainText('Done');

// WRONG — snapshot, no retry
const text = await window.locator('.message').textContent();
expect(text).toContain('Done');  // fails immediately if not ready

// WRONG — arbitrary wait
await window.waitForTimeout(3000);  // never use in tests
```

## QA Methodology for Electron App Testing

Adapted from battle-tested interactive QA workflows. Follow this process for any non-trivial UI change.

### QA Inventory (Define BEFORE Testing)

Before running any tests, build a coverage inventory from three sources:

1. **User requirements** — what the user explicitly asked for
2. **Implemented features** — what you actually changed/built
3. **Claims you'll make** — what you'll say works in the final response

For each item, note:
- The **functional check** needed (what to click/type, what should happen)
- The **visual state** where verification matters (initial view, after interaction, error state)
- The **evidence** to capture (screenshot, assertion, metric)

```
Example inventory for "added window pin toggle":
┌─────────────────────┬──────────────────────┬──────────────────┐
│ Item                │ Functional Check     │ Visual Check     │
├─────────────────────┼──────────────────────┼──────────────────┤
│ Pin button exists   │ locator visible      │ screenshot       │
│ Pin toggles on      │ click → isOnTop=true │ icon changes     │
│ Pin toggles off     │ click → isOnTop=false│ icon reverts     │
│ Pin persists on top │ focus other window   │ app stays above  │
│ Edge: rapid toggle  │ click 5x fast        │ no crash         │
└─────────────────────┴──────────────────────┴──────────────────┘
```

### Reload vs Relaunch Decision Tree

After making code changes, choose the correct reload strategy:

```
What did you change?
│
├─ Renderer only (app.js, styles.css, index.html)
│  → Reload: appWindow.reload({ waitUntil: 'domcontentloaded' })
│  → Keep same Electron process and session alive
│
├─ Main process (agent.ts, ipc-handlers.ts, tools/*, figma-core.ts)
│  → Relaunch: electronApp.close() → electron.launch() → firstWindow()
│  → Main process code is loaded once at startup
│
├─ Preload script (preload.ts)
│  → Relaunch: preload executes once per window creation
│  → ALSO rebuild first (preload is CJS, separate build target)
│
├─ Build config (scripts/build.mjs)
│  → Full rebuild + relaunch
│
├─ System prompt (system-prompt.ts)
│  → Relaunch: prompt is injected at AgentSession creation
│
└─ Unsure what's affected?
   → Relaunch (safe default — never guess)
```

In Playwright-Electron tests:

```typescript
// Renderer-only reload (fast, keeps state)
await appWindow.reload({ waitUntil: 'domcontentloaded' });

// Full relaunch (after main/preload/build changes)
await electronApp.close();
electronApp = await electron.launch({ args: ['dist/main.js'] });
appWindow = await electronApp.firstWindow();
await appWindow.waitForLoadState('domcontentloaded');
```

### Functional QA Checklist

Run through the inventory using **real user input** (click, type, keyboard):

- [ ] Verify at least one end-to-end critical flow works (e.g., type prompt → agent responds → tool cards appear)
- [ ] For each control in the inventory: test the full cycle (initial → changed → back to initial)
- [ ] Confirm visible results, not just internal state — use `expect(locator)` not `evaluate()`
- [ ] `window.evaluate()` and `electronApp.evaluate()` may stage state, but they don't count as functional verification
- [ ] After scripted checks pass, do a 30-second exploratory pass with normal input
- [ ] If exploratory pass reveals new behavior, add it to the inventory and test it

```typescript
// GOOD — tests real user interaction
test('send prompt via chat input', async ({ window }) => {
  await window.locator('.chat-input').fill('Design a button');
  await window.locator('.send-button').click();
  await expect(window.locator('.agent-message')).toBeVisible();
});

// NOT SUFFICIENT alone — bypasses UI
test('prompt via IPC', async ({ window }) => {
  await window.evaluate(async () => {
    await (window as any).api.sendPrompt('Design a button');
  });
  // This tests IPC, not the UI flow
});
```

### Visual QA Checklist

Run as a **separate pass** from functional QA:

- [ ] Inspect the initial viewport BEFORE any interaction
- [ ] Each user-visible claim has a matching screenshot from the specific state where it matters
- [ ] Check for: clipping, overflow, distortion, layout imbalance, inconsistent spacing, weak contrast, broken layering
- [ ] For the macOS-native window: verify `vibrancy`, traffic light position, `hiddenInset` title bar look correct
- [ ] If the app has dark mode: test in both light and dark appearances
- [ ] Judge aesthetic quality, not just correctness — the UI should feel intentional and coherent

```typescript
test('initial window renders correctly', async ({ electronApp, window }) => {
  // Check window dimensions match spec
  const bounds = await electronApp.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0].getBounds();
  });
  expect(bounds.width).toBe(480);
  expect(bounds.height).toBe(720);

  // Visual screenshot for manual review
  await window.screenshot({ path: 'tests/screenshots/initial-view.png' });

  // Verify key UI elements are visible and not clipped
  await expect(window.locator('.chat-container')).toBeVisible();
  await expect(window.locator('.input-area')).toBeVisible();
  await expect(window.locator('.header')).toBeVisible();
});
```

### Viewport Fit Checks

Verify the initial view isn't clipped or overflowing:

```typescript
test('no unexpected overflow in initial view', async ({ window }) => {
  const metrics = await window.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    canScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    canScrollY: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));

  // Chat app should not have horizontal scroll
  expect(metrics.canScrollX).toBe(false);

  // Vertical scroll is expected (chat messages), but check it's not extreme
  if (metrics.canScrollY) {
    expect(metrics.scrollHeight).toBeLessThan(metrics.innerHeight * 3);
  }
});
```

For specific regions (e.g., input area must not be clipped):

```typescript
test('input area is fully visible', async ({ window }) => {
  const inputBounds = await window.evaluate(() => {
    const el = document.querySelector('.input-area');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  });

  expect(inputBounds).not.toBeNull();
  expect(inputBounds!.bottom).toBeLessThanOrEqual(
    await window.evaluate(() => window.innerHeight)
  );
});
```

### Signoff Checklist

Before considering a feature complete:

- [ ] **Build passes**: `node scripts/build.mjs` exits 0
- [ ] **Types pass**: `npx tsc --noEmit` exits 0
- [ ] **Unit tests pass**: `npx vitest run` (if applicable)
- [ ] **Functional QA**: every inventory item has a passing check with real user input
- [ ] **Visual QA**: every user-visible claim has a matching screenshot and was inspected
- [ ] **Viewport fit**: initial view renders without clipping or unintended scroll
- [ ] **Exploratory pass**: 30-second manual exploration found no new issues
- [ ] **Cleanup**: test sessions closed, no zombie Electron processes

### Common Electron + Playwright Failure Modes

| Symptom | Cause | Fix |
|---------|-------|-----|
| `electron.launch()` hangs | Wrong entry path or missing build | Verify `dist/main.js` exists. Run `node scripts/build.mjs` first |
| `firstWindow()` never resolves | Window creation fails silently | Check main process logs. Add `env: { ELECTRON_ENABLE_LOGGING: '1' }` to launch options |
| `appWindow.reload()` shows blank page | Preload or CSP error after reload | Check DevTools console. May need full relaunch instead |
| Screenshot is blank/white | Window not fully rendered | Add `await window.waitForLoadState('domcontentloaded')` before screenshot |
| Port 9223 already in use | Previous test didn't clean up WS server | Use `lsof -ti :9223 \| xargs kill` before test, or use mock on different port |
| `evaluate()` returns undefined | Async function didn't return | Ensure `return` in the evaluate callback |
| Window size wrong in CI | No display server on Linux | Use `xvfb-run` or macOS runner |
| Test passes locally, fails in CI | Timing differences | Use auto-retry `expect(locator)` assertions, never `waitForTimeout` |

## Testing Anti-Patterns

- **Testing through the real Figma Desktop Bridge** — the bridge requires Figma Desktop running with the plugin active. Mock it for CI.
- **Not building before smoke tests** — `dist/` must be fresh. Always `node scripts/build.mjs` first.
- **Testing OperationQueue concurrency in unit tests** — the queue is a simple mutex. Test the tool's logic, not the queue's serialization.
- **Importing ESM modules in CJS test context** — use `vitest` (ESM-native) not `jest` for testing ESM source files.
- **Hardcoding port 9223** — the WS server uses this port. Tests that spin up their own server must use a different port or close the server between suites.
- **Using `page.waitForTimeout()`** — always use `expect(locator).toBeVisible()` or similar auto-retry assertions.
- **Not closing ElectronApplication** — always call `electronApp.close()` in cleanup or use the fixture pattern above.
- **Navigating with `page.goto()` in Electron tests** — the app is already loaded. Use `electronApp.evaluate()` and `window.evaluate()` instead.
- **Not mocking native dialogs** — native dialogs block the test. Mock via `electronApp.evaluate()` if the app uses `dialog.showOpenDialog()` etc.
