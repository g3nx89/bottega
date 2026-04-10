// assertion-evaluators.test.ts
// Day 2 Fase 2 deliverable — 21 unit tests (3 per P1 type) + 3 dispatcher tests.
// Spec: tests/qa-scripts/ASSERTION-DSL.md
// Evaluator: .claude/skills/bottega-dev-debug/scripts/assertion-evaluators.mjs

import { describe, expect, it } from 'vitest';

import {
  ASSERTION_EVALUATORS,
  DSL_VERSION,
  evaluateAssertions,
} from '../../../.claude/skills/bottega-dev-debug/scripts/assertion-evaluators.mjs';

// ── Types mirroring the JSDoc in the .mjs ────────────────────────────────────

interface FakeLocator {
  first: () => { isVisible: (opts?: object) => Promise<boolean> };
}
interface FakePage {
  locator: (selector: string) => FakeLocator;
}

interface StepData {
  toolsCalled: string[];
  responseText: string;
  screenshotCount: number;
  durationMs: number;
  page?: FakePage;
  metricsBefore?: object;
  metricsAfter?: object;
  figmaExecute?: (code: string) => Promise<string>;
  visionEval?: (
    imageBase64: string,
    prompt: string,
  ) => Promise<{ scores: Record<string, number>; mean: number; reasoning: string }>;
  rubricResolver?: (rubricType: string) => string | null;
  _canvasScreenshot?: string;
  _roundScores?: number[];
}

interface AssertionResult {
  name: string;
  passed: boolean;
  error: string | null;
  detail?: string;
}

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeStepData(overrides: Partial<StepData> = {}): StepData {
  return {
    toolsCalled: [],
    responseText: '',
    screenshotCount: 0,
    durationMs: 0,
    ...overrides,
  };
}

/** Fake page that resolves isVisible to a fixed value. */
function fakePageReturns(visible: boolean): FakePage {
  return {
    locator: () => ({
      first: () => ({
        isVisible: async () => visible,
      }),
    }),
  };
}

/** Fake page whose locator throws when isVisible is called. */
function fakePageThrows(message: string): FakePage {
  return {
    locator: () => ({
      first: () => ({
        isVisible: async () => {
          throw new Error(message);
        },
      }),
    }),
  };
}

/** Run a single assertion and return its result. */
async function runOne(type: string, value: unknown, stepData: StepData): Promise<AssertionResult> {
  const { results } = await evaluateAssertions({ [type]: value }, stepData);
  return results[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. tools_called — 3 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('tools_called', () => {
  it('HAPPY: all required tools present → pass', async () => {
    const r = await runOne(
      'tools_called',
      ['figma_screenshot', 'figma_execute'],
      makeStepData({ toolsCalled: ['figma_screenshot', 'figma_execute', 'figma_status'] }),
    );
    expect(r.passed).toBe(true);
    expect(r.error).toBeNull();
  });

  it('EDGE: case mismatch is normalized via lowercase exact match → pass', async () => {
    const r = await runOne('tools_called', ['Figma_Screenshot'], makeStepData({ toolsCalled: ['figma_screenshot'] }));
    expect(r.passed).toBe(true);
  });

  it('NEGATIVE: one required tool missing → fail, missing list contains only the absent tool', async () => {
    const r = await runOne(
      'tools_called',
      ['figma_delete', 'figma_screenshot'],
      makeStepData({ toolsCalled: ['figma_screenshot'] }),
    );
    expect(r.passed).toBe(false);
    // The "missing tool(s): [...]" segment should list only figma_delete (not figma_screenshot).
    // The error message also echoes "actual: [figma_screenshot]" for diagnostics, so we
    // extract the missing list specifically via .match().
    const match = (r.error ?? '').match(/missing tool\(s\): \[([^\]]+)\]/);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('figma_delete');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. tools_called_any_of — 3 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('tools_called_any_of', () => {
  it('HAPPY: one of multiple valid tools was called → pass', async () => {
    const r = await runOne(
      'tools_called_any_of',
      ['figma_render_jsx', 'figma_execute', 'figma_create_child'],
      makeStepData({ toolsCalled: ['figma_execute', 'figma_screenshot'] }),
    );
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('figma_execute');
  });

  it('EDGE: case mismatch normalized → pass', async () => {
    const r = await runOne('tools_called_any_of', ['FIGMA_EXECUTE'], makeStepData({ toolsCalled: ['figma_execute'] }));
    expect(r.passed).toBe(true);
  });

  it('NEGATIVE: none of the listed tools were called → fail', async () => {
    const r = await runOne(
      'tools_called_any_of',
      ['figma_render_jsx', 'figma_create_child'],
      makeStepData({ toolsCalled: ['figma_screenshot'] }),
    );
    expect(r.passed).toBe(false);
    expect(r.error).toContain('figma_render_jsx');
    expect(r.error).toContain('figma_create_child');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. tools_NOT_called_more_than — 3 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('tools_NOT_called_more_than', () => {
  it('HAPPY: actual count under cap → pass', async () => {
    const r = await runOne(
      'tools_NOT_called_more_than',
      { figma_screenshot: 2 },
      makeStepData({ toolsCalled: ['figma_screenshot'] }),
    );
    expect(r.passed).toBe(true);
  });

  it('EDGE: exactly at cap → pass (inclusive <=)', async () => {
    const r = await runOne(
      'tools_NOT_called_more_than',
      { figma_screenshot: 1 },
      makeStepData({ toolsCalled: ['figma_screenshot'] }),
    );
    expect(r.passed).toBe(true);
  });

  it('NEGATIVE: over cap → fail with count in detail', async () => {
    const r = await runOne(
      'tools_NOT_called_more_than',
      { figma_screenshot: 1 },
      makeStepData({ toolsCalled: ['figma_screenshot', 'figma_screenshot'] }),
    );
    expect(r.passed).toBe(false);
    expect(r.error).toContain('figma_screenshot');
    expect(r.error).toContain('2');
    expect(r.error).toContain('1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. response_contains — 3 tests (default case-insensitive + explicit strict + all_of negative)
// ─────────────────────────────────────────────────────────────────────────────

describe('response_contains', () => {
  it('HAPPY: any_of match case-insensitive by default', async () => {
    const r = await runOne(
      'response_contains',
      { any_of: ['button'] },
      makeStepData({ responseText: 'I created a Blue Button for you.' }),
    );
    expect(r.passed).toBe(true);
  });

  it('EDGE: case_sensitive: true is honored → strict mode catches case mismatch', async () => {
    const r = await runOne(
      'response_contains',
      { any_of: ['Button'], case_sensitive: true },
      makeStepData({ responseText: 'created a button with rounded corners' }),
    );
    expect(r.passed).toBe(false);
    expect(r.error).toContain('case_sensitive=true');
  });

  it('NEGATIVE: array form (all_of semantics) with one missing → fail', async () => {
    const r = await runOne(
      'response_contains',
      ['button', 'red'],
      makeStepData({ responseText: 'I created a blue button' }),
    );
    expect(r.passed).toBe(false);
    expect(r.error).toContain('red');
    expect(r.error).not.toContain(', button'); // button matched, shouldn't be in missing list
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. screenshots_min — 3 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('screenshots_min', () => {
  it('HAPPY: exactly meets minimum → pass', async () => {
    const r = await runOne('screenshots_min', 1, makeStepData({ screenshotCount: 1 }));
    expect(r.passed).toBe(true);
  });

  it('EDGE: 0 required, 0 actual → trivially pass', async () => {
    const r = await runOne('screenshots_min', 0, makeStepData({ screenshotCount: 0 }));
    expect(r.passed).toBe(true);
  });

  it('NEGATIVE: below minimum → fail with expected vs actual', async () => {
    const r = await runOne('screenshots_min', 2, makeStepData({ screenshotCount: 1 }));
    expect(r.passed).toBe(false);
    expect(r.error).toContain('>= 2');
    expect(r.error).toContain('got 1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. duration_max_ms — 3 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('duration_max_ms', () => {
  it('HAPPY: under cap → pass', async () => {
    const r = await runOne('duration_max_ms', 5000, makeStepData({ durationMs: 2500 }));
    expect(r.passed).toBe(true);
  });

  it('EDGE: exactly at cap → pass (inclusive <=)', async () => {
    const r = await runOne('duration_max_ms', 5000, makeStepData({ durationMs: 5000 }));
    expect(r.passed).toBe(true);
  });

  it('NEGATIVE: over cap → fail with delta', async () => {
    const r = await runOne('duration_max_ms', 5000, makeStepData({ durationMs: 7500 }));
    expect(r.passed).toBe(false);
    expect(r.error).toContain('7500');
    expect(r.error).toContain('5000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. dom_visible — 3 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('dom_visible', () => {
  it('HAPPY: mock locator returns visible=true → pass', async () => {
    const r = await runOne('dom_visible', '#suggestions:not(.hidden)', makeStepData({ page: fakePageReturns(true) }));
    expect(r.passed).toBe(true);
  });

  it('EDGE: locator throws → fail with error captured (no crash)', async () => {
    const r = await runOne('dom_visible', 'invalid::selector', makeStepData({ page: fakePageThrows('bad selector') }));
    expect(r.passed).toBe(false);
    expect(r.error).toContain('bad selector');
    // Critical: no unhandled rejection, no throw from evaluator
  });

  it('NEGATIVE: mock locator returns visible=false → fail with selector in detail', async () => {
    const r = await runOne('dom_visible', '#suggestions:not(.hidden)', makeStepData({ page: fakePageReturns(false) }));
    expect(r.passed).toBe(false);
    expect(r.error).toContain('#suggestions');
    expect(r.error).toContain('not visible');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher integration — 3 tests
// ─────────────────────────────────────────────────────────────────────────────

describe('evaluateAssertions (dispatcher)', () => {
  it('combines multiple assertions with AND semantics (all pass)', async () => {
    const { passed, results } = await evaluateAssertions(
      {
        tools_called: ['figma_execute'],
        screenshots_min: 1,
        duration_max_ms: 60000,
      },
      makeStepData({
        toolsCalled: ['figma_execute'],
        screenshotCount: 1,
        durationMs: 12000,
      }),
    );
    expect(passed).toBe(true);
    expect(results).toHaveLength(3);
    expect(results.every((r: AssertionResult) => r.passed)).toBe(true);
  });

  it('a single failing assertion causes overall fail (AND semantics)', async () => {
    const { passed, results } = await evaluateAssertions(
      {
        tools_called: ['figma_execute'], // will pass
        screenshots_min: 5, // will fail (only 1 screenshot)
        duration_max_ms: 60000, // will pass
      },
      makeStepData({
        toolsCalled: ['figma_execute'],
        screenshotCount: 1,
        durationMs: 12000,
      }),
    );
    expect(passed).toBe(false);
    const failing = results.filter((r: AssertionResult) => !r.passed);
    expect(failing).toHaveLength(1);
    expect(failing[0].name).toBe('screenshots_min');
  });

  it('unknown assertion type FAILs loud (per DD-6)', async () => {
    const { passed, results } = await evaluateAssertions(
      {
        tools_called: ['figma_execute'],
        nonexistent_evaluator: true, // truly unknown type
      },
      makeStepData({ toolsCalled: ['figma_execute'] }),
    );
    expect(passed).toBe(false);
    const unknown = results.find((r: AssertionResult) => r.name === 'nonexistent_evaluator');
    expect(unknown).toBeDefined();
    expect(unknown!.passed).toBe(false);
    expect(unknown!.error).toContain('unknown assertion type');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

// ─────────────────────────────────────────────────────────────────────────────
// Task 2.13 — B-018 regression spec (simulated)
// ─────────────────────────────────────────────────────────────────────────────
//
// This block validates that the assertion DSL catches a regression of B-018
// (judge auto-trigger silently skipped after mutation tools). The "live" form
// of this validation requires a scratch branch that reverts the B-018 fix and
// runs qa-runner against script 14 — see tests/qa-scripts/README.md for the
// full procedure. The simulated form below is the permanent regression net:
// it feeds the EXACT assert blocks from tests/qa-scripts/14-judge-and-subagents.md
// (step 2 and step 8) through evaluateAssertions with two stepData shapes —
// one with the judge ACTIVE ("quality check" present) and one with B-018
// reintroduced (judge skipped, "quality check" absent) — and asserts that
// the sentinel flips the result. If this test ever stops failing on the
// B-018 shape, the sentinel has lost its teeth and must be re-tuned.
//
// Keep the assert blocks in sync with script 14 by hand — they're duplicated
// intentionally so this test is self-contained and doesn't parse markdown.

describe('B-018 regression sentinel (task 2.13 simulated)', () => {
  // Verbatim copy of the step 2 assert block from 14-judge-and-subagents.md.
  // If that file changes, the drift-detection test below catches it.
  // SENTINEL DESIGN: dom_visible on `.judge-verdict-card` — the judge harness
  // renders a SEPARATE DOM card (sibling of `.message-content`), NOT embedded
  // in the agent's text stream. response_contains on rendered text would
  // always fail since the agent's prose never contains the footer literally.
  // Empirically validated against script 14 calibration (2026-04-08).
  const STEP_2_ASSERT = {
    tools_called_any_of: ['figma_render_jsx', 'figma_execute', 'figma_create_child'],
    screenshots_min: 1,
    dom_visible: '.assistant-message:last-child .judge-verdict-card',
    duration_max_ms: 120000,
    // Fase 4: metric_growth additions for B-018 semantic guarantee.
    metric_growth: [
      { path: 'judge.triggeredTotal', minGrowth: 1 },
      { path: "judge.skippedByReason['no-connector']", exactGrowth: 0 },
    ],
  };

  // Step 8 (complex creation) adds figma_auto_layout to the tool set.
  const STEP_8_ASSERT = {
    tools_called_any_of: ['figma_render_jsx', 'figma_execute', 'figma_create_child', 'figma_auto_layout'],
    screenshots_min: 1,
    dom_visible: '.assistant-message:last-child .judge-verdict-card',
    duration_max_ms: 180000,
  };

  // Fase 4: metric snapshots paired with the simulated stepData. Healthy =
  // judge actually ran (triggered++); broken = judge silently skipped
  // (skippedByReason['no-connector']++).
  //
  // Both before+after must seed `no-connector` so metric_growth's path
  // resolution returns numbers (delta math). The real registry seeds the same
  // way once the first skip lands; tests bake in 0 to mirror that floor.
  const HEALTHY_METRICS_BEFORE = { judge: { triggeredTotal: 0, skippedByReason: { 'no-connector': 0 } } };
  const HEALTHY_METRICS_AFTER = { judge: { triggeredTotal: 1, skippedByReason: { 'no-connector': 0 } } };
  const BROKEN_METRICS_BEFORE = { judge: { triggeredTotal: 0, skippedByReason: { 'no-connector': 0 } } };
  const BROKEN_METRICS_AFTER = { judge: { triggeredTotal: 0, skippedByReason: { 'no-connector': 1 } } };

  // Healthy state: the agent created a button, screenshot taken, judge ran
  // and rendered the .judge-verdict-card (page.locator returns visible: true).
  const HEALTHY_STEP_2 = makeStepData({
    toolsCalled: ['figma_render_jsx', 'figma_screenshot'],
    responseText: "I've created a button with 'Submit' label, blue background, white text, and rounded corners.",
    screenshotCount: 1,
    durationMs: 48000,
    page: fakePageReturns(true),
    metricsBefore: HEALTHY_METRICS_BEFORE,
    metricsAfter: HEALTHY_METRICS_AFTER,
  });

  // B-018 active: everything identical EXCEPT the judge harness was silently
  // skipped, so the .judge-verdict-card was never rendered (isVisible: false)
  // and the registry caught the silent skip via skippedByReason['no-connector'].
  const BROKEN_STEP_2 = makeStepData({
    toolsCalled: ['figma_render_jsx', 'figma_screenshot'],
    responseText: "I've created a button with 'Submit' label, blue background, white text, and rounded corners.",
    screenshotCount: 1,
    durationMs: 45000,
    page: fakePageReturns(false),
    metricsBefore: BROKEN_METRICS_BEFORE,
    metricsAfter: BROKEN_METRICS_AFTER,
  });

  it('step 2 assertions PASS when judge auto-triggered (healthy)', async () => {
    const { passed, results } = await evaluateAssertions(STEP_2_ASSERT, HEALTHY_STEP_2);
    expect(passed).toBe(true);
    expect(results.every((r: AssertionResult) => r.passed)).toBe(true);
  });

  it('step 2 assertions FAIL when B-018 active (judge silently skipped)', async () => {
    const { passed, results } = await evaluateAssertions(STEP_2_ASSERT, BROKEN_STEP_2);
    expect(passed).toBe(false);

    // Two-layer B-018 signature:
    //  1. dom_visible fails because the judge verdict card was never rendered
    //  2. metric_growth fails because triggeredTotal didn't grow AND
    //     skippedByReason['no-connector'] grew (Fase 4 semantic check)
    const failingNames = results.filter((r: AssertionResult) => !r.passed).map((r: AssertionResult) => r.name);
    expect(failingNames).toContain('dom_visible');
    expect(failingNames).toContain('metric_growth');
    const domFail = results.find((r: AssertionResult) => r.name === 'dom_visible');
    expect(domFail?.error).toMatch(/judge-verdict-card.*not visible/);

    // Non-B-018 assertions still pass — this is what makes the sentinel
    // precise: it does not false-positive on transport errors.
    const passingNames = results.filter((r: AssertionResult) => r.passed).map((r: AssertionResult) => r.name);
    expect(passingNames).toEqual(expect.arrayContaining(['tools_called_any_of', 'screenshots_min', 'duration_max_ms']));
  });

  it('step 8 (complex creation) also catches B-018 on the auto_layout path', async () => {
    // Complex creation uses figma_auto_layout — the broader tool set in the
    // OR assertion must still match, and the verdict card absence must still fail.
    const brokenComplex = makeStepData({
      toolsCalled: ['figma_render_jsx', 'figma_auto_layout', 'figma_screenshot'],
      responseText: 'Created a card with header, hero, and footer sections with social icons.',
      screenshotCount: 1,
      durationMs: 95000,
      page: fakePageReturns(false),
    });
    const { passed, results } = await evaluateAssertions(STEP_8_ASSERT, brokenComplex);
    expect(passed).toBe(false);
    const failing = results.filter((r: AssertionResult) => !r.passed);
    expect(failing).toHaveLength(1);
    expect(failing[0].name).toBe('dom_visible');
  });

  it('sentinel passes for any judge verdict variant (PASS or FAIL)', async () => {
    // Judge renders different headers depending on verdict, but the card class
    // .judge-verdict-card is constant. dom_visible doesn't care about text.
    const withVerdict = makeStepData({
      toolsCalled: ['figma_render_jsx', 'figma_screenshot'],
      responseText: 'Done.',
      screenshotCount: 1,
      durationMs: 50000,
      page: fakePageReturns(true),
      metricsBefore: HEALTHY_METRICS_BEFORE,
      metricsAfter: HEALTHY_METRICS_AFTER,
    });
    const { passed } = await evaluateAssertions(STEP_2_ASSERT, withVerdict);
    expect(passed).toBe(true);
  });

  // Negative test for prose echoing — with the dom_visible sentinel, the
  // agent can mention "quality check" conversationally without false-positive.
  // The sentinel is structural (DOM card class), not textual.
  it('sentinel is immune to agent prose echoing the phrase "quality check"', async () => {
    const withProseEcho = makeStepData({
      toolsCalled: ['figma_render_jsx', 'figma_screenshot'],
      responseText:
        "I've created the button. I'll do a quick quality check next: alignment looks " +
        'good, naming is consistent, no shadow needed. Ready for review!',
      screenshotCount: 1,
      durationMs: 47000,
      page: fakePageReturns(false), // no card rendered → judge did NOT run
      metricsBefore: BROKEN_METRICS_BEFORE,
      metricsAfter: BROKEN_METRICS_AFTER,
    });
    const { passed, results } = await evaluateAssertions(STEP_2_ASSERT, withProseEcho);
    // Judge did NOT actually run — sentinel must FAIL even though prose
    // mentions "quality check". The structural anchor immunizes us from prose drift.
    expect(passed).toBe(false);
    const failingNames = results.filter((r: AssertionResult) => !r.passed).map((r: AssertionResult) => r.name);
    expect(failingNames).toContain('dom_visible');
    // metric_growth also catches this case via Fase 4 semantic layer.
    expect(failingNames).toContain('metric_growth');
  });

  // Drift detection (review fix #4): parse the live assert blocks from
  // 14-judge-and-subagents.md and compare to the constants above. If script
  // 14 evolves and the test constants aren't updated, this test fails loudly
  // instead of letting the regression net silently rot.
  it('STEP_2_ASSERT and STEP_8_ASSERT match the live script 14 markdown', () => {
    const scriptPath = join(__dirname, '../../qa-scripts/14-judge-and-subagents.md');
    const content = readFileSync(scriptPath, 'utf8');
    // Extract every fenced ```assert ... ``` block. Non-greedy across newlines.
    const blockRe = /```assert\s*\n([\s\S]*?)\n```/g;
    const blocks: object[] = [];
    for (const m of content.matchAll(blockRe)) {
      const parsed = parseYaml(m[1]);
      if (parsed && typeof parsed === 'object') blocks.push(parsed);
    }

    // Script 14 has 4 assert blocks: step 2 (B-018), step 5 (judge-disabled),
    // step 6 (re-enable), step 8 (complex). Locate sentinel blocks by the
    // distinctive shape: figma_create_child + .judge-verdict-card dom_visible.
    expect(blocks.length).toBeGreaterThanOrEqual(4);

    type AssertBlock = {
      tools_called_any_of?: string[];
      dom_visible?: string;
      [k: string]: unknown;
    };
    const sentinels = (blocks as AssertBlock[]).filter(
      (b) =>
        Array.isArray(b.tools_called_any_of) &&
        b.tools_called_any_of.includes('figma_create_child') &&
        typeof b.dom_visible === 'string' &&
        b.dom_visible.includes('.judge-verdict-card'),
    );
    // Step 2 and step 8 — both must use the dom_visible structural anchor.
    expect(sentinels.length).toBe(2);
    for (const s of sentinels) {
      expect(s.dom_visible).toBe('.assistant-message:last-child .judge-verdict-card');
    }

    // Locate by exclusion: step 2 has 3 tools, step 8 has 4 (with auto_layout).
    const step2 = sentinels.find((s) => !s.tools_called_any_of?.includes('figma_auto_layout'));
    const step8 = sentinels.find((s) => s.tools_called_any_of?.includes('figma_auto_layout'));
    expect(step2).toBeDefined();
    expect(step8).toBeDefined();
    // The constants embedded in this test must match the markdown verbatim.
    expect(step2).toEqual(STEP_2_ASSERT);
    expect(step8).toEqual(STEP_8_ASSERT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sanity: registry exports and versioning
// ─────────────────────────────────────────────────────────────────────────────

describe('module exports', () => {
  it('DSL_VERSION is 1', () => {
    expect(DSL_VERSION).toBe(1);
  });

  it('ASSERTION_EVALUATORS registry has all 15 supported types (7 P1 + 2 metric + 2 judge + 4 design quality)', () => {
    const expected = [
      'tools_called',
      'tools_called_any_of',
      'tools_NOT_called_more_than',
      'response_contains',
      'screenshots_min',
      'duration_max_ms',
      'dom_visible',
      'metric',
      'metric_growth',
      'judge_triggered',
      'judge_verdict',
      'canvas_screenshot',
      'floor_check',
      'design_crit',
      'iteration_delta',
    ].sort();
    expect(Object.keys(ASSERTION_EVALUATORS).sort()).toEqual(expected);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// judge_triggered — heuristic fallback when metrics unavailable
// ─────────────────────────────────────────────────────────────────────────────

describe('judge_triggered heuristic fallback (no metrics)', () => {
  // No metricsBefore/metricsAfter → heuristic path

  it('detects judge activity via tool names when value=true', async () => {
    const r = await runOne(
      'judge_triggered',
      true,
      makeStepData({
        toolsCalled: ['figma_render_jsx', 'quality_check', 'figma_screenshot'],
        responseText: 'Done.',
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('heuristic');
  });

  it('detects judge activity via response text when value=true', async () => {
    const r = await runOne(
      'judge_triggered',
      true,
      makeStepData({
        toolsCalled: ['figma_render_jsx'],
        responseText: 'I ran a quality check and the verdict is PASS.',
      }),
    );
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('heuristic');
  });

  it('fails when no judge activity detected and value=true', async () => {
    const r = await runOne(
      'judge_triggered',
      true,
      makeStepData({
        toolsCalled: ['figma_render_jsx', 'figma_screenshot'],
        responseText: 'I created the button.',
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.error).toContain('no judge activity');
  });

  it('passes when no judge activity detected and value=false', async () => {
    const r = await runOne(
      'judge_triggered',
      false,
      makeStepData({
        toolsCalled: ['figma_set_fills'],
        responseText: 'Color updated.',
      }),
    );
    expect(r.passed).toBe(true);
  });

  it('fails when judge activity detected but value=false', async () => {
    const r = await runOne(
      'judge_triggered',
      false,
      makeStepData({
        toolsCalled: ['figma_render_jsx'],
        responseText: 'Quality check complete, verdict: pass.',
      }),
    );
    expect(r.passed).toBe(false);
    expect(r.error).toContain('judge activity detected');
  });

  it('handles numeric threshold with heuristic detection', async () => {
    const r = await runOne(
      'judge_triggered',
      2,
      makeStepData({
        toolsCalled: ['judge_check'],
        responseText: 'Done.',
      }),
    );
    // Heuristic can only detect presence, not count — passes with caveat
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('heuristic');
    expect(r.detail).toContain('exact count unavailable');
  });

  it('fails numeric threshold when no activity detected', async () => {
    const r = await runOne(
      'judge_triggered',
      2,
      makeStepData({
        toolsCalled: ['figma_set_fills'],
        responseText: 'Color updated.',
      }),
    );
    expect(r.passed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// metric / metric_growth (Fase 4 — Task 4.13)
// ─────────────────────────────────────────────────────────────────────────────

describe('metric', () => {
  function snap(judge: Partial<{ triggeredTotal: number; skippedByReason: Record<string, number> }> = {}) {
    return {
      schemaVersion: 1,
      judge: {
        triggeredTotal: 0,
        skippedByReason: {},
        ...judge,
      },
      tools: { callCount: 0, byName: { figma_set_fills: { calls: 3, errors: 0, totalDurationMs: 100 } } },
    };
  }

  it('passes when path satisfies > op', async () => {
    const r = await evaluateAssertions({ metric: { path: 'judge.triggeredTotal', op: '>', value: 0 } }, {
      metricsAfter: snap({ triggeredTotal: 2 }),
    } as any);
    expect(r.passed).toBe(true);
  });

  it('fails when actual does not satisfy ==', async () => {
    const r = await evaluateAssertions({ metric: { path: 'judge.triggeredTotal', op: '==', value: 5 } }, {
      metricsAfter: snap({ triggeredTotal: 2 }),
    } as any);
    expect(r.passed).toBe(false);
    expect(r.results[0].error).toMatch(/actual: 2/);
  });

  it('supports bracket-quoted paths for keys with dashes', async () => {
    const r = await evaluateAssertions(
      { metric: { path: "judge.skippedByReason['no-connector']", op: '>=', value: 1 } },
      { metricsAfter: snap({ skippedByReason: { 'no-connector': 1 } }) } as any,
    );
    expect(r.passed).toBe(true);
  });

  it('gracefully skips when metricsAfter is missing', async () => {
    const r = await evaluateAssertions({ metric: { path: 'judge.triggeredTotal', op: '>', value: 0 } }, {} as any);
    expect(r.passed).toBe(true);
    expect(r.results[0].detail).toMatch(/SKIPPED/);
  });

  it('rejects unknown op', async () => {
    const r = await evaluateAssertions({ metric: { path: 'judge.triggeredTotal', op: '=>', value: 0 } }, {
      metricsAfter: snap(),
    } as any);
    expect(r.passed).toBe(false);
    expect(r.results[0].error).toMatch(/op/);
  });

  it('fails when path resolves to undefined', async () => {
    const r = await evaluateAssertions({ metric: { path: 'judge.nonExistent', op: '>', value: 0 } }, {
      metricsAfter: snap(),
    } as any);
    expect(r.passed).toBe(false);
    expect(r.results[0].error).toMatch(/undefined/);
  });

  it('accepts array form for batching multiple checks', async () => {
    const r = await evaluateAssertions(
      {
        metric: [
          { path: 'judge.triggeredTotal', op: '>', value: 0 },
          { path: "judge.skippedByReason['no-connector']", op: '==', value: 0 },
        ],
      },
      { metricsAfter: snap({ triggeredTotal: 2, skippedByReason: { 'no-connector': 0 } }) } as any,
    );
    expect(r.passed).toBe(true);
  });

  it('array form reports the failing element index', async () => {
    const r = await evaluateAssertions(
      {
        metric: [
          { path: 'judge.triggeredTotal', op: '>', value: 0 },
          { path: 'judge.triggeredTotal', op: '==', value: 99 },
        ],
      },
      { metricsAfter: snap({ triggeredTotal: 2 }) } as any,
    );
    expect(r.passed).toBe(false);
    expect(r.results[0].error).toMatch(/\[1\]/);
  });
});

describe('metric_growth', () => {
  function pair(beforeVal: number, afterVal: number) {
    return {
      metricsBefore: { tools: { callCount: beforeVal } },
      metricsAfter: { tools: { callCount: afterVal } },
    };
  }

  it('passes when delta within maxGrowth', async () => {
    const r = await evaluateAssertions(
      { metric_growth: { path: 'tools.callCount', maxGrowth: 5 } },
      pair(10, 13) as any,
    );
    expect(r.passed).toBe(true);
  });

  it('fails when delta exceeds maxGrowth', async () => {
    const r = await evaluateAssertions(
      { metric_growth: { path: 'tools.callCount', maxGrowth: 2 } },
      pair(10, 15) as any,
    );
    expect(r.passed).toBe(false);
    expect(r.results[0].error).toMatch(/delta 5 > maxGrowth 2/);
  });

  it('supports exactGrowth', async () => {
    const ok = await evaluateAssertions(
      { metric_growth: { path: 'tools.callCount', exactGrowth: 1 } },
      pair(7, 8) as any,
    );
    expect(ok.passed).toBe(true);
    const bad = await evaluateAssertions(
      { metric_growth: { path: 'tools.callCount', exactGrowth: 1 } },
      pair(7, 9) as any,
    );
    expect(bad.passed).toBe(false);
  });

  it('supports minGrowth', async () => {
    const r = await evaluateAssertions({ metric_growth: { path: 'tools.callCount', minGrowth: 3 } }, pair(0, 2) as any);
    expect(r.passed).toBe(false);
    expect(r.results[0].error).toMatch(/< minGrowth 3/);
  });

  it('gracefully skips when metricsBefore or metricsAfter missing', async () => {
    const r = await evaluateAssertions({ metric_growth: { path: 'tools.callCount', maxGrowth: 5 } }, {
      metricsAfter: { tools: { callCount: 1 } },
    } as any);
    expect(r.passed).toBe(true);
    expect(r.results[0].detail).toMatch(/SKIPPED/);
  });

  it('rejects when no constraint specified', async () => {
    const r = await evaluateAssertions({ metric_growth: { path: 'tools.callCount' } }, pair(0, 1) as any);
    expect(r.passed).toBe(false);
    expect(r.results[0].error).toMatch(/maxGrowth.*minGrowth.*exactGrowth/);
  });

  it('treats both-undefined as delta 0 (sparse-map convention)', async () => {
    // Sparse-map convention: counters that have never fired aren't in the map.
    // The evaluator floors missing values to 0 so test scripts can assert
    // "did NOT happen" without pre-seeding the registry.
    const r = await evaluateAssertions(
      { metric_growth: { path: 'tools.byName.figma_set_fills.calls', maxGrowth: 1 } },
      { metricsBefore: { tools: { byName: {} } }, metricsAfter: { tools: { byName: {} } } } as any,
    );
    expect(r.passed).toBe(true);
  });

  it('fails loud when counter disappears (number → undefined)', async () => {
    // Monotonic counters should never regress to undefined. If they do, the
    // registry was reset, the snapshot schema drifted, or the path was renamed —
    // all of which must fail with a clear message instead of being coerced to
    // a negative delta that might accidentally pass a loose maxGrowth cap.
    const r = await evaluateAssertions(
      { metric_growth: { path: 'tools.byName.figma_set_fills.calls', maxGrowth: 10 } },
      {
        metricsBefore: { tools: { byName: { figma_set_fills: { calls: 5 } } } },
        metricsAfter: { tools: { byName: {} } },
      } as any,
    );
    expect(r.passed).toBe(false);
    expect(r.results[0].error).toMatch(/counter disappeared/);
    expect(r.results[0].error).toMatch(/before=5/);
  });

  it('fails when path resolves to a non-number, non-undefined value', async () => {
    // String at the path (not undefined) → cannot do delta math, fail loud.
    const r = await evaluateAssertions({ metric_growth: { path: 'tools.weird', maxGrowth: 1 } }, {
      metricsBefore: { tools: { weird: 'string' } },
      metricsAfter: { tools: { weird: 'still-a-string' } },
    } as any);
    expect(r.passed).toBe(false);
    expect(r.results[0].error).toMatch(/must resolve to numbers/);
  });

  it('accepts array form for batching multiple checks', async () => {
    const r = await evaluateAssertions(
      {
        metric_growth: [
          { path: 'tools.callCount', minGrowth: 1 },
          { path: 'tools.callCount', maxGrowth: 5 },
        ],
      },
      pair(0, 3) as any,
    );
    expect(r.passed).toBe(true);
  });

  it('array form fails on second-element violation with index', async () => {
    const r = await evaluateAssertions(
      {
        metric_growth: [
          { path: 'tools.callCount', minGrowth: 1 },
          { path: 'tools.callCount', maxGrowth: 2 },
        ],
      },
      pair(0, 5) as any,
    );
    expect(r.passed).toBe(false);
    expect(r.results[0].error).toMatch(/\[1\]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// canvas_screenshot — Design Quality Tipo A/B prerequisite
// ─────────────────────────────────────────────────────────────────────────────

describe('canvas_screenshot', () => {
  function makeFigmaExecute(response: string | object) {
    return async (_code: string) => (typeof response === 'string' ? response : JSON.stringify(response));
  }

  it('captures node and stores base64 on stepData._canvasScreenshot', async () => {
    const stepData = makeStepData({}) as any;
    stepData.figmaExecute = makeFigmaExecute({ base64: 'iVBORw0KG...', nodeId: '1:1', nodeName: 'ProfileCard' });
    const r = await runOne('canvas_screenshot', 'ProfileCard', stepData);
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('ProfileCard');
    expect(stepData._canvasScreenshot).toBe('iVBORw0KG...');
  });

  it('gracefully skips when figmaExecute is unavailable', async () => {
    const r = await runOne('canvas_screenshot', 'Card', makeStepData({}));
    expect(r.passed).toBe(true);
    expect(r.detail).toMatch(/SKIPPED/);
  });

  it('fails when node not found', async () => {
    const stepData = makeStepData({}) as any;
    stepData.figmaExecute = makeFigmaExecute({ error: 'node not found', pattern: 'Missing' });
    const r = await runOne('canvas_screenshot', 'Missing', stepData);
    expect(r.passed).toBe(false);
    expect(r.error).toContain('not found');
  });

  it('rejects non-string value', async () => {
    const r = await runOne('canvas_screenshot', 123, makeStepData({}));
    expect(r.passed).toBe(false);
    expect(r.error).toContain('non-empty string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// floor_check — Design Quality Tipo A (competency floor)
// ─────────────────────────────────────────────────────────────────────────────

describe('floor_check', () => {
  function makeFigmaExecute(response: object) {
    return async (_code: string) => JSON.stringify(response);
  }

  it('passes when all floor rules satisfied', async () => {
    const stepData = makeStepData({}) as any;
    stepData.figmaExecute = makeFigmaExecute({
      wcag_smoke: 0,
      hardcoded_colors: 0,
      default_names: 0,
      missing_auto_layout: 0,
      max_depth: 3,
    });
    const r = await runOne('floor_check', { find: 'Card' }, stepData);
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('all floor rules satisfied');
  });

  it('fails on default_names violation', async () => {
    const stepData = makeStepData({}) as any;
    stepData.figmaExecute = makeFigmaExecute({
      wcag_smoke: 0,
      hardcoded_colors: 0,
      default_names: 3,
      missing_auto_layout: 0,
      max_depth: 2,
    });
    const r = await runOne('floor_check', { find: 'Card' }, stepData);
    expect(r.passed).toBe(false);
    expect(r.error).toContain('default_names: 3 > 0');
  });

  it('gracefully skips when figmaExecute unavailable', async () => {
    const r = await runOne('floor_check', { find: 'Card' }, makeStepData({}));
    expect(r.passed).toBe(true);
    expect(r.detail).toMatch(/SKIPPED/);
  });

  it('rejects missing find field', async () => {
    const r = await runOne('floor_check', { rules: {} }, makeStepData({}));
    expect(r.passed).toBe(false);
    expect(r.error).toContain("field 'find'");
  });

  it('respects custom rules (nesting depth override)', async () => {
    const stepData = makeStepData({}) as any;
    stepData.figmaExecute = makeFigmaExecute({
      wcag_smoke: 0,
      hardcoded_colors: 0,
      default_names: 0,
      missing_auto_layout: 0,
      max_depth: 6,
    });
    const r = await runOne('floor_check', { find: 'Card', rules: { nesting_depth: 8 } }, stepData);
    expect(r.passed).toBe(true);
  });

  it('detects multiple violations in one check', async () => {
    const stepData = makeStepData({}) as any;
    stepData.figmaExecute = makeFigmaExecute({
      wcag_smoke: 2,
      hardcoded_colors: 5,
      default_names: 1,
      missing_auto_layout: 3,
      max_depth: 7,
    });
    const r = await runOne('floor_check', { find: 'Card' }, stepData);
    expect(r.passed).toBe(false);
    expect(r.error).toContain('wcag_smoke');
    expect(r.error).toContain('hardcoded_colors');
    expect(r.error).toContain('default_names');
    expect(r.error).toContain('missing_auto_layout');
    expect(r.error).toContain('nesting_depth');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// design_crit — Design Quality Tipo B (vision model evaluation)
// ─────────────────────────────────────────────────────────────────────────────

describe('design_crit', () => {
  function makeVisionEval(scores: Record<string, number>, mean: number, reasoning = 'test') {
    return async (_img: string, _prompt: string) => ({ scores, mean, reasoning });
  }

  it('passes when mean score >= threshold', async () => {
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    stepData.visionEval = makeVisionEval(
      { intent_match: 7, visual_craft: 8, design_decisions: 7, hierarchy: 7, consistency: 8 },
      7.4,
    );
    const r = await runOne('design_crit', { brief: 'A card', rubric: 'card', threshold: 6 }, stepData);
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('7.4');
    expect(r.detail).toContain('PASS');
  });

  it('fails when mean score < threshold', async () => {
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    stepData.visionEval = makeVisionEval(
      { intent_match: 4, visual_craft: 3, design_decisions: 4, hierarchy: 5, consistency: 4 },
      4.0,
    );
    const r = await runOne('design_crit', { brief: 'A card', rubric: 'card', threshold: 6 }, stepData);
    expect(r.passed).toBe(false);
    expect(r.detail).toContain('4.0');
    expect(r.detail).toContain('FAIL');
  });

  it('gracefully skips when visionEval unavailable', async () => {
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    const r = await runOne('design_crit', { brief: 'A card', rubric: 'card' }, stepData);
    expect(r.passed).toBe(true);
    expect(r.detail).toMatch(/SKIPPED/);
  });

  it('fails when no canvas screenshot available', async () => {
    const stepData = makeStepData({}) as any;
    stepData.visionEval = makeVisionEval({}, 7);
    const r = await runOne('design_crit', { brief: 'A card', rubric: 'card' }, stepData);
    expect(r.passed).toBe(false);
    expect(r.error).toContain('no canvas screenshot');
  });

  it('uses default threshold of 6 when not specified', async () => {
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    stepData.visionEval = makeVisionEval({ intent_match: 5 }, 5.9);
    const r = await runOne('design_crit', { brief: 'A card', rubric: 'card' }, stepData);
    expect(r.passed).toBe(false); // 5.9 < 6 default threshold
  });

  it('accepts inline value.screenshot instead of stepData._canvasScreenshot', async () => {
    const stepData = makeStepData({}) as any;
    // No _canvasScreenshot on stepData — inline screenshot should work
    stepData.visionEval = makeVisionEval({ intent_match: 8 }, 8.0);
    const r = await runOne(
      'design_crit',
      { brief: 'A card', rubric: 'card', screenshot: 'inline-base64-data' },
      stepData,
    );
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('8.0');
  });

  it('injects rubric content when rubricResolver is provided', async () => {
    let capturedPrompt = '';
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    stepData.rubricResolver = (type: string) =>
      type === 'card' ? '### Intent Match\n- **7**: Card that communicates professional' : null;
    stepData.visionEval = async (_img: string, prompt: string) => {
      capturedPrompt = prompt;
      return { scores: { intent_match: 7 }, mean: 7.0, reasoning: 'good' };
    };
    const r = await runOne('design_crit', { brief: 'A card', rubric: 'card' }, stepData);
    expect(r.passed).toBe(true);
    // The calibrated rubric content should be in the prompt
    expect(capturedPrompt).toContain('Calibrated Rubric');
    expect(capturedPrompt).toContain('Card that communicates professional');
  });

  it('falls back to generic dimensions when rubricResolver returns null', async () => {
    let capturedPrompt = '';
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    stepData.rubricResolver = () => null;
    stepData.visionEval = async (_img: string, prompt: string) => {
      capturedPrompt = prompt;
      return { scores: { intent_match: 7 }, mean: 7.0, reasoning: 'good' };
    };
    const r = await runOne('design_crit', { brief: 'A card', rubric: 'card' }, stepData);
    expect(r.passed).toBe(true);
    // Should use generic dimensions, not calibrated rubric
    expect(capturedPrompt).toContain('Rubric type: card');
    expect(capturedPrompt).toContain('Intent Match');
    expect(capturedPrompt).not.toContain('Calibrated Rubric');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// iteration_delta — Design Quality Tipo C (multi-round iteration eval)
// ─────────────────────────────────────────────────────────────────────────────

describe('iteration_delta', () => {
  function makeVisionEval(mean: number) {
    return async (_img: string, _prompt: string) => ({
      scores: { intent_match: mean, visual_craft: mean },
      mean,
      reasoning: 'test',
    });
  }

  it('round 1 always passes (baseline capture)', async () => {
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    stepData.visionEval = makeVisionEval(4.5);
    const r = await runOne('iteration_delta', { round: 1, brief: 'A card', rubric: 'card' }, stepData);
    expect(r.passed).toBe(true);
    expect(r.detail).toContain('R1 baseline');
    expect(r.detail).toContain('4.5');
    expect(stepData._roundScores).toEqual([4.5]);
  });

  it('round 3 passes when all thresholds met', async () => {
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    stepData._roundScores = [4.0, 5.5]; // R1=4.0, R2=5.5, now R3 will be scored
    stepData.visionEval = makeVisionEval(7.0);
    const r = await runOne(
      'iteration_delta',
      {
        round: 3,
        brief: 'A card',
        rubric: 'card',
        threshold_final: 6,
        threshold_delta_total: 2,
        threshold_delta_step: 0,
      },
      stepData,
    );
    expect(r.passed).toBe(true);
    // delta total: 7.0 - 4.0 = 3.0 >= 2 ✓
    // delta step: 7.0 - 5.5 = 1.5 >= 0 ✓
    // final: 7.0 >= 6 ✓
    expect(stepData._roundScores).toEqual([4.0, 5.5, 7.0]);
  });

  it('fails when total delta below threshold', async () => {
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    stepData._roundScores = [5.0, 5.5];
    stepData.visionEval = makeVisionEval(6.0);
    const r = await runOne(
      'iteration_delta',
      {
        round: 3,
        brief: 'A card',
        rubric: 'card',
        threshold_final: 6,
        threshold_delta_total: 2,
        threshold_delta_step: 0,
      },
      stepData,
    );
    expect(r.passed).toBe(false);
    // delta total: 6.0 - 5.0 = 1.0 < 2 ✗
    expect(r.error).toContain('total delta');
  });

  it('fails on regression (negative step delta)', async () => {
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    stepData._roundScores = [3.0, 7.0]; // R2 was high
    stepData.visionEval = makeVisionEval(5.0); // R3 regressed
    const r = await runOne(
      'iteration_delta',
      {
        round: 3,
        brief: 'A card',
        rubric: 'card',
        threshold_delta_step: 0,
      },
      stepData,
    );
    expect(r.passed).toBe(false);
    expect(r.error).toContain('step delta');
    expect(r.error).toContain('regression');
  });

  it('gracefully skips when visionEval unavailable', async () => {
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    const r = await runOne('iteration_delta', { round: 1, brief: 'A card', rubric: 'card' }, stepData);
    expect(r.passed).toBe(true);
    expect(r.detail).toMatch(/SKIPPED/);
  });

  it('rejects invalid round number', async () => {
    const r = await runOne('iteration_delta', { round: 0, brief: 'A card', rubric: 'card' }, makeStepData({}));
    expect(r.passed).toBe(false);
    expect(r.error).toContain('positive integer');
  });

  it('fails on out-of-sequence round (round 3 with only 1 prior score)', async () => {
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    stepData._roundScores = [4.0]; // only 1 prior score, but round says 3 (expects 2)
    stepData.visionEval = makeVisionEval(7.0);
    const r = await runOne(
      'iteration_delta',
      {
        round: 3,
        brief: 'A card',
        rubric: 'card',
      },
      stepData,
    );
    expect(r.passed).toBe(false);
    expect(r.error).toContain('round 3 requires 2 prior score(s)');
    expect(r.error).toContain('found 1');
  });

  it('fails on skipped round 1 (round 2 with no prior scores)', async () => {
    const stepData = makeStepData({}) as any;
    stepData._canvasScreenshot = 'iVBOR...';
    stepData.visionEval = makeVisionEval(5.0);
    const r = await runOne(
      'iteration_delta',
      {
        round: 2,
        brief: 'A card',
        rubric: 'card',
      },
      stepData,
    );
    expect(r.passed).toBe(false);
    expect(r.error).toContain('round 2 requires 1 prior score(s)');
    expect(r.error).toContain('found 0');
  });

  it('provides clear error when canvas_screenshot not run first', async () => {
    const stepData = makeStepData({}) as any;
    stepData.visionEval = makeVisionEval(7.0);
    // No _canvasScreenshot
    const r = await runOne('iteration_delta', { round: 1, brief: 'A card', rubric: 'card' }, stepData);
    expect(r.passed).toBe(false);
    expect(r.error).toContain('canvas_screenshot must run before');
  });
});
