// Ambient declaration for the .mjs evaluator (lives in .claude/, gitignored).
// Import target: ../../../.claude/skills/bottega-dev-debug/scripts/assertion-evaluators.mjs
//
// This shim gives the test file proper types instead of `any`, eliminating
// the need for `as AssertionResult` casts. The runtime contract is documented
// in tests/qa-scripts/ASSERTION-DSL.md §4 and enforced at runtime by the
// evaluators themselves.
//
// Module resolution note: TypeScript resolves this `.d.ts` for the .mjs import
// because it sits next to the test file in the same package and matches the
// `@ts-expect-error`-free import path. If you move the test file, move this
// declaration too.

declare module '*/assertion-evaluators.mjs' {
  export interface StepData {
    toolsCalled: string[];
    responseText: string;
    responseTextTruncated?: string;
    screenshotCount: number;
    durationMs: number;
    page?: {
      locator: (selector: string) => {
        first: () => {
          isVisible: (opts?: { timeout?: number }) => Promise<boolean>;
        };
      };
    };
    metricsBefore?: Record<string, unknown>;
    metricsAfter?: Record<string, unknown>;
  }

  export interface AssertionResult {
    name: string;
    passed: boolean;
    error: string | null;
    detail?: string;
  }

  export type AssertionEvaluator = (value: unknown, stepData: StepData) => Promise<AssertionResult>;

  export const DSL_VERSION: 1;

  export const ASSERTION_EVALUATORS: {
    tools_called: AssertionEvaluator;
    tools_called_any_of: AssertionEvaluator;
    tools_NOT_called_more_than: AssertionEvaluator;
    response_contains: AssertionEvaluator;
    screenshots_min: AssertionEvaluator;
    duration_max_ms: AssertionEvaluator;
    dom_visible: AssertionEvaluator;
  };

  export function evaluateAssertions(
    block: Record<string, unknown>,
    stepData: StepData,
  ): Promise<{ passed: boolean; results: AssertionResult[] }>;
}
