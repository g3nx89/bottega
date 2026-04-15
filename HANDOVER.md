# Handover — Componentization Pipeline: CLOSED (v10 validated)

## Status

**Componentization retry/instantiation gap: RESOLVED.** QA v10 (2026-04-15) shows 40 `figma_instantiate` calls across 10 steps, zero retries needed, Script 39 4/4 + Script 40 6/6 PASS. Agent componentizes proactively via both `nodeId` (local) and `componentKey` (library) paths.

## What Closed the Gap

Not prompt engineering — a **tool schema contract fix**. After 8 campaigns of detection + retry prompt tuning failed to move `figma_instantiate` from 0 calls, root-cause investigation showed:

- `figma_create_component` returns `{ componentId }` (not `componentKey`)
- `figma_instantiate` schema only accepted `componentKey`
- Connector + bridge already supported `nodeId` path (see bridge code.js:1370 error message), but tool schema hid it
- Agent had no choice but to use `figma_execute` + `component.createInstance()`

## Changes (committed in 7bf804b, mixed with auth sprint)

- **`src/main/tools/components.ts`**:
  - `figma_instantiate` schema: added optional `nodeId`, kept optional `componentKey`, runtime validation requires at least one
  - Exposed `variant`, `size`, `overrides` (backend already supported — one-call instantiation instead of 3-call chain)
  - Fixed pre-existing silent bug: flat `x/y` → `position: {x, y}` mapping (connector expected `position`, bridge at code.js:1388 reads `msg.position.x/y`)
- **`src/main/system-prompt.ts`**: Component Workflow split into LOCAL (nodeId) vs LIBRARY (componentKey) paths + "CRITICAL: NEVER use figma_execute createInstance()"
- **`src/main/subagent/judge-harness.ts`**: retry checklist + tool hint updated to `{ nodeId: componentId }` syntax
- **`tests/unit/tools/components.test.ts`**: +7 tests (v9.1 nodeId path, v9.2 variant/size/overrides, position mapping regression guard)

## v10 Results

| Metric | v8 | v9 | **v10** |
|--------|----|-----|---------|
| `figma_instantiate` in steps | 0 | 0 | **40** |
| Retry cycles triggered | 11 | 3 | **0** |
| Script 39 pass | 4/4 | 3/4 | **4/4** |
| Script 40 pass | 5/6 | 4/6 | **6/6** |
| Proactive component creation | ~27% | 78% | **100%** |

## Open Issues (not blocking componentization)

### Issue 1 (High, new in v10): Micro-judges hardcode Anthropic key
When main agent uses GPT-5.4/OpenAI, 6/7 micro-judges (alignment, visual_hierarchy, completeness, consistency, naming, design_quality) fail with "No API key found for anthropic". Only componentization survives (algorithmic fast-path). The judge emits PASS vacuously because errored judges don't count as failures.

**Fix direction**: make judge model configurable per-agent, or inherit main agent model. Touch points: `src/main/subagent/session-factory.ts`, `src/main/subagent/orchestrator.ts`.

### Issue 2 (High, pre-existing): Auth gate UX on stale model
Default model on session resume may be in auth_red state with no fallback suggestion — user sees "No credentials configured" block. Addressed partially by Sprint A-D auto-fallback (commit 7bf804b F17) but may still surface on first launch after upgrade.

### Issue 3 (Low, latent): Bridge COMPONENT_SET fallback ambiguity
If both `componentKey` and `nodeId` provided and componentKey is wrong, bridge tries key first, fails silently (only logs), falls through to nodeId. Good UX but if both are wrong, error message is "Neither componentKey X nor nodeId Y resolved" — potentially misleading if user only intended to pass nodeId. Low priority.

## Architectural Lesson (memory)

**Tool contract ≠ backend capability.** When retry loops plateau despite prompt reinforcement, check whether the tool schema actually accepts the parameters the agent has in hand. Saved in `project_componentization_fix.md` under "Key architectural lesson".

## Next Possible Work

1. **Issue 1 fix** — highest-impact: makes non-componentization judges functional for GPT users
2. **Systematic audit** — other tools may have same class of gap (connector accepts X, schema hides X). Quick grep: compare `connector.*` method signatures with their corresponding tool parameter schemas. Similar patterns already fixed partially in `tokens.ts` (variable.id || variable.variableId).
3. **Release v0.14.1** — if no further work, cut release tagging closed componentization + auth sprint A-D.

## References

- Report QA v10: `/tmp/bottega-qa/componentization-v10-report.md`
- Memory: `/Users/afato/.claude/projects/-Users-afato-Projects-bottega/memory/project_componentization_fix.md`
- Commit with fixes: `7bf804b` (feat(auth): implement auth-model-fix plan Sprint A-D — componentization fixes swept in)

## Start Fresh Session

If continuing: componentization pipeline is closed. Check this handover's "Open Issues" for next priority. If interested in systematic audit of tool schema vs connector surface, `src/figma/websocket-connector.ts` methods vs `src/main/tools/*.ts` schemas is the grep target.
