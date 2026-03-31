---
name: bottega-dev-debug
description: Launch, inspect, and debug the running Bottega Electron app — take screenshots, read console/logs, interact with UI elements, check WebSocket bridge, and verify fixes. Use this skill PROACTIVELY whenever the task involves running the app at runtime rather than just editing code. Triggers include "lancia l'app", "run the app", "debug this", "check if it works", "test it", "launch and see", "fammi vedere la UI", "inspect the app", "prova l'app", "reproduce the bug", "verifica che funziona", "prendi uno screenshot", "controlla i log", "l'app crasha", "schermata bianca", "blank screen", "console error", "the app crashes", "check the settings panel", "verify my changes work". Do NOT use for writing tests (use bottega-testing), adding tools (use bottega-tools), architecture questions (use bottega-architecture), CI/CD (use bottega-cicd), or code refactoring without runtime verification.
---

# Bottega Dev Debug

Interactively launch, inspect, debug, and fix the Bottega Electron app.

## Fast Paths

Choose the recipe that matches your task. Each includes exact commands — run them in order.

### "Check if the app works" / "Show me the UI"
```bash
npm run build
node .claude/skills/bottega-dev-debug/scripts/inspect.mjs
```
Then Read `/tmp/bottega-screenshot.png` to see the UI. Inspector handles singleton lock cleanup, launch, DOM dump, console check, screenshot, and cleanup automatically.

### "Debug an error / crash / issue"
```bash
npm run build
node .claude/skills/bottega-dev-debug/scripts/inspect.mjs --output-json /tmp/report.json
node .claude/skills/bottega-dev-debug/scripts/analyze-logs.mjs
```
Inspector checks live state; log analyzer parses `~/Library/Logs/Bottega/app.log` and categorizes all FATAL/ERROR/WARN entries. For deeper source tracing, grep the error message across `src/`.

### "Test a UI interaction" (settings, input, buttons)
Write a custom Playwright script using the template in "Custom Scripts" below. The template includes singleton lock cleanup and proper lifecycle management.

## Bundled Scripts

| Script | What it does |
|--------|-------------|
| `scripts/inspect.mjs` | Launch app, dump DOM/API/console state, screenshot, cleanup |
| `scripts/analyze-logs.mjs` | Parse pino JSON logs, group errors by pattern, show recent stacks |

Inspector options: `--screenshot <path>` (default: `/tmp/bottega-screenshot.png`), `--output-json <path>`
Log analyzer options: `--last N` (only last N lines), `--json` (machine-readable output)

## Custom Scripts

For interactive testing (clicking, typing, verifying UI flows), write a Playwright script with this template:

```javascript
import { _electron as electron } from '@playwright/test';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// Clear singleton locks
const appSupport = join(process.env.HOME, 'Library/Application Support/Electron');
for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
  try { if (existsSync(join(appSupport, f))) unlinkSync(join(appSupport, f)); } catch {}
}

const app = await electron.launch({
  args: ['dist/main.js'],
  cwd: '/Users/afato/Projects/bottega',
  timeout: 30_000,
  env: { ...process.env, BOTTEGA_TEST_MODE: '1' },
});
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(2000);

// --- Your code here ---

await app.close();
```

Save to `/tmp/bottega-test.mjs`, run with `node /tmp/bottega-test.mjs`.

### Common patterns

**Settings open/close** — click `#settings-btn` to open; click `#settings-close` (NOT `#settings-btn`) to close — the overlay intercepts pointer events when open. Verify via `#settings-overlay` `.hidden` class.

**Screenshot an element** — `await page.locator('#settings-panel').screenshot({ path: '/tmp/closeup.png' })`

**Main process info** — `await app.evaluate(async ({ app, BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())`

**Send a message** — `await page.fill('#input-field', 'text'); await page.press('#input-field', 'Enter');`

**Create a tab** — `await page.evaluate(() => window.api.createTab())`

## Log Analysis

Logs are at `~/Library/Logs/Bottega/app.log` in pino JSON format. Level numbers: 30=info, 40=warn, 50=error, 60=fatal. Run the bundled analyzer first — only do manual grep if you need to trace a specific error to source.

To trace errors to source: search the `msg` or `err.stack` text with Grep across `src/`. Key source files: `src/figma/websocket-server.ts` (WS events), `src/main/index.ts` (lifecycle), `src/main/ipc-handlers.ts` (IPC), `src/main/safe-send.ts` (IPC guard).

Known recurring issues (not current-session bugs):
- "Another Bottega instance is already running" — singleton lock, WARN
- "Object has been destroyed" — shutdown race condition, FATAL (real bug)
- "Plugin source not found" — bridge plugin path resolution, ERROR
- "Auto-update channel file missing" — expected in dev, WARN

## Fix & Rebuild

| Changed | Action |
|---------|--------|
| `src/renderer/*` | `npm run build` then `page.reload()` |
| `src/main/*` or `preload.ts` | `npm run build` + full relaunch |
| `package.json` | `npm install` + build + relaunch |

After fixing, verify: screenshot, `npx tsc --noEmit`, `npm test`.

## WebSocket Bridge

Quick check: `node -e "const ws=new(require('ws'))('ws://127.0.0.1:9280');const t=setTimeout(()=>{console.log('TIMEOUT');process.exit(1)},3000);ws.on('open',()=>{console.log('WS OK');clearTimeout(t);ws.close()});ws.on('error',e=>{console.log('WS ERROR:',e.message);clearTimeout(t);process.exit(1)})"`

Without Figma Desktop + Bridge plugin, status shows "Disconnected" — expected in dev. For deeper WS debug, use the `debug-ws` skill.

## DOM Selectors

`#status-dot` (.connected/.disconnected), `#input-field`, `#send-btn`, `#settings-btn` (.active when open), `#settings-overlay` (.hidden when closed), `#settings-panel` (for closeup screenshots), `#settings-close`, `#model-select`, `#context-label`, `#app-title`, `.tab-item`, `.tab-dot`, `.message`, `.user-message`, `.agent-message`

## Cleanup

```bash
pkill -f "electron.*dist/main" 2>/dev/null
```
