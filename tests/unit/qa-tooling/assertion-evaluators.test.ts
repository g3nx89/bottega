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
        judge_triggered: true, // P2 type, not yet implemented
      },
      makeStepData({ toolsCalled: ['figma_execute'] }),
    );
    expect(passed).toBe(false);
    const unknown = results.find((r: AssertionResult) => r.name === 'judge_triggered');
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
  };

  // Step 8 (complex creation) adds figma_auto_layout to the tool set.
  const STEP_8_ASSERT = {
    tools_called_any_of: ['figma_render_jsx', 'figma_execute', 'figma_create_child', 'figma_auto_layout'],
    screenshots_min: 1,
    dom_visible: '.assistant-message:last-child .judge-verdict-card',
    duration_max_ms: 180000,
  };

  // Healthy state: the agent created a button, screenshot taken, judge ran
  // and rendered the .judge-verdict-card (page.locator returns visible: true).
  const HEALTHY_STEP_2 = makeStepData({
    toolsCalled: ['figma_render_jsx', 'figma_screenshot'],
    responseText: "I've created a button with 'Submit' label, blue background, white text, and rounded corners.",
    screenshotCount: 1,
    durationMs: 48000,
    page: fakePageReturns(true),
  });

  // B-018 active: everything identical EXCEPT the judge harness was silently
  // skipped, so the .judge-verdict-card was never rendered (isVisible: false).
  const BROKEN_STEP_2 = makeStepData({
    toolsCalled: ['figma_render_jsx', 'figma_screenshot'],
    responseText: "I've created a button with 'Submit' label, blue background, white text, and rounded corners.",
    screenshotCount: 1,
    durationMs: 45000,
    page: fakePageReturns(false),
  });

  it('step 2 assertions PASS when judge auto-triggered (healthy)', async () => {
    const { passed, results } = await evaluateAssertions(STEP_2_ASSERT, HEALTHY_STEP_2);
    expect(passed).toBe(true);
    expect(results.every((r: AssertionResult) => r.passed)).toBe(true);
  });

  it('step 2 assertions FAIL when B-018 active (judge silently skipped)', async () => {
    const { passed, results } = await evaluateAssertions(STEP_2_ASSERT, BROKEN_STEP_2);
    expect(passed).toBe(false);

    // The specific failure signature of B-018: dom_visible fails because the
    // judge verdict card was never rendered, while everything else (tools ran,
    // screenshot taken, duration fine) still passes.
    const failing = results.filter((r: AssertionResult) => !r.passed);
    expect(failing).toHaveLength(1);
    expect(failing[0].name).toBe('dom_visible');
    expect(failing[0].error).toMatch(/judge-verdict-card.*not visible/);

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
    });
    const { passed, results } = await evaluateAssertions(STEP_2_ASSERT, withProseEcho);
    // Judge did NOT actually run — sentinel must FAIL even though prose
    // mentions "quality check". The structural anchor immunizes us from prose drift.
    expect(passed).toBe(false);
    const failing = results.filter((r: AssertionResult) => !r.passed);
    expect(failing).toHaveLength(1);
    expect(failing[0].name).toBe('dom_visible');
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

  it('ASSERTION_EVALUATORS registry has exactly 7 P1 types', () => {
    const expected = [
      'tools_called',
      'tools_called_any_of',
      'tools_NOT_called_more_than',
      'response_contains',
      'screenshots_min',
      'duration_max_ms',
      'dom_visible',
    ].sort();
    expect(Object.keys(ASSERTION_EVALUATORS).sort()).toEqual(expected);
  });
});
