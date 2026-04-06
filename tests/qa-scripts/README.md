# Test Scripts — Agent-Driven Manual QA

Step-by-step test scripts that the coding agent follows while using the live app.
The agent IS the tester: it launches the app, follows the steps, takes screenshots,
and uses its judgment to evaluate results and find subtle issues.

## Execution Constraints

**SEQUENTIAL ONLY** — Scripts must be executed one at a time. No parallel execution.

Why:
- Only one Electron instance can run (singleton lock)
- Port 9280 is exclusive to one WebSocket server
- Figma test files (Bottega-Test_A, Bottega-Test_B) are shared state
- Concurrent canvas mutations would produce unpredictable results

**CLEAN STATE** — Before starting any script:
1. Reset the session (`resetSession(page)` or click New Chat)
2. Clear the Figma canvas on Bottega-Test_A (delete all children of current page)
3. If the script uses Bottega-Test_B, clear that too

The `clearFigmaPage` helper from the agent test harness handles canvas cleanup:
```javascript
import { clearFigmaPage } from '../helpers/agent-harness.mjs';
await clearFigmaPage(win, fileKey);
```

Or via the helpers library:
```javascript
import { launchBottega, resetSession } from '../.claude/skills/bottega-dev-debug/scripts/helpers.mjs';
const { app, page } = await launchBottega();
await resetSession(page);
// Canvas cleanup requires figma_execute via the agent or test oracle IPC
```

## Environment

- **Figma files**: Bottega-Test_A and Bottega-Test_B (always open with Bridge plugin)
- **Auth**: OAuth configured for Anthropic, OpenAI, Google
- **Gemini key**: Required for image generation tests (script 11)

## How to run

1. Build the app: `npm run build`
2. Delegate to the `qa-tester` subagent with the script number
3. The subagent launches the app, cleans state, follows the script, returns findings
4. Review findings and update `BUG-REPORT.md`

### Run via qa-tester subagent
```
Agent tool:
  subagent_type: "qa-tester"
  model: "sonnet"
  prompt: "Build the app, then follow test script 02-happy-path.md
           from tests/qa-scripts/. Clean Figma canvas before starting.
           Figma Desktop is open with Bottega-Test_A and Bottega-Test_B,
           Bridge plugin active."
```

### Run multiple scripts (sequentially)
```
Agent tool:
  subagent_type: "qa-tester"
  model: "sonnet"
  prompt: "Build the app, then execute these test scripts IN ORDER,
           cleaning state between each: 01-first-launch.md, 02-happy-path.md,
           05-settings-and-controls.md. Scripts are in tests/qa-scripts/."
```

## Scripts

### Core UX (run these first)

| # | Script | What it tests | Figma | ~Time |
|---|--------|--------------|-------|-------|
| 01 | `01-first-launch.md` | First impression, onboarding, connection | Yes | 3m |
| 02 | `02-happy-path.md` | Core creation flow end-to-end | Yes | 5m |
| 03 | `03-conversation-quality.md` | Agent responses, context retention, multi-turn | Yes | 5m |
| 04 | `04-error-resilience.md` | Abort, disconnect, edge cases | Yes | 5m |
| 05 | `05-settings-and-controls.md` | Settings panel, toolbar, keyboard shortcuts | No | 3m |

### Tool Coverage (verify each tool category works)

| # | Script | What it tests | Figma | ~Time |
|---|--------|--------------|-------|-------|
| 06 | `06-discovery-and-analysis.md` | file_data, search, design_system, selection, status | Yes | 5m |
| 07 | `07-creation-and-manipulation.md` | create_child, fills, strokes, text, move, resize, clone, delete | Yes | 8m |
| 08 | `08-components.md` | search, instantiate, set_properties, set_variant, arrange | Yes | 5m |
| 09 | `09-styling-and-layout.md` | auto_layout, text_style, effects, opacity, batch ops | Yes | 8m |
| 10 | `10-design-system.md` | setup_tokens, bind_variable, lint, DS page | Yes | 10m |

### Advanced Features

| # | Script | What it tests | Figma | ~Time |
|---|--------|--------------|-------|-------|
| 11 | `11-image-generation.md` | All 7 slash commands (/generate, /edit, /icon, etc.) | Yes | 10m |
| 12 | `12-jsx-rendering.md` | render_jsx, create_icon, Tailwind props, nested JSX | Yes | 8m |
| 13 | `13-annotations.md` | get/set annotations, categories, pinned properties | Yes | 3m |
| 14 | `14-judge-and-subagents.md` | Judge auto-trigger, micro-judges, retry, subagent config | Yes | 8m |

### System

| # | Script | What it tests | Figma | ~Time |
|---|--------|--------------|-------|-------|
| 15 | `15-multi-model.md` | Claude/GPT/Gemini switching, per-tab model, isolation | Yes | 10m |
| 16 | `16-session-persistence-and-queue.md` | Queue edge cases, session reset, app restart, tab isolation | Yes | 8m |
| 17 | `17-image-editing.md` | Image gen/edit/restore, icon gen, pattern gen (Gemini) | Yes | 12m |
| 18 | `18-advanced-creation.md` | Auto-layout, image fills, batch transforms, component set arrange | Yes | 12m |
| 19 | `19-deep-discovery.md` | Component details/deep, component set analysis, library, design system | Yes | 10m |

### Extended Design Sessions (long, multi-turn, high context stress)

| # | Script | What it tests | Figma | ~Time |
|---|--------|--------------|-------|-------|
| 20 | `20-full-page-design.md` | Build a complete landing page section by section | Yes | 25m |
| 21 | `21-design-system-migration.md` | Migrate hardcoded design to token system | Yes | 25m |
| 22 | `22-multi-screen-refactor.md` | Fix inconsistencies across 4 screens | Yes | 30m |
| 23 | `23-component-extraction.md` | Find repeated patterns, extract components | Yes | 20m |
| 24 | `24-cross-file-consistency.md` | Compare and sync designs across both test files | Both | 25m |
| 25 | `25-iterative-refinement.md` | 8+ rounds of feedback and revision on one screen | Yes | 30m |

**Total: 25 scripts**
- Feature scripts (01-16): ~100 minutes
- Extended sessions (20-25): ~155 minutes
- Full suite: ~255 minutes

## Running strategy

- **Quick smoke test**: Scripts 01 + 02 (~8 min)
- **Pre-release QA**: Scripts 01-05 + 14 (~30 min)
- **Feature coverage**: Scripts 01-16 in order (~100 min)
- **Stability stress test**: Scripts 20-25 (~155 min, tests context limits and long sessions)
- **After a specific change**: Run the relevant script only

## Three-Pass QA Architecture

Every QA run uses three complementary passes:

### Pass 1 — Functional Testing (qa-tester, Sonnet)
Automated PASS/FAIL checks via runner scripts. For each agent-interactive step:
- Send prompt via `sendPromptAndWait()`
- Check DOM state, tool cards, connection status
- Take screenshot
- **Save metadata** to `NN-metadata.json` (prompt, response, tools, screenshot path)

### Log Monitor (nohup process)
Real-time `log-watcher.mjs` tailing `app.log` during the entire session.
Detects anomalies: errors, disconnects, slow operations, memory warnings.

### Pass 2 — UX Quality Review (ux-reviewer, Opus)
Runs AFTER Pass 1 completes. Reviews screenshots + metadata + test script criteria.
Evaluates 5 dimensions per step (1-5 scale):

| Dimension | What to look for |
|-----------|-----------------|
| **Visual Quality** | Spacing, alignment, colors, readability, contrast, polish |
| **Response Clarity** | Is the agent's text helpful? Clear? Not too verbose? |
| **Tool Selection** | Did the agent pick the right tool for the job? |
| **UX Coherence** | Does the result match the user's intent? Natural flow? |
| **Feedback Quality** | Does the user know what's happening at every moment? |

Additional qualitative dimensions (cross-script):
- **Timing**: does anything feel slow, laggy, or jarring?
- **Recovery**: after something goes wrong, can the user continue naturally?
- **Consistency**: do similar actions produce similar results?

### Metadata JSON Format

Pass 1 saves `/tmp/bottega-qa/NN-metadata.json` for each script:
```json
[
  {
    "script": "02-happy-path",
    "step": "1. Send a simple prompt",
    "prompt": "Take a screenshot and describe what you see",
    "response": "I can see the Figma canvas with...",
    "toolCards": ["figma_status", "figma_screenshot"],
    "screenshot": "/tmp/bottega-qa/02-screenshot-response.png",
    "passed": true,
    "timestamp": "2026-04-05T13:45:00Z",
    "evaluateCriteria": ["Does the response appear progressively?", "Is the screenshot showing the actual canvas?"]
  }
]
```

### Writing Test Scripts for Three-Pass

When adding new test scripts, structure each step to support both passes:

```markdown
### N. Step title
Send: "the prompt to send"

**Implementation hint:** (selectors, timing, expected tool names)

**Pass 1 checks:**
- [ ] Agent responded within timeout
- [ ] Expected tool card appeared
- [ ] DOM state matches expectation

**Evaluate (Pass 2):**
- Is the visual result well-structured?
- Does the response explain what was done clearly?
- Was the tool selection appropriate for this task?
```

## Output

After a full QA run, three reports are produced:
1. `/tmp/bottega-qa/result-NN.txt` — Pass 1 PASS/FAIL per step
2. `/tmp/log-monitor-report.md` — Log anomalies with timestamps
3. `/tmp/bottega-qa/ux-review.md` — Pass 2 qualitative scores and UX issues
4. Merged findings in `BUG-REPORT.md` (B-NNN bugs, UX-NNN issues, P-NNN perf, W-NNN warnings)
