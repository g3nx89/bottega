// assertion-evaluators.mjs
// Day 2 Fase 2 deliverable — evaluators for the QA assertion DSL.
// See tests/qa-scripts/ASSERTION-DSL.md for the spec.
//
// All evaluators are async functions of `(value, stepData)`. No imports —
// `page` is passed in via stepData and used only by `dom_visible`. Tests
// inject a fake page shaped as:
//   { locator: (sel) => ({ first: () => ({ isVisible: async (opts) => bool }) }) }

/** @typedef {{
 *   toolsCalled: string[],
 *   responseText: string,
 *   responseTextTruncated?: string,
 *   screenshotCount: number,
 *   durationMs: number,
 *   page?: { locator: (sel: string) => { first: () => { isVisible: (opts?: object) => Promise<boolean> } } },
 *   metricsBefore?: object,
 *   metricsAfter?: object,
 * }} StepData */

/** @typedef {{ name: string, passed: boolean, error: string | null, detail?: string }} AssertionResult */

export const DSL_VERSION = 1;

// ── 7 P1 evaluators ──────────────────────────────────────────────────────────

/**
 * tools_called — exact case-insensitive match. ALL required tools must be present (AND).
 * Value: string[]
 */
async function evalToolsCalled(value, stepData) {
  if (!Array.isArray(value)) {
    return fail('tools_called', `expected array, got ${typeOf(value)}`);
  }
  const actualLower = (stepData.toolsCalled || []).map((t) => String(t).toLowerCase());
  const missing = value.filter((req) => {
    const reqLower = String(req).toLowerCase();
    return !actualLower.some((t) => t === reqLower);
  });
  if (missing.length === 0) {
    return pass('tools_called', `all required tools present: [${value.join(', ')}]`);
  }
  return fail(
    'tools_called',
    `missing tool(s): [${missing.join(', ')}] — actual: [${(stepData.toolsCalled || []).join(', ')}]`,
  );
}

/**
 * tools_called_any_of — OR semantics. At least one of the listed tools must be called.
 * Value: string[]
 */
async function evalToolsCalledAnyOf(value, stepData) {
  if (!Array.isArray(value)) {
    return fail('tools_called_any_of', `expected array, got ${typeOf(value)}`);
  }
  if (value.length === 0) {
    return fail('tools_called_any_of', 'empty array — at least one required tool needed');
  }
  const actualLower = (stepData.toolsCalled || []).map((t) => String(t).toLowerCase());
  const matched = value.find((req) => actualLower.includes(String(req).toLowerCase()));
  if (matched != null) {
    return pass('tools_called_any_of', `matched on '${matched}'`);
  }
  return fail(
    'tools_called_any_of',
    `none of [${value.join(', ')}] called — actual: [${(stepData.toolsCalled || []).join(', ')}]`,
  );
}

/**
 * tools_NOT_called_more_than — cap on occurrences per tool. Inclusive (`<=`).
 * Value: { [toolName: string]: number }
 */
async function evalToolsNotCalledMoreThan(value, stepData) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('tools_NOT_called_more_than', `expected object, got ${typeOf(value)}`);
  }
  const actualLower = (stepData.toolsCalled || []).map((t) => String(t).toLowerCase());
  const violations = [];
  for (const [name, cap] of Object.entries(value)) {
    if (typeof cap !== 'number' || !Number.isFinite(cap) || cap < 0) {
      return fail(
        'tools_NOT_called_more_than',
        `cap for '${name}' must be a non-negative number, got ${typeOf(cap)}`,
      );
    }
    const nameLower = name.toLowerCase();
    const count = actualLower.filter((t) => t === nameLower).length;
    if (count > cap) {
      violations.push(`${name}: ${count} > ${cap}`);
    }
  }
  if (violations.length === 0) {
    return pass('tools_NOT_called_more_than', 'all caps respected');
  }
  return fail('tools_NOT_called_more_than', `cap violations: ${violations.join('; ')}`);
}

/**
 * response_contains — substring presence check on the agent's full response text.
 * Value: string | string[] | { any_of?: string[], all_of?: string[], case_sensitive?: boolean }
 *
 * Forms:
 *   1. string    → { all_of: [string], case_sensitive: false }
 *   2. string[]  → { all_of: [...], case_sensitive: false }
 *   3. object    → exactly one of any_of / all_of (default case_sensitive: false)
 */
async function evalResponseContains(value, stepData) {
  const text = stepData.responseText ?? '';
  const normalized = normalizeResponseContainsValue(value);
  if (normalized.error) {
    return fail('response_contains', normalized.error);
  }
  const { needles, mode, caseSensitive } = normalized;
  const haystack = caseSensitive ? text : text.toLowerCase();
  const transformed = needles.map((n) => (caseSensitive ? n : n.toLowerCase()));

  if (mode === 'all_of') {
    const missing = needles.filter((_, i) => !haystack.includes(transformed[i]));
    if (missing.length === 0) {
      return pass('response_contains', `all_of matched: [${needles.join(', ')}]`);
    }
    return fail(
      'response_contains',
      `missing all_of: [${missing.join(', ')}] (case_sensitive=${caseSensitive})`,
    );
  }
  // any_of
  const matchedIdx = transformed.findIndex((t) => haystack.includes(t));
  if (matchedIdx >= 0) {
    return pass('response_contains', `any_of matched on '${needles[matchedIdx]}'`);
  }
  return fail(
    'response_contains',
    `none of any_of matched: [${needles.join(', ')}] (case_sensitive=${caseSensitive})`,
  );
}

/** Normalize response_contains polymorphic value. Returns {needles,mode,caseSensitive} or {error}. */
function normalizeResponseContainsValue(value) {
  // Form 1: bare string
  if (typeof value === 'string') {
    return { needles: [value], mode: 'all_of', caseSensitive: false };
  }
  // Form 2: bare array (all_of)
  if (Array.isArray(value)) {
    if (!value.every((v) => typeof v === 'string')) {
      return { error: 'array form requires all elements to be strings' };
    }
    if (value.length === 0) {
      return { error: 'array form must not be empty' };
    }
    return { needles: value, mode: 'all_of', caseSensitive: false };
  }
  // Form 3: object {any_of|all_of, case_sensitive?}
  if (typeof value === 'object' && value !== null) {
    const hasAny = Array.isArray(value.any_of);
    const hasAll = Array.isArray(value.all_of);
    if (hasAny && hasAll) {
      return { error: 'object form must have exactly one of any_of / all_of, not both' };
    }
    if (!hasAny && !hasAll) {
      return { error: 'object form must have any_of or all_of (array of strings)' };
    }
    const needles = hasAny ? value.any_of : value.all_of;
    if (!needles.every((v) => typeof v === 'string')) {
      return { error: `${hasAny ? 'any_of' : 'all_of'} requires all elements to be strings` };
    }
    if (needles.length === 0) {
      return { error: `${hasAny ? 'any_of' : 'all_of'} must not be empty` };
    }
    // Strict boolean validation: reject "true" string or numeric 1 — prior behavior
    // silently coerced any non-literal-true to false, flipping caller intent.
    if (value.case_sensitive !== undefined && typeof value.case_sensitive !== 'boolean') {
      return {
        error: `case_sensitive must be a boolean (true/false), got ${typeOf(value.case_sensitive)}`,
      };
    }
    return {
      needles,
      mode: hasAny ? 'any_of' : 'all_of',
      caseSensitive: value.case_sensitive === true,
    };
  }
  return { error: `expected string | array | object, got ${typeOf(value)}` };
}

/**
 * screenshots_min — count of screenshot images in the assistant message DOM.
 * Value: integer (>= 0)
 */
async function evalScreenshotsMin(value, stepData) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return fail('screenshots_min', `expected non-negative integer, got ${typeOf(value)} ${value}`);
  }
  const actual = stepData.screenshotCount ?? 0;
  if (actual >= value) {
    return pass('screenshots_min', `${actual} >= ${value}`);
  }
  return fail('screenshots_min', `expected >= ${value}, got ${actual}`);
}

/**
 * duration_max_ms — wall-clock cap on step duration. Inclusive (`<=`).
 * Value: positive number
 */
async function evalDurationMaxMs(value, stepData) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fail('duration_max_ms', `expected positive number, got ${typeOf(value)} ${value}`);
  }
  const actual = stepData.durationMs ?? 0;
  if (actual <= value) {
    return pass('duration_max_ms', `${actual}ms <= ${value}ms`);
  }
  return fail('duration_max_ms', `${actual}ms > ${value}ms (over cap by ${actual - value}ms)`);
}

/**
 * dom_visible — selector must match a visible element. timeout: 0 (no Playwright auto-wait).
 * Value: non-empty CSS selector string
 */
async function evalDomVisible(value, stepData) {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('dom_visible', `expected non-empty selector string, got ${typeOf(value)}`);
  }
  if (!stepData.page || typeof stepData.page.locator !== 'function') {
    return fail('dom_visible', 'page object missing or invalid (no .locator method)');
  }
  try {
    const locator = stepData.page.locator(value).first();
    const visible = await locator.isVisible({ timeout: 0 });
    if (visible) {
      return pass('dom_visible', `selector '${value}' is visible`);
    }
    return fail('dom_visible', `selector '${value}' is not visible`);
  } catch (err) {
    return fail(
      'dom_visible',
      `locator error for '${value}': ${err && err.message ? err.message : String(err)}`,
    );
  }
}

// ── Registry + dispatcher ────────────────────────────────────────────────────

/**
 * metric — assert a value at a dotted path in the post-step MetricsRegistry snapshot.
 * Value: spec | spec[] where spec = { path, op, value }
 *   • op is one of '==', '!=', '>', '>=', '<', '<='
 *
 * Array form is required when a single step needs more than one `metric`
 * assertion (YAML mappings don't allow duplicate keys, so we batch via array).
 *
 * stepData.metricsAfter must be populated by the runner (qa-runner captures it
 * via tests/helpers/metrics-client.mjs after sendPromptAndWait settles).
 *
 * Examples:
 *   metric: { path: "judge.triggeredTotal", op: ">", value: 0 }
 *   metric:
 *     - { path: "judge.triggeredTotal", op: ">", value: 0 }
 *     - { path: "judge.skippedByReason['no-connector']", op: "==", value: 0 }
 */
async function evalMetric(value, stepData) {
  if (!stepData.metricsAfter) {
    return fail('metric', 'stepData.metricsAfter missing — runner did not capture post-step metrics');
  }
  const specs = Array.isArray(value) ? value : [value];
  if (specs.length === 0) return fail('metric', 'empty spec list');
  const failures = [];
  const passDetails = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const v = validateMetricSpec(spec, 'metric');
    if (v.error) {
      failures.push(`[${i}] ${v.error}`);
      continue;
    }
    const actual = readPath(stepData.metricsAfter, v.path);
    if (actual === undefined) {
      failures.push(`[${i}] path '${v.path}' resolved to undefined`);
      continue;
    }
    if (compareOp(actual, v.op, v.expected)) {
      passDetails.push(`${v.path} ${v.op} ${JSON.stringify(v.expected)}`);
    } else {
      failures.push(`[${i}] ${v.path} ${v.op} ${JSON.stringify(v.expected)} failed — actual: ${JSON.stringify(actual)}`);
    }
  }
  if (failures.length === 0) {
    return pass('metric', `all ${specs.length} satisfied: ${passDetails.join('; ')}`);
  }
  return fail('metric', failures.join('; '));
}

/**
 * metric_growth — assert delta `metricsAfter - metricsBefore` at a dotted path.
 * Value: spec | spec[] where spec = { path, maxGrowth?, minGrowth?, exactGrowth? }
 *   • At least one of maxGrowth / minGrowth / exactGrowth required.
 *
 * Array form lets a single step batch multiple growth checks (YAML mappings
 * don't allow duplicate keys).
 *
 * Examples:
 *   metric_growth: { path: "tools.callCount", maxGrowth: 5 }
 *   metric_growth:
 *     - { path: "judge.triggeredTotal", minGrowth: 1 }
 *     - { path: "judge.skippedByReason['no-connector']", exactGrowth: 0 }
 */
async function evalMetricGrowth(value, stepData) {
  if (!stepData.metricsBefore || !stepData.metricsAfter) {
    return fail(
      'metric_growth',
      'stepData.metricsBefore/metricsAfter missing — runner did not capture metrics around step',
    );
  }
  const specs = Array.isArray(value) ? value : [value];
  if (specs.length === 0) return fail('metric_growth', 'empty spec list');
  const failures = [];
  const passDetails = [];
  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const r = evalSingleMetricGrowth(spec, stepData);
    if (r.passed) passDetails.push(r.detail);
    else failures.push(`[${i}] ${r.error}`);
  }
  if (failures.length === 0) {
    return pass('metric_growth', `all ${specs.length} satisfied: ${passDetails.join('; ')}`);
  }
  return fail('metric_growth', failures.join('; '));
}

function evalSingleMetricGrowth(spec, stepData) {
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) {
    return { passed: false, error: `expected object, got ${typeOf(spec)}` };
  }
  if (typeof spec.path !== 'string' || spec.path.length === 0) {
    return { passed: false, error: "field 'path' must be a non-empty string" };
  }
  const constraints = ['maxGrowth', 'minGrowth', 'exactGrowth'].filter((k) => spec[k] !== undefined);
  if (constraints.length === 0) {
    return { passed: false, error: 'must specify at least one of maxGrowth / minGrowth / exactGrowth' };
  }
  for (const k of constraints) {
    if (typeof spec[k] !== 'number' || !Number.isFinite(spec[k])) {
      return { passed: false, error: `${k} must be a finite number, got ${typeOf(spec[k])}` };
    }
  }
  // Sparse-map convention: counters in skippedByReason / tools.byName only
  // appear in the snapshot once a counter has fired at least once. Missing
  // paths are treated as 0 so test scripts can assert "did NOT happen" without
  // pre-seeding the registry. Both undefined → delta 0. A number→undefined
  // transition, however, is never legitimate (counters are monotonic) and
  // means the registry was reset, the snapshot schema drifted, or the path
  // was renamed — all of which should fail loud rather than coerce to -N.
  const beforeRaw = readPath(stepData.metricsBefore, spec.path);
  const afterRaw = readPath(stepData.metricsAfter, spec.path);
  if (beforeRaw !== undefined && afterRaw === undefined) {
    return {
      passed: false,
      error: `${spec.path}: counter disappeared between snapshots (before=${beforeRaw}, after=undefined) — registry reset or schema drift`,
    };
  }
  const before = beforeRaw === undefined ? 0 : beforeRaw;
  const after = afterRaw === undefined ? 0 : afterRaw;
  if (typeof before !== 'number' || typeof after !== 'number') {
    return {
      passed: false,
      error: `path '${spec.path}' must resolve to numbers (before=${typeOf(beforeRaw)}, after=${typeOf(afterRaw)})`,
    };
  }
  const delta = after - before;
  if (spec.exactGrowth !== undefined && delta !== spec.exactGrowth) {
    return { passed: false, error: `${spec.path}: delta ${delta} != exactGrowth ${spec.exactGrowth}` };
  }
  if (spec.maxGrowth !== undefined && delta > spec.maxGrowth) {
    return { passed: false, error: `${spec.path}: delta ${delta} > maxGrowth ${spec.maxGrowth}` };
  }
  if (spec.minGrowth !== undefined && delta < spec.minGrowth) {
    return { passed: false, error: `${spec.path}: delta ${delta} < minGrowth ${spec.minGrowth}` };
  }
  return { passed: true, detail: `${spec.path} delta ${delta}` };
}

// ── judge_triggered / judge_verdict evaluators (Fase 7.1A) ─────────────────

/**
 * judge_triggered — verify the judge fired (or did NOT fire) during this step.
 * Value:
 *   true       → at least 1 trigger
 *   false      → exactly 0 triggers
 *   N (number) → at least N triggers
 */
async function evalJudgeTriggered(value, stepData) {
  if (!stepData.metricsBefore || !stepData.metricsAfter) {
    return fail('judge_triggered', 'metricsBefore/metricsAfter missing — cannot compute delta');
  }
  const beforeTotal = readPath(stepData.metricsBefore, 'judge.triggeredTotal') ?? 0;
  const afterTotal = readPath(stepData.metricsAfter, 'judge.triggeredTotal') ?? 0;
  const delta = afterTotal - beforeTotal;

  if (value === false) {
    return delta === 0
      ? pass('judge_triggered', 'judge did NOT trigger (as expected)')
      : fail('judge_triggered', `expected 0 triggers, got ${delta}`);
  }
  if (value === true) {
    return delta >= 1
      ? pass('judge_triggered', `judge triggered ${delta} time(s)`)
      : fail('judge_triggered', `expected at least 1 trigger, got ${delta}`);
  }
  if (typeof value === 'number') {
    return delta >= value
      ? pass('judge_triggered', `judge triggered ${delta} time(s) (>= ${value})`)
      : fail('judge_triggered', `expected >= ${value} triggers, got ${delta}`);
  }
  return fail('judge_triggered', `value must be boolean or number, got ${typeOf(value)}`);
}

/**
 * judge_verdict — verify verdict count distribution from metricsAfter.
 * Value: object mapping verdict keys (PASS, FAIL, UNKNOWN) to comparison strings.
 *   judge_verdict:
 *     PASS: ">= 1"
 *     FAIL: "== 0"
 */
async function evalJudgeVerdict(value, stepData) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('judge_verdict', `expected object, got ${typeOf(value)}`);
  }
  if (!stepData.metricsAfter) {
    return fail('judge_verdict', 'metricsAfter missing — cannot read verdict counts');
  }
  const failures = [];
  const passDetails = [];
  for (const [verdict, spec] of Object.entries(value)) {
    const actual = readPath(stepData.metricsAfter, `judge.verdictCounts.${verdict}`) ?? 0;
    const match = String(spec).match(/^\s*(==|!=|>=|<=|>|<)\s*(\d+)\s*$/);
    if (!match) {
      failures.push(`${verdict}: invalid spec "${spec}" — expected "op N" (e.g. ">= 1")`);
      continue;
    }
    const [, op, numStr] = match;
    const expected = Number(numStr);
    if (compareOp(actual, op, expected)) {
      passDetails.push(`${verdict}: ${actual} ${op} ${expected}`);
    } else {
      failures.push(`${verdict}: ${actual} ${op} ${expected} failed`);
    }
  }
  if (failures.length === 0) {
    return pass('judge_verdict', passDetails.join('; '));
  }
  return fail('judge_verdict', failures.join('; '));
}

/** Registry of all evaluators. Keys are assertion type names. */
export const ASSERTION_EVALUATORS = {
  tools_called: evalToolsCalled,
  tools_called_any_of: evalToolsCalledAnyOf,
  tools_NOT_called_more_than: evalToolsNotCalledMoreThan,
  response_contains: evalResponseContains,
  screenshots_min: evalScreenshotsMin,
  duration_max_ms: evalDurationMaxMs,
  dom_visible: evalDomVisible,
  metric: evalMetric,
  metric_growth: evalMetricGrowth,
  judge_triggered: evalJudgeTriggered,
  judge_verdict: evalJudgeVerdict,
};

// ── metric/metric_growth helpers ─────────────────────────────────────────────

const VALID_OPS = new Set(['==', '!=', '>', '>=', '<', '<=']);

function validateMetricSpec(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: `expected object, got ${typeOf(value)}` };
  }
  if (typeof value.path !== 'string' || value.path.length === 0) {
    return { error: `${label}: field 'path' must be a non-empty string` };
  }
  if (!VALID_OPS.has(value.op)) {
    return { error: `${label}: field 'op' must be one of ${[...VALID_OPS].join(', ')}, got ${value.op}` };
  }
  if (value.value === undefined) {
    return { error: `${label}: field 'value' is required` };
  }
  return { path: value.path, op: value.op, expected: value.value };
}

function compareOp(actual, op, expected) {
  switch (op) {
    case '==':
      return actual === expected;
    case '!=':
      return actual !== expected;
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    default:
      return false;
  }
}

/**
 * Resolve a dotted path against a snapshot. Supports bracket-quoted segments
 * for keys with special characters: foo['bar-baz'] / foo["bar-baz"].
 * Mirrors metrics-client.mjs#readPath so the runner and the DSL agree on
 * what a "path" means.
 */
function readPath(snap, path) {
  if (snap == null) return undefined;
  const normalized = path
    .replace(/\[['"]([^'"\]]+)['"]\]/g, '.$1')
    .replace(/\[(\d+)\]/g, '.$1');
  let cur = snap;
  for (const seg of normalized.split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

/**
 * Evaluate every assertion in `block` against `stepData`.
 * Returns { passed, results } — passed is true only if every result has passed === true.
 * Unknown assertion types FAIL loud (per DD-6 / spec section 2).
 *
 * @param {Record<string, unknown>} block
 * @param {StepData} stepData
 * @returns {Promise<{ passed: boolean, results: AssertionResult[] }>}
 */
export async function evaluateAssertions(block, stepData) {
  if (typeof block !== 'object' || block === null || Array.isArray(block)) {
    return {
      passed: false,
      results: [fail('_block', `assert block must be a mapping, got ${typeOf(block)}`)],
    };
  }
  const results = [];
  for (const [type, value] of Object.entries(block)) {
    const evaluator = ASSERTION_EVALUATORS[type];
    if (!evaluator) {
      results.push(fail(type, `unknown assertion type: ${type}`));
      continue;
    }
    try {
      const result = await evaluator(value, stepData);
      results.push(result);
    } catch (err) {
      results.push(
        fail(type, `evaluator threw: ${err && err.message ? err.message : String(err)}`),
      );
    }
  }
  const passed = results.every((r) => r.passed === true);
  return { passed, results };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pass(name, detail) {
  return { name, passed: true, error: null, detail };
}

function fail(name, detail) {
  return { name, passed: false, error: detail, detail };
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
