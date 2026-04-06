---
name: bottega-dev-debug
description: Launch, inspect, debug, and QA-test the running Bottega Electron app. Triggers include "lancia l'app", "run the app", "debug this", "check if it works", "test it", "testa l'app", "test the app", "prova l'app", "run qa", "esegui i test", "run test script", "list test scripts", "qa smoke", "qa full", "inspect the app", "controlla i log", "l'app crasha", "blank screen", "console error", "verify my changes work", "stabilizza l'app", "fix all bugs", "review bugs". Do NOT use for writing unit tests (use bottega-testing), adding tools (use bottega-tools), architecture questions (use bottega-architecture), CI/CD (use bottega-cicd).
---

# Bottega Dev Debug

Launch, inspect, debug, and QA-test the Bottega Electron app.

## QA Test Commands — Three-Pass Architecture

Every QA run uses three passes that produce complementary findings:

| Pass | Agent | Model | Purpose | Output |
|------|-------|-------|---------|--------|
| **Pass 1** | qa-tester | Sonnet | Functional checks (PASS/FAIL) + metadata capture | `/tmp/bottega-qa/result-NN.txt` + `/tmp/bottega-qa/NN-metadata.json` |
| **Log Monitor** | nohup process | — | Real-time log anomaly detection | `/tmp/log-monitor-report.md` |
| **Pass 2** | ux-reviewer | Opus | Qualitative UX evaluation on screenshots + metadata | `/tmp/bottega-qa/ux-review.md` |

### "qa list" / "list test scripts"
Read and display the table from `tests/qa-scripts/README.md`.

### "qa smoke" / "quick test"
Run scripts 01 + 02. Execute the three-pass pipeline (see below).

### "qa pre-release"
Run scripts 01-05 + 14. Execute the three-pass pipeline.

### "qa features" / "qa full"
Run scripts 01-16. Execute the three-pass pipeline.

### "qa stress" / "qa extended"
Run extended session scripts 20-25. Execute the three-pass pipeline.

### "run test script NN" / "esegui script NN"
Run a single script. Execute the three-pass pipeline for that script only.

---

## Three-Pass Pipeline

### Step 0: Build + Launch background monitors
```bash
npm run build

# Log monitor — anomaly detection
nohup node .claude/skills/bottega-dev-debug/scripts/log-watcher.mjs \
  --duration SECONDS --output /tmp/log-monitor-report.md \
  > /tmp/log-watcher-stdout.txt 2>&1 &
echo "LOG_PID: $!"

# QA recorder — captures tool interactions for test generation
nohup node .claude/skills/bottega-dev-debug/scripts/qa-recorder.mjs \
  --duration SECONDS --output /tmp/bottega-qa/recordings \
  > /tmp/qa-recorder-stdout.txt 2>&1 &
echo "REC_PID: $!"
```
Duration by suite: smoke=600, pre-release=2100, full=6600, stress=10200.
Verify alive: `ps -p PID`. Both auto-stop after --duration.

### Step 1: Pass 1 — Functional Testing (qa-runner.mjs)

The deterministic test runner parses test script markdown, executes steps, and produces
guaranteed metadata JSON. Launch via the qa-tester subagent which runs `qa-runner.mjs`:

```
Agent tool:
  subagent_type: "qa-tester" (oh-my-claudecode:qa-tester)
  model: "sonnet"
  run_in_background: true
  prompt: |
    Run the Bottega QA runner for the specified suite.
    The app must be built BEFORE running (npm run build already done).
    
    To enable tool call recording in logs, set the env var:
      export BOTTEGA_QA_RECORDING=1
    
    Then run the qa-runner script:
      node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --suite SUITE_NAME
    
    The runner will:
    - Parse each test script markdown
    - Launch the app, wait for Figma connection
    - Send each prompt, capture response + screenshot
    - Produce result-NN.txt (PASS/FAIL) + NN-metadata.json (for Pass 2)
    
    After the runner completes, check the output:
    - Read the OVERALL SUMMARY from stdout
    - List /tmp/bottega-qa/*.json to confirm metadata files exist
    
    Some steps are marked MANUAL (no "Send:" in the script).
    For each MANUAL step, use your judgment:
    - Read the step description from the test script
    - Interact with the app accordingly (click buttons, check UI state)
    - Record your findings
    
    Scripts: tests/qa-scripts/. Output: /tmp/bottega-qa/
    Helpers: .claude/skills/bottega-dev-debug/scripts/helpers.mjs
```

**Suite flags**: `--suite smoke`, `--suite pre-release`, `--suite full`, `--suite stress`
**Single script**: `--script 02` (or `--script 02 --script 07`)
**Options**: `--timeout 120000` (per-prompt), `--settle-ms 8000` (app launch settle)

**Output structure** (per script):
- `/tmp/bottega-qa/result-NN.txt` — PASS/FAIL/MANUAL summary
- `/tmp/bottega-qa/NN-metadata.json` — structured metadata for Pass 2
- `/tmp/bottega-qa/NN-*.png` — screenshots per step

**Metadata JSON format** (`/tmp/bottega-qa/NN-metadata.json`):
```json
[
  {
    "script": "02-happy-path",
    "step": "1. Send a simple prompt",
    "prompt": "Take a screenshot and describe what you see",
    "response": "I can see the Figma canvas with...",
    "toolCards": ["figma_status", "figma_screenshot"],
    "screenshot": "/tmp/bottega-qa/02-step-1.png",
    "passed": true,
    "timestamp": "2026-04-05T13:45:00Z",
    "evaluateCriteria": ["Does the response appear progressively?", "Is the screenshot correct?"],
    "implementationHint": null,
    "isManual": false,
    "durationMs": 7540
  }
]
```

### Step 2: Pass 2 — UX Quality Review (ux-reviewer, Opus)

**After Pass 1 completes**, launch the UX reviewer:
```
Agent tool:
  subagent_type: "general-purpose"
  model: "opus"
  prompt: |
    You are a UX QUALITY REVIEWER for the Bottega app. Your job is to evaluate
    the qualitative aspects of the QA results that automated checks cannot capture.
    
    For each script that was tested:
    1. Read the metadata JSON: /tmp/bottega-qa/NN-metadata.json
    2. Read the test script: tests/qa-scripts/NN-*.md (for the "Evaluate" criteria)
    3. For each step with a screenshot:
       a. READ the screenshot image file
       b. Evaluate against the "Evaluate" criteria from the test script
       c. Rate each dimension 1-5:
          - Visual Quality: alignment, spacing, colors, readability
          - Response Clarity: is the agent's text helpful, clear, not too verbose?
          - Tool Selection: did the agent pick appropriate tools?
          - UX Coherence: does the result match the user's intent?
          - Feedback Quality: does the user know what's happening at every moment?
    4. Note any UX issues not caught by Pass 1 (subtle visual problems,
       confusing responses, missing feedback, timing concerns)
    
    OUTPUT: Write a structured UX review to /tmp/bottega-qa/ux-review.md:
    
    # UX Quality Review
    
    ## Summary
    - Overall UX score: X/5
    - Scripts reviewed: N
    - UX issues found: N (by severity)
    
    ## Per-Script Review
    ### Script NN — Name
    **Overall: X/5**
    | Step | Visual | Clarity | Tools | UX | Feedback | Notes |
    |------|--------|---------|-------|----|----------|-------|
    | 1    | 4/5    | 5/5     | 5/5   | 4/5| 3/5     | No loading indicator |
    
    **UX Issues:**
    - [Media] Step 3: Agent response is 400 words for a simple color change — too verbose
    - [Bassa] Step 5: Screenshot shows misaligned text in the card header
    
    ## Cross-Script Patterns
    - Recurring issues across multiple scripts
    - Positive patterns worth preserving
    
    ## Recommendations
    - Prioritized UX improvements
```

### Step 3: Merge + Report

After Pass 1, log monitor, AND Pass 2 complete:
1. Read all three outputs:
   - `/tmp/bottega-qa/result-NN.txt` (functional)
   - `/tmp/log-monitor-report.md` (log anomalies)
   - `/tmp/bottega-qa/ux-review.md` (qualitative)
2. **Correlate** findings across all three channels by timestamp
3. **Classify** each finding:
   - Functional bug (Pass 1 FAIL + log evidence) → B-NNN in BUG-REPORT.md
   - UX issue (Pass 2 only) → UX-NNN in BUG-REPORT.md
   - Performance issue (log monitor slow ops) → P-NNN in BUG-REPORT.md
   - Warning (log anomaly, no user impact) → W-NNN in BUG-REPORT.md
4. **Update BUG-REPORT.md** with new findings
5. Present unified summary to user

---

### Log Monitor Details

**IMPORTANT**: The Bash tool has a 600s (10 min) max timeout. The log-watcher must run for the entire QA session (30-110 min). Launch it via `nohup` background process, NOT via a subagent Bash call:
```bash
nohup node .claude/skills/bottega-dev-debug/scripts/log-watcher.mjs --duration SECONDS --output /tmp/log-monitor-report.md > /tmp/log-watcher-stdout.txt 2>&1 &
echo "PID: $!"
```
Verify it's alive with `ps -p PID`. When the QA session ends, kill it with `kill PID` or let `--duration` auto-stop it. The report is written on exit.

The log-watcher script:
- Starts from the **current end** of `~/Library/Logs/Bottega/app.log` (ignores old entries)
- Polls every 500ms for new pino JSON log lines
- Detects 9 anomaly patterns: fatals, errors, unhandled rejections, WS disconnects, slow ops (>10s), tool errors, abort timeouts, memory warnings, "object destroyed" races
- Filters out known non-bugs (singleton lock warnings, auto-update dev warnings)
- Writes a structured report to `/tmp/log-monitor-report.md` on exit
- Auto-stops after `--duration` seconds

### CRITICAL: Sequential Execution Only
**Never run multiple qa-tester agents in parallel.**
- Singleton lock: only one Electron instance at a time (port 9280)
- Shared Figma state: Bottega-Test_A and Bottega-Test_B are mutable
- Before each script: reset session + clear Figma canvas
- The log-monitor and ux-reviewer CAN run in parallel with each other (read-only)

## After QA: Review or Auto-Fix

### "review bugs" / "mostra i risultati"
Read `/tmp/qa-results.md` and `BUG-REPORT.md`, show a summary table of all issues found with severity and status.

### "save bugs" / "salva i bug" (default behavior)
After a QA run, **always** append new findings to `BUG-REPORT.md` at the project root. Do NOT auto-fix. Present the updated bug list to the user for review.

Format per bug:
```markdown
## B-NNN: Short title

**Severita**: Alta / Media / Bassa
**Componente**: Renderer / Main / Figma
**Riproduzione**:
1. Step by step

**Root cause**: What the code does wrong (file + line)
**Fix proposto**: How to fix it
**File**: affected files
```

### "fix all bugs" / "fixa tutto" / "auto-fix"
Read `BUG-REPORT.md`, then for each bug with status "Open":
1. Investigate the root cause in the codebase
2. Implement the fix
3. Run `npm run build && npm test` to verify
4. Update the bug entry status from "Open" to "Fixed"
5. After all fixes, re-run the relevant QA scripts to confirm

### "fix B-NNN" / "fixa il bug NNN"
Fix a single specific bug from `BUG-REPORT.md`.

## QA Recordings → Test Generation

The `qa-recorder.mjs` script runs alongside the log-watcher during QA sessions and captures real tool interactions from the pino logs. After a QA run, it produces 5 artifacts in `/tmp/bottega-qa/recordings/`:

| Artifact | Content | Use for |
|----------|---------|---------|
| `tool-sequences.json` | Ordered tool chains per agent turn (prompt → tools → response) | Playbook test generation |
| `connector-fixtures.json` | Real connector params + responses, grouped by tool | Mock connector data |
| `timing-baselines.json` | p50/p90/max per tool from real usage | Performance regression thresholds |
| `playbook-drafts.json` | Auto-generated `when()/calls()/says()` DSL stubs | Copy-paste into playbook tests |
| `error-scenarios.json` | Real error cases with params and context | Error recovery tests |

### "generate tests from recordings" / "genera test dai recording"

After a QA run with recordings available:
```
1. Read /tmp/bottega-qa/recordings/playbook-drafts.json
2. For each draft, evaluate if it covers a scenario not yet in the test suite
3. Cross-reference with tests/unit/main/agent-playbook*.test.ts to avoid duplicates
4. Generate new playbook tests using the existing DSL:
   - when("prompt", [calls("tool", params), says("text")])
   - Use late-bound params (() => params) when subsequent tools depend on previous results
   - Use .chain() for result capture
5. Write new tests to tests/unit/main/agent-playbook-recorded.test.ts
```

### "update timing baselines" / "aggiorna le baseline"

```
1. Read /tmp/bottega-qa/recordings/timing-baselines.json
2. Compare with existing baselines (if any) in tests/fixtures/timing-baselines.json
3. Update thresholds: new p90 * 1.5 as max acceptable (allows variance)
4. These baselines can be used in vitest performance assertions:
   expect(toolDuration).toBeLessThan(baseline.p90 * 1.5)
```

### "update mock fixtures" / "aggiorna le fixture"

```
1. Read /tmp/bottega-qa/recordings/connector-fixtures.json
2. Compare with existing mocks in tests/helpers/mock-connector.ts
3. Update mock return values to match real connector responses
4. This ensures mocks reflect actual Figma behavior, not guesses
```

### Recording constraints
- The recorder reads only pino JSON logs — it captures what the app logs, not raw WS traffic
- Tool params with large payloads (code, JSX, SVG, base64) are truncated to `[N chars]`
- Max 5 fixture samples per tool to avoid bloat
- Max 50 playbook drafts per session
- The recorder does NOT modify any source files — it only writes to /tmp/

---

## Quick Inspect (no QA scripts)

### "check if the app works" / "show me the UI"
```bash
npm run build
node .claude/skills/bottega-dev-debug/scripts/inspect.mjs
```
Then Read `/tmp/bottega-screenshot.png`.

### "debug an error / crash"
```bash
npm run build
node .claude/skills/bottega-dev-debug/scripts/inspect.mjs --output-json /tmp/report.json
node .claude/skills/bottega-dev-debug/scripts/analyze-logs.mjs
```

### "run automated scenarios" (Playwright, pass/fail)
```bash
npm run build
node .claude/skills/bottega-dev-debug/scripts/scenarios.mjs          # all UI-only
node .claude/skills/bottega-dev-debug/scripts/scenarios.mjs --list    # list available
```

## Test Script Catalog

**22 scripts** in `tests/qa-scripts/`. All are self-contained (clean page prerequisite).

| Group | # | Coverage | ~Time |
|-------|---|----------|-------|
| Core UX | 01-05 | Launch, happy path, conversation, errors, settings | 21m |
| Tool Coverage | 06-10 | Discovery, creation, components, styling, design system | 36m |
| Advanced | 11-14 | Image gen, JSX, annotations, judge | 29m |
| System | 15-16 | Multi-model, session/queue | 18m |
| Extended Sessions | 20-25 | Full page design, DS migration, multi-screen refactor, component extraction, cross-file, iterative refinement | 155m |

Full reference: `tests/qa-scripts/README.md`

## Bundled Scripts

| Script | Purpose | Runs during |
|--------|---------|-------------|
| `scripts/qa-runner.mjs` | **Deterministic test runner** — parses markdown scripts, sends prompts, captures metadata | QA Step 1 |
| `scripts/log-watcher.mjs` | Real-time log tail with anomaly detection | QA Step 0 |
| `scripts/qa-recorder.mjs` | Capture tool interactions for test generation (needs `BOTTEGA_QA_RECORDING=1`) | QA Step 0 |
| `scripts/helpers.mjs` | Playwright helpers (launchBottega, sendPromptAndWait, etc.) | QA Step 1 |
| `scripts/inspect.mjs` | Launch, DOM/console dump, screenshot, cleanup | Quick inspect |
| `scripts/analyze-logs.mjs` | Parse pino logs, group errors (post-hoc) | Debug |
| `scripts/scenarios.mjs` | Automated pass/fail scenarios (17 checks) | Quick inspect |

## helpers.mjs API

### Launch & State
- `launchBottega({ testMode?, timeout?, settleMs? })` → `{ app, page }`
- `getAppState(page)` → tabs, messages, toolCards, context, connection, toolbar, queue, errors
- `getLastAssistantMessage(page)` → text, toolCards, hasScreenshot

### Prompt Interaction
- `sendPromptAndWait(page, text, { timeout? })` → success, lastMessage, durationMs
- `sendPromptNoWait(page, text)` → messagesBefore
- `waitForStreaming(page, state, { timeout? })` → boolean
- `abortAgent(page)` → { success } or { error }

### Navigation & Settings
- `switchTab(page, slotIdOrIndex)` → { switched, label }
- `resetSession(page)` — New Chat
- `openSettings(page)` / `closeSettings(page)`
- `getSettingsState(page)` → model, compression, options
- `changeModel(page, modelValue)` → { changed, value }

### Visual & Assertions
- `takeScreenshot(page, path?)` → path
- `takeElementScreenshot(page, selector, path)` → path
- `runChecks(page, checks)` → { total, passed, failed, results }

## Log Analysis

Logs: `~/Library/Logs/Bottega/app.log` (pino JSON, levels: 30=info, 40=warn, 50=error, 60=fatal).

Known recurring (not bugs):
- "Another Bottega instance is already running" — WARN
- "Auto-update channel file missing" — WARN (dev only)

Known real bugs:
- "Object has been destroyed" — FATAL (shutdown race)

## Fix & Rebuild

| Changed | Action |
|---------|--------|
| `src/renderer/*` | `npm run build` then `page.reload()` |
| `src/main/*` or `preload.ts` | `npm run build` + full relaunch |
| `package.json` | `npm install` + build + relaunch |

After fixing: `npx tsc --noEmit && npm test`

## WebSocket Bridge

Quick check: `node -e "const ws=new(require('ws'))('ws://127.0.0.1:9280');const t=setTimeout(()=>{console.log('TIMEOUT');process.exit(1)},3000);ws.on('open',()=>{console.log('WS OK');clearTimeout(t);ws.close()});ws.on('error',e=>{console.log('WS ERROR:',e.message);clearTimeout(t);process.exit(1)})"`

## DOM Selectors

**Layout**: `#app`, `#titlebar`, `#tab-bar`, `#chat-area`, `#input-area`
**Tabs**: `.tab-item` (`.active`), `.tab-dot` (`.connected`), `.tab-label`, `.tab-close`
**Input**: `#input-field`, `#send-btn`, `#paste-preview`
**Messages**: `.message`, `.user-message`, `.assistant-message`, `.message-content`
**Tools**: `.tool-card`, `.tool-name`, `.tool-status`
**Status**: `#status-dot`, `#context-label`, `#context-fill`
**Toolbar**: `#bar-model-btn`, `#bar-model-label`, `#bar-effort-btn`, `#bar-effort-label`, `#bar-judge-btn`
**Settings**: `#settings-btn`, `#settings-close`, `#settings-overlay`, `#settings-panel`, `#model-select`
**Controls**: `#pin-btn`, `#reset-session-btn`, `#suggestions`, `#slash-menu`, `#task-panel`, `#prompt-queue`

## Cleanup

```bash
pkill -f "electron.*dist/main" 2>/dev/null
```
