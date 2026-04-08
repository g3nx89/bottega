# Assertion DSL — Spec

**Status**: Day 1 Fase 2 deliverable — pending review (Task 2.3)
**Used by**: `qa-runner.mjs` (post-refactor) for deterministic step verification
**Format**: YAML inside fenced code block ` ```assert ` placed inside a numbered step

---

## 1. Why a DSL

QA Run 3 demonstrated that the existing PASS criterion ("agent responded, no exception, screenshot captured") declares 100% PASS while the app has ~28 open bugs. The assertion DSL replaces the binary success heuristic with **a list of declarative checks**: a step PASSes only if **all** assertions in its `assert` block evaluate to true.

**Key properties**:
- **Declarative**: each assertion describes an observable property of the resulting state, not a procedure.
- **Composable**: many assertions can stack on the same step (AND semantics).
- **Backward compatible**: a step with no `assert` block falls back to legacy SOFT_PASS (current binary behaviour).
- **Fail loud on parse error**: malformed YAML inside an `assert` block makes the step **FAIL** (not SOFT_PASS) — silent failure is the failure mode the DSL exists to eliminate.

---

## 2. Block syntax

The block must be a fenced code block whose info string is **exactly** `assert` (lowercase), placed inside a numbered step's body, after the `Send:` line and any free-form `**Evaluate:**` bullets:

````markdown
### 4. Send a creation prompt
Send: "Create a blue button with the text 'Click Me', 200x60 pixels"

**Evaluate:**
- Does the agent use an appropriate creation tool?
- Did the Judge quality check trigger?

```assert
tools_called: [figma_render_jsx]
screenshots_min: 1
response_contains:
  any_of: [button, created]
duration_max_ms: 60000
tools_NOT_called_more_than:
  figma_screenshot: 2
```
````

### Parser rules

- **Fence**: opening must match `/^```assert[ \t]*$/` (trailing whitespace tolerated). Closing must match `/^```[ \t]*$/`.
- **Body**: parsed via `yaml.parse()`. The result MUST be a non-empty YAML mapping (object), not a sequence, scalar, or `{}`.
- **One block per step**: only the first `assert` block per step is honoured. Subsequent blocks are ignored with a `WARN` log to stderr (`[qa-runner] WARN: duplicate assert block in step N, ignored`).
- **Manual steps**: a step without a `Send:` line is `isManual: true` — assert blocks on such steps are ignored with a `WARN` log (`[qa-runner] WARN: assert block on manual step N ignored`). Manual steps are never executed by the runner.
- **Unknown assertion types**: any key in the block that is not in the registry below FAILs the step with `unknown assertion type: X`. No silent skipping.
- **Parse errors**: any of {unterminated fence, invalid YAML, non-mapping root, empty mapping} produce **FAIL** for the step with the parse error message in the failure detail. An empty `{}` mapping is treated as a parse error (`assert block must contain at least one assertion`) — use SOFT_PASS (no block) if you want to skip assertion evaluation, not an empty block.

---

## 3. Assertion type registry

The MVP implements **7 Priority-1 types** (Day 2). Priority-2 types are documented here for the grammar but implemented later. Priority-3 types are reserved.

### 3.1 Priority 1 (MVP, implemented Day 2)

#### `tools_called`
**Purpose**: assert that **all** tools in the list were called at least once during the step (AND semantics).
**Value**: array of canonical tool names.
**Semantics**: `actual.some(t => t.toLowerCase() === required.toLowerCase())` for each required name. **Exact case-insensitive match.**
**Notes**: tool names are the raw canonical identifiers (`figma_screenshot`, `figma_render_jsx`, …) as defined in `src/main/tools/`. Verified empirically: the `.tool-name` DOM element is set via `nameEl.textContent = toolName` with the raw name (`src/renderer/app.js:541`), no humanization, no decoration. Status (✓ / spinner / error) lives in a separate `.tool-status` sibling and is excluded by the extractor (`helpers.mjs:86`).

```yaml
tools_called: [figma_render_jsx]
tools_called: [figma_execute, figma_screenshot]   # AND — both must be present
```

#### `tools_called_any_of`
**Purpose**: assert that **at least one** of the listed tools was called (OR semantics). Use when multiple tools are equally valid for the step's intent.
**Value**: array of canonical tool names.
**Semantics**: `required.some(req => actual.some(t => t.toLowerCase() === req.toLowerCase()))`.
**Use case**: a creation prompt may legitimately use `figma_render_jsx`, `figma_execute`, or `figma_create_child` — the agent's choice depends on prompt phrasing and model. Asserting on `tools_called_any_of` expresses the domain truth without forcing calibration to discover which tool the agent picked.

```yaml
tools_called_any_of: [figma_render_jsx, figma_execute, figma_create_child]
```

**`tools_called` vs `tools_called_any_of`**: use `tools_called` for tools that are **required** (e.g. `figma_execute` for a deletion step), use `tools_called_any_of` for tools that are **interchangeable** for the same intent.

#### `tools_NOT_called_more_than`
**Purpose**: cap the number of times a specific tool can be called in a single step.
**Value**: object mapping tool name → max occurrences (inclusive).
**Semantics**: `actual.filter(t => t.toLowerCase() === name.toLowerCase()).length <= cap`. **Exact case-insensitive match** — substring match would make `figma_set_text: 0` silently collide with `figma_set_text_style`, defeating the intent.
**Use case**: detect tool spam (agent calls `figma_screenshot` 4 times in one turn) or assert "must NOT call" via cap = 0.

```yaml
tools_NOT_called_more_than:
  figma_screenshot: 1     # at most one screenshot tool call
  figma_create_child: 0   # must NOT create a new child (modification step)
```

#### `response_contains`
**Purpose**: substring presence check on the agent's final response text.
**Value**: three accepted shapes:
1. **string** — single substring, default case-insensitive. Equivalent to `{ all_of: [string], case_sensitive: false }`.
2. **array of strings** — `all_of` semantics, every substring must be present. Default `case_sensitive: false`.
3. **object** — explicit form: `{any_of: [...], case_sensitive: bool}` or `{all_of: [...], case_sensitive: bool}`. Default `case_sensitive: false`.

> ⚠️ **Silent-semantics trap**: Forms 1 and 2 are BOTH `all_of`. Upgrading `response_contains: "button"` (form 1) to `response_contains: ["button", "blue"]` (form 2) does NOT flip to "any-of" — both elements must appear. To get any-of semantics, you MUST use Form 3: `{ any_of: [...] }`.

**Type validation**: `case_sensitive` must be a literal boolean (`true` / `false`). String values like `"true"` or numeric `1` are rejected with a clear parse error — silent coercion was a prior footgun.

**Important**: assertion is evaluated against the **full response text**, NOT against the 500-char truncated `stepMeta.response`. The truncation is for the metadata file only.

```yaml
response_contains: "button"                                # form 1
response_contains: ["button", "blue"]                      # form 2 (all_of)
response_contains:                                         # form 3 (any_of)
  any_of: [button, created, rendered]
  case_sensitive: false
response_contains:
  all_of: [Button, JSX]
  case_sensitive: true                                     # opt-in strict for code identifiers
```

**Caveat — when to use `case_sensitive: true`**:

The default lowercase substring match is correct for **natural-language tokens** ("button", "created", "ready"). For **code-identifier tokens**, the lowercase match can collide with unrelated text:

```yaml
# WRONG — natural language defaults match too much
response_contains: [JSX]            # matches "rejsx", "ajsx", any string containing "jsx"

# RIGHT — opt-in strict for identifiers
response_contains:
  any_of: [JSX]
  case_sensitive: true              # exact "JSX", not "jsx"
```

**Rule of thumb**:
- Natural language ("created", "blue", "changed") → default case-insensitive ✓
- Code identifiers ("JSX", "API", "DOM", file extensions) → `case_sensitive: true` ✓
- Multi-word natural phrases ("quality check") → default case-insensitive ✓

The fully strict regex form (`response_matches`) is Priority-2.

#### `screenshots_min`
**Purpose**: assert that the chat shows at least N screenshot images after the step settles.
**Value**: integer.
**Semantics**: `state.screenshotCount >= n`. Counted from `getAppState(page)` which queries `.screenshot` images in the assistant message DOM (helpers.mjs:65-123).
**Note**: includes both inline `figma_render_jsx` results and explicit `figma_screenshot` tool outputs.

```yaml
screenshots_min: 1
screenshots_min: 0     # trivially true (use to assert "no screenshot needed")
```

#### `duration_max_ms`
**Purpose**: cap on step wall-clock duration (from `Send:` to streaming finish + 2s settle).
**Value**: integer milliseconds, inclusive cap.
**Semantics**: `stepMeta.durationMs <= n`.
**Calibration tip**: set `duration_max_ms = ceil(p95 * 1.5)` after running `--calibrate 3` against the script.

```yaml
duration_max_ms: 60000   # 60 seconds
```

#### `dom_visible`
**Purpose**: assert that a CSS selector matches a visible element after the step settles.
**Value**: CSS selector string (Playwright locator syntax).
**Semantics**: `await page.locator(selector).first().isVisible({ timeout: 0 })`. Wrapped in try/catch — invalid selectors and missing elements both produce `passed: false` with a clear error message, never an unhandled rejection.

**Important**: `{ timeout: 0 }` is mandatory — Playwright locator default is 30s, which would blow step duration budgets.

```yaml
dom_visible: "#suggestions:not(.hidden)"
dom_visible: ".message-content .judge-section"
```

---

### 3.2 Priority 2 (grammar only, implemented post-MVP)

These are documented for forward compatibility. The Day 2 evaluator implements only P1 — using a P2 type before it's implemented produces FAIL with `unknown assertion type: X`.

```yaml
# Tool selection variants
tools_called_exactly: [figma_screenshot]    # exact set, no extras allowed
tools_called_in_order: [figma_execute, figma_screenshot]
tools_NOT_called: [figma_delete_node]

# Response variants
response_NOT_contains: ["error", "failed", "I can't"]
response_min_chars: 20
response_max_chars: 2000
response_matches: "^I (took|created|rendered).*"   # regex, anchored

# DOM variants
dom_NOT_visible: ".error-toast"
dom_class_present: { selector: "#bar-judge-btn", class: "active" }
dom_text_contains:
  selector: ".assistant-message:last-child .message-content"
  text: "Quality Check"
dom_count: { selector: ".tool-card", min: 1, max: 3 }

# State / domain
context_increased: true            # context bar > 0K after the step
judge_section_present: true        # Quality Check section visible (B-018 sentinel)
suggestions_visible: true          # follow-up chips appeared (B-021 sentinel)
error_thrown: false                # negative test for explicit error states

# Fase 4 — metric assertions (require BOTTEGA_AGENT_TEST=1 + MetricsRegistry)
metric:
  path: judge.totalTriggers
  op: '>'
  value: 0
metric_growth:
  path: tools.callCount
  maxGrowth: 5
  sinceStep: start
```

---

## 4. Evaluation contract

The runner calls the evaluator once per step that has a parsed `assert` block:

```javascript
const { passed, results } = await evaluateAssertions(step.assertions, stepData);
```

Where `stepData` is:

```typescript
{
  toolsCalled: string[],          // from getAppState(page).toolCards.map(tc => tc.name)
  responseText: string,           // FULL agent response (not truncated)
  responseTextTruncated: string,  // 500-char version, used in stepMeta only
  screenshotCount: number,        // state.screenshotCount
  durationMs: number,             // stepMeta.durationMs
  page: import('playwright').Page,
  metricsBefore: object,          // Fase 4: from getMetrics(page) before sendPromptAndWait
  metricsAfter: object,           // Fase 4: from getMetrics(page) after settle
}
```

And `results` is an array of:

```typescript
{
  name: string,                   // assertion type, e.g. 'tools_called'
  passed: boolean,
  error: string | null,           // null on success
  detail?: string,                // human-readable diagnostic
}
```

The step PASSes only when **every** result has `passed === true`.

---

## 5. PASS / FAIL / SOFT_PASS matrix

| `step.assertions` | `step.assertionParseError` | `response.success` | `QA_RUNNER_LEGACY_MODE` | Outcome |
|---|---|---|---|---|
| `null` | `null` | `true`  | any   | **SOFT_PASS** (legacy binary heuristic) |
| `null` | `null` | `false` | any   | **FAIL** (transport error) |
| object | `null` | `true`  | unset | evaluate assertions → PASS or FAIL |
| object | `null` | `false` | unset | **FAIL** (transport error) — assertions evaluated and recorded in `NN-assertions.json` for diagnostic triage, but the step's `stepResult.error` reflects the transport failure, not the assertion outcomes |
| `null` | string | any     | unset | **FAIL** (parse error, error message in failure detail) |
| any    | any    | any     | `1`   | legacy SOFT_PASS path, assert block ignored entirely |

**SOFT_PASS** is reserved for the legacy compatibility path. New assert-equipped scripts should never produce SOFT_PASS — every step is either PASS or FAIL.

**Diagnostic data access**: when transport fails with an assert block present, the assertion results are recorded in `<output>/<NN>-assertions.json` under the step entry (with `assertionMode: "strict"` even though the top-level result is `FAIL`). This lets triage distinguish "the transport broke AND the assertions would have passed" from "the transport broke AND the agent's output was also wrong". The human-readable `result-NN.txt` surfaces only the transport error to keep the summary actionable.

---

## 6. Migration guide — from `**Evaluate:**` bullets to `assert` block

The legacy `**Evaluate:**` bullet list stays in the markdown for human readers (Pass 2 oracle, manual triage). The `assert` block is **additive** — it does not replace the bullets, it complements them with machine-checkable claims.

### Step-by-step

1. **Read the existing Evaluate bullets** for the step.
2. **Categorise each bullet** into one of:
   - **DOM observable** → `dom_visible` / `dom_NOT_visible` / `dom_text_contains`
   - **Tool selection** → `tools_called` / `tools_NOT_called_more_than`
   - **Response content** → `response_contains` / `response_NOT_contains`
   - **Performance** → `duration_max_ms`
   - **Visual quality** → leave as bullet (Pass 2 oracle judges this)
   - **Subjective** → leave as bullet (Pass 2 oracle judges this)
3. **Translate** the categorised bullets into an `assert` block.
4. **Calibrate** with `qa-runner.mjs --script NN --calibrate 3` to identify variance.
5. **Tighten / loosen** thresholds based on calibration JSON.

### Example translation

**Before** (Step 4 of `02-happy-path.md`):
```markdown
**Evaluate:**
- Does the agent use an appropriate creation tool (`figma_render_jsx`, `figma_execute`, or `figma_create_child`)?
- Is there at least 1 screenshot showing the created element?
- Does the agent's description match what was actually created?
- Did the Judge quality check trigger? What did it report?
```

**After** (additive — both bullets and `assert` block coexist):
```markdown
**Evaluate:**
- Does the agent use an appropriate creation tool (`figma_render_jsx`, `figma_execute`, or `figma_create_child`)?
- Is there at least 1 screenshot showing the created element?
- Does the agent's description match what was actually created?
- Did the Judge quality check trigger? What did it report?

```assert
tools_called: [figma_render_jsx]
screenshots_min: 1
response_contains:
  any_of: [button, created, rendered]
duration_max_ms: 60000
tools_NOT_called_more_than:
  figma_screenshot: 2
```
```

The bullets `Does the description match` and `Did the Judge trigger? What did it report?` are not translatable to a P1 assertion — `Does the description match` is judged by Pass 2 oracle, `Did the Judge trigger` will become a P2/Fase4 `metric` assertion (`metric: { path: judge.totalTriggers, op: '>', value: 0 }`) once Fase 4 lands.

---

## 7. Best practices

### Strict vs permissive

- **Permissive first**: start with `tools_called_any_of` (P2) or a single-element `tools_called` for the most likely tool. Calibration will tell you if the tool varies.
- **Tighten after calibration**: once `--calibrate 3` shows the tool is stable across runs (intersection == union), keep `tools_called`. If union > intersection, switch to `tools_called_any_of`.
- **Never assert against rare optional tools**: `figma_status` is called optionally by some agents — never put it in `tools_called`.

### Duration budgets

- `duration_max_ms` should be **set from p95 × 1.5**, not from intuition.
- A first-time creation on a fresh canvas is ~30-60s; modifications are ~10-20s; status queries are ~3-8s.
- For stress tests (Script 25), set generous budgets — the goal there is detecting catastrophic regressions, not micro-optimisation.

### Response content

- **Use natural-language tokens** for `response_contains`: "button", "created", "changed", "ready".
- **Avoid identifier-style tokens** unless you opt into `case_sensitive: true`.
- **Avoid asserting on agent personality** ("Sure!", "Absolutely!") — these vary across model versions.

### DOM selectors

- **Prefer `data-testid` attributes** — Bottega's renderer sets `data-testid` on tool cards (`tool-card`, `tool-name`, `tool-spinner`, `tool-status`). These are the most stable selectors and survive CSS class renames. Verified in `src/renderer/app.js:531-540`.
- **Fall back to `id` + class** for elements without `data-testid` (most app chrome: `#suggestions`, `#bar-judge-btn`, `#context-label`, `#input-field`, `.assistant-message`, etc).
- **Avoid `:nth-child(N)`** — order is fragile.
- **Use `:not(.hidden)`** for visibility on toggleable elements (e.g. `#suggestions:not(.hidden)`). Bottega uses the `.hidden` class as a soft hide on toggleable containers — without `:not(.hidden)` the selector matches even when the element is logically invisible.
- **Always pair `dom_visible` with a specific selector**, not a broad one like `.message`.

**Known stable selectors** (verified during DSL design):

| Element | Selector | Notes |
|---|---|---|
| Tool card | `[data-testid="tool-card"]` | data-testid, most stable |
| Tool card name | `[data-testid="tool-name"]` | inner text = canonical tool name |
| Suggestion chips container | `#suggestions:not(.hidden)` | toggleable via `.hidden` class |
| Judge active toggle | `#bar-judge-btn.active` | class `active` when ON |
| Context bar label | `#context-label` | text = "0K", "1.2K", etc |
| Last assistant message | `.assistant-message:last-child .message-content` | full response text |
| Error toast | `.error-toast, [class*=error-message]` | union of two patterns |

### Backward compat hygiene

- Adding an `assert` block to a script that previously SOFT_PASSed makes the step strictly verified. **Run it three times before merging** to catch flake.
- Removing an `assert` block (rollback) is one-line: delete the fenced block and the step returns to SOFT_PASS automatically.

---

## 8. Rollback (`QA_RUNNER_LEGACY_MODE`)

If the assertion runner produces a >20% false-positive rate in production, the rollback is:

**Per-script**: delete the `assert` block from the offending script:
```bash
sed -i.bak '/^```assert$/,/^```$/d' tests/qa-scripts/02-happy-path.md
```

**Global**: set the env var:
```bash
QA_RUNNER_LEGACY_MODE=1 node .claude/skills/bottega-dev-debug/scripts/qa-runner.mjs --script 02
```

In legacy mode, **all** `assert` blocks are ignored (parser still reads them but evaluator never runs), and the runner reverts to the binary success heuristic. Useful for emergency bypass without touching files.

---

## 9. Versioning

This document is **v1** of the DSL. Breaking changes (renamed assertion types, changed semantics) require a major version bump and a migration guide. Additive changes (new assertion types) are backward compatible by design — the registry-based parser ignores nothing and FAILs unknown types loudly, so adding `dom_text_contains` doesn't break existing scripts.

**Schema version is implicit in this file**. The `assertion-evaluators.mjs` registry constant `DSL_VERSION = 1` is the canonical source.

---

## 10. References

- `QA-PIANO-MIGLIORAMENTO.md` §4 — Fase 2 spec
- `tests/qa-scripts/CALIBRATION.md` — calibration workflow (created Day 4)
- `.claude/skills/bottega-dev-debug/scripts/assertion-evaluators.mjs` — implementation (created Day 2)
- `.claude/skills/bottega-dev-debug/scripts/qa-runner.mjs` — integration (refactored Day 3)
