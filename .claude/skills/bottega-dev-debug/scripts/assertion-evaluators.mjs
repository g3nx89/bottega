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
 *   figmaExecute?: (code: string) => Promise<string>,
 *   visionEval?: (imageBase64: string, prompt: string) => Promise<{ scores: Record<string, number>, mean: number, reasoning: string }>,
 *   rubricResolver?: (rubricType: string) => string | null,
 *   _canvasScreenshot?: string,
 *   _roundScores?: number[],
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

// ── Design Quality evaluators (Tipo A/B/C) ──────────────────────────────────
//
// Ordering contract: evaluateAssertions iterates Object.entries(block) which
// preserves insertion order for string keys in modern JS. Scripts MUST list
// canvas_screenshot BEFORE design_crit / iteration_delta in their assert
// blocks so the screenshot is captured before it is consumed.

/**
 * Shared Figma plugin code: find a node by normalized name pattern, with fallback
 * to the largest top-level frame on the page. Returns a code snippet that sets `node`
 * and `usedFallback` variables. Caller must declare `let node;` before inserting.
 */
function buildNodeFinderCode(namePattern) {
  return `
    const pattern = ${JSON.stringify(namePattern)}.replace(/[\\s_-]/g, '').toLowerCase();
    let usedFallback = false;
    // Find ALL matching nodes, then pick the largest by area.
    // findOne returns depth-first first match which may be a small child node
    // (e.g. "BankLogin/PasswordPlaceholder" before "BankLogin" root frame).
    const matches = figma.currentPage.findAll(n => n.name.replace(/[\\s_-]/g, '').toLowerCase().includes(pattern));
    if (matches.length > 0) {
      node = matches[0];
      if (matches.length > 1) {
        let bestArea = 0;
        for (const m of matches) {
          const area = (m.width || 0) * (m.height || 0);
          if (area > bestArea) { node = m; bestArea = area; }
        }
      }
    }
    if (!node) {
      let best = null, bestArea = 0;
      for (const child of figma.currentPage.children) {
        if (child.type === 'FRAME' || child.type === 'COMPONENT') {
          const area = child.width * child.height;
          if (area > bestArea) { best = child; bestArea = area; }
        }
      }
      if (best) { node = best; usedFallback = true; }
    }`;
}

/** Shared: check that stepData.figmaExecute is available. Returns a SKIPPED pass or null. */
function requireFigmaExecute(name, stepData) {
  if (!stepData.figmaExecute || typeof stepData.figmaExecute !== 'function') {
    return pass(name, 'SKIPPED — figmaExecute unavailable (requires live Figma connection)');
  }
  return null;
}

/** Shared: validate vision-eval prerequisites (brief, rubric, visionEval, screenshot).
 *  Returns { result } on validation failure/skip, or { screenshot } on success. */
function requireVisionContext(name, value, stepData) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { result: fail(name, `expected object with 'brief' and 'rubric', got ${typeOf(value)}`) };
  }
  if (typeof value.brief !== 'string' || value.brief.length === 0) {
    return { result: fail(name, "field 'brief' must be a non-empty string") };
  }
  if (typeof value.rubric !== 'string' || value.rubric.length === 0) {
    return { result: fail(name, "field 'rubric' must be a non-empty string (rubric type or content)") };
  }
  if (!stepData.visionEval || typeof stepData.visionEval !== 'function') {
    return { result: pass(name, 'SKIPPED — visionEval unavailable (requires vision model configuration)') };
  }
  const screenshot = value.screenshot || stepData._canvasScreenshot;
  if (!screenshot) {
    return { result: fail(name, 'no canvas screenshot available — canvas_screenshot must run before this evaluator in the assert block, or provide value.screenshot') };
  }
  return { screenshot };
}

/**
 * canvas_screenshot — find a Figma node by name pattern and export its PNG.
 * Stores the base64 result on stepData._canvasScreenshot for downstream evaluators.
 * Value: string (node name substring to match)
 *
 * Requires stepData.figmaExecute. Gracefully skips when unavailable.
 */
async function evalCanvasScreenshot(value, stepData) {
  if (typeof value !== 'string' || value.length === 0) {
    return fail('canvas_screenshot', `expected non-empty string (node name pattern), got ${typeOf(value)}`);
  }
  const skip = requireFigmaExecute('canvas_screenshot', stepData);
  if (skip) return skip;
  try {
    const code = `
      let node;
      ${buildNodeFinderCode(value)}
      if (!node) return JSON.stringify({ error: "node not found and no frames on page", pattern: ${JSON.stringify(value)} });
      figma.viewport.scrollAndZoomIntoView([node]);
      await new Promise(r => setTimeout(r, 500));
      // Export with white background: create temp rect behind the node, group, export, then undo
      const w = node.width || 400;
      const h = node.height || 300;
      const bg = figma.createRectangle();
      bg.resize(w, h);
      bg.x = node.x;
      bg.y = node.y;
      bg.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      const parent = node.parent || figma.currentPage;
      const idx = parent.children.indexOf(node);
      if (idx >= 0) parent.insertChild(idx, bg);
      else parent.appendChild(bg);
      const group = figma.group([bg, node], parent);
      const bytes = await group.exportAsync({ format: 'PNG', constraint: { type: 'SCALE', value: 2 } });
      // Undo: ungroup and remove temp bg
      parent.insertChild(idx >= 0 ? idx : parent.children.length, node);
      bg.remove();
      group.remove();
      return JSON.stringify({ base64: figma.base64Encode(bytes), nodeId: node.id, nodeName: node.name, usedFallback: usedFallback });
    `;
    const raw = await stepData.figmaExecute(code);
    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return fail('canvas_screenshot', `figmaExecute returned non-JSON (${typeof raw}, ${String(raw).slice(0, 200)})`);
    }
    if (result.error) {
      return fail('canvas_screenshot', `node not found matching '${value}' — ${result.error}`);
    }
    if (!result.base64 || result.base64.length === 0) {
      return fail('canvas_screenshot', `export returned empty base64 for node '${result.nodeName}' (keys: ${Object.keys(result).join(',')}, raw length: ${String(raw).length})`);
    }
    // Store for downstream evaluators (design_crit, iteration_delta)
    stepData._canvasScreenshot = result.base64;
    const fallbackNote = result.usedFallback ? ' (fallback: name not matched, used largest frame)' : '';
    return pass('canvas_screenshot', `captured ${result.nodeName} (${result.nodeId}), ${result.base64.length} chars base64${fallbackNote}`);
  } catch (err) {
    return fail('canvas_screenshot', `figmaExecute error: ${err && err.message ? err.message : String(err)}`);
  }
}

/**
 * floor_check — automated competency floor for design creations.
 * Runs lint + tree walk via figmaExecute plugin code.
 * Value: { find: string, rules?: { wcag_smoke?: number, hardcoded_colors?: number,
 *          default_names?: number, auto_layout?: "required"|"optional", nesting_depth?: number } }
 *
 * Default rules: wcag_smoke: 0, hardcoded_colors: 0, default_names: 0, auto_layout: "required", nesting_depth: 5
 *
 * Note: wcag_smoke is a simplified luminance-only heuristic (flags mid-range text
 * luminance 0.4-0.6 without considering background). It catches obvious issues
 * but is NOT a full WCAG contrast ratio check. For comprehensive accessibility
 * auditing, use a dedicated tool.
 */
async function evalFloorCheck(value, stepData) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('floor_check', `expected object with 'find' field, got ${typeOf(value)}`);
  }
  if (typeof value.find !== 'string' || value.find.length === 0) {
    return fail('floor_check', "field 'find' must be a non-empty string (node name pattern)");
  }
  const skip = requireFigmaExecute('floor_check', stepData);
  if (skip) return skip;
  const rules = {
    wcag_smoke: 0,
    hardcoded_colors: 0,
    default_names: 0,
    auto_layout: 'required',
    nesting_depth: 5,
    ...(value.rules || {}),
  };
  try {
    const code = `
      let node;
      ${buildNodeFinderCode(value.find)}
      if (!node) return JSON.stringify({ error: "node not found" });

      const issues = { wcag_smoke: 0, hardcoded_colors: 0, default_names: 0, missing_auto_layout: 0, max_depth: 0 };
      // Require trailing digit(s): "Frame 1" is default, "Frame" alone may be intentional
      const defaultNameRe = /^(Frame|Rectangle|Ellipse|Group|Vector|Line|Text|Polygon|Star)\\s+\\d+$/;

      function walk(n, depth) {
        if (depth > issues.max_depth) issues.max_depth = depth;
        if (defaultNameRe.test(n.name)) issues.default_names++;

        // Check fills for hardcoded colors (non-bound)
        if ('fills' in n && Array.isArray(n.fills)) {
          for (const fill of n.fills) {
            if (fill.type === 'SOLID' && fill.boundVariables == null) {
              issues.hardcoded_colors++;
            }
          }
        }

        // Simplified contrast smoke test: flag text with mid-range luminance (0.4-0.6)
        // where contrast against any background is likely poor. NOT a full WCAG check —
        // does not consider parent background color or contrast ratio.
        if (n.type === 'TEXT' && 'fills' in n && Array.isArray(n.fills)) {
          for (const fill of n.fills) {
            if (fill.type === 'SOLID' && fill.color) {
              const lum = 0.2126 * fill.color.r + 0.7152 * fill.color.g + 0.0722 * fill.color.b;
              if (lum < 0.05 || lum > 0.95) { /* extreme values only — likely OK */ }
              else if (lum > 0.4 && lum < 0.6) issues.wcag_smoke++;
            }
          }
        }

        // Check auto-layout on frames with 2+ children (single-child frames are
        // often structural wrappers that don't need auto-layout)
        if ((n.type === 'FRAME' || n.type === 'COMPONENT') && 'children' in n && n.children.length >= 2) {
          if (!n.layoutMode || n.layoutMode === 'NONE') {
            issues.missing_auto_layout++;
          }
        }

        if ('children' in n) {
          for (const child of n.children) walk(child, depth + 1);
        }
      }
      walk(node, 0);
      issues.usedFallback = usedFallback;
      issues.nodeName = node.name;
      return JSON.stringify(issues);
    `;
    const raw = await stepData.figmaExecute(code);
    const result = JSON.parse(raw);
    if (result.error) {
      return fail('floor_check', `node not found matching '${value.find}'`);
    }

    const violations = [];
    if (result.wcag_smoke > rules.wcag_smoke) {
      violations.push(`wcag_smoke: ${result.wcag_smoke} > ${rules.wcag_smoke}`);
    }
    if (result.hardcoded_colors > rules.hardcoded_colors) {
      violations.push(`hardcoded_colors: ${result.hardcoded_colors} > ${rules.hardcoded_colors}`);
    }
    if (result.default_names > rules.default_names) {
      violations.push(`default_names: ${result.default_names} > ${rules.default_names}`);
    }
    if (rules.auto_layout === 'required' && result.missing_auto_layout > 0) {
      violations.push(`missing_auto_layout: ${result.missing_auto_layout} frame(s) without auto-layout`);
    }
    if (typeof rules.nesting_depth === 'number' && result.max_depth > rules.nesting_depth) {
      violations.push(`nesting_depth: ${result.max_depth} > ${rules.nesting_depth}`);
    }

    const fallbackNote = result.usedFallback ? ` (fallback: evaluated '${result.nodeName}' instead of '${value.find}')` : '';
    if (violations.length === 0) {
      return pass('floor_check', `all floor rules satisfied for '${value.find}'${fallbackNote}`);
    }
    return fail('floor_check', `floor violations: ${violations.join('; ')}${fallbackNote}`);
  } catch (err) {
    return fail('floor_check', `figmaExecute error: ${err && err.message ? err.message : String(err)}`);
  }
}

/**
 * design_crit — vision-model design critique using a calibrated rubric.
 * Requires canvas_screenshot to have run first (reads stepData._canvasScreenshot),
 * OR accepts inline base64 via value.screenshot.
 *
 * Value: { brief: string, rubric: "card"|"hero"|"form"|"screen"|string, threshold?: number }
 *   threshold defaults to 6.
 *
 * Rubric content is resolved via stepData.rubricResolver(rubricType). If the resolver
 * is unavailable or returns null, falls back to generic dimension names. When the
 * full rubric content is available, the calibrated verbal anchors (3/5/7/9) are
 * injected into the vision model prompt for precise scoring calibration.
 *
 * Requires stepData.visionEval. Gracefully skips when unavailable.
 * Returns: pass if mean score ≥ threshold, fail otherwise.
 */
async function evalDesignCrit(value, stepData) {
  const ctx = requireVisionContext('design_crit', value, stepData);
  if (ctx.result) return ctx.result;
  const threshold = typeof value.threshold === 'number' ? value.threshold : 6;
  try {
    const rubricContent = resolveRubric(value.rubric, stepData);
    const prompt = buildDesignCritPrompt(value.brief, value.rubric, rubricContent);
    const result = await stepData.visionEval(ctx.screenshot, prompt);
    if (!result || typeof result.mean !== 'number') {
      return fail('design_crit', `visionEval returned invalid result: ${JSON.stringify(result)}`);
    }
    const scoreDetail = Object.entries(result.scores || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ');
    const detail = `mean=${result.mean.toFixed(1)}/10 (${scoreDetail}) — ${result.reasoning || 'no reasoning'}`;
    if (result.mean >= threshold) {
      return pass('design_crit', `PASS (${result.mean.toFixed(1)} >= ${threshold}): ${detail}`);
    }
    return fail('design_crit', `FAIL (${result.mean.toFixed(1)} < ${threshold}): ${detail}`);
  } catch (err) {
    return fail('design_crit', `visionEval error: ${err && err.message ? err.message : String(err)}`);
  }
}

/** Resolve rubric content from stepData.rubricResolver, returning null if unavailable. */
function resolveRubric(rubricType, stepData) {
  if (stepData.rubricResolver && typeof stepData.rubricResolver === 'function') {
    try {
      return stepData.rubricResolver(rubricType) || null;
    } catch (err) {
      // Log but don't fail — gracefully degrade to generic dimensions
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(`rubricResolver('${rubricType}') threw:`, err);
      }
      return null;
    }
  }
  return null;
}

/**
 * Build the prompt for the vision model design critique.
 * When rubricContent is provided, injects the full calibrated anchors.
 * When null, falls back to generic dimension names.
 */
function buildDesignCritPrompt(brief, rubricType, rubricContent) {
  const parts = [
    'You are a senior design critic evaluating a Figma canvas screenshot.',
    `\n## Brief\n${brief}`,
  ];
  if (rubricContent) {
    parts.push(`\n## Calibrated Rubric (${rubricType})\n${rubricContent}`);
    parts.push('\n## Scoring instructions');
    parts.push('Use the rubric above to score each dimension 1-10. The anchors at 3, 5, 7, 9 are calibration points — interpolate between them.');
  } else {
    parts.push(`\n## Rubric type: ${rubricType}`);
    parts.push('\n## Scoring instructions');
    parts.push('Evaluate the design on these 5 dimensions, scoring each 1-10:');
    parts.push('1. **Intent Match** — Does the design respond to the brief?');
    parts.push('2. **Visual Craft** — Is it curated? (spacing, shadows, typography)');
    parts.push('3. **Design Decisions** — Are choices intentional and reasoned?');
    parts.push('4. **Hierarchy** — Does the visual hierarchy guide the eye naturally?');
    parts.push('5. **Consistency** — Does it feel like part of a design system?');
  }
  parts.push('\n## Important context');
  parts.push('The PNG is exported from Figma with a TRANSPARENT background. Dark-themed designs may appear as light content on a black/transparent background — this is expected. Evaluate the actual design content, not the background. If the design intentionally uses a dark theme, score the content quality, not the darkness.');
  parts.push('\nRespond in JSON: { "scores": { "intent_match": N, "visual_craft": N, "design_decisions": N, "hierarchy": N, "consistency": N }, "mean": N, "reasoning": "..." }');
  parts.push('Be calibrated: 5 = acceptable baseline, 7 = professional quality, 9 = exceptional.');
  return parts.join('\n');
}

/**
 * iteration_delta — multi-round design iteration scoring.
 * Tracks scores across rounds and evaluates improvement deltas.
 *
 * Value: { round: number, brief: string, rubric: string,
 *          threshold_final?: number, threshold_delta_total?: number,
 *          threshold_delta_step?: number }
 *
 * Defaults: threshold_final: 6, threshold_delta_total: 2, threshold_delta_step: 0
 *
 * For round 1: captures baseline score. Always passes (no delta yet).
 * For round N > 1: captures score and evaluates deltas against thresholds.
 * Uses stepData._roundScores (array) to accumulate across rounds.
 *
 * Round sequence is validated: round N requires exactly N-1 prior scores in
 * _roundScores. Out-of-order or skipped rounds fail with a clear message.
 */
async function evalIterationDelta(value, stepData) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('iteration_delta', `expected object, got ${typeOf(value)}`);
  }
  if (typeof value.round !== 'number' || !Number.isInteger(value.round) || value.round < 1) {
    return fail('iteration_delta', "field 'round' must be a positive integer");
  }
  if (typeof value.brief !== 'string' || value.brief.length === 0) {
    return fail('iteration_delta', "field 'brief' must be a non-empty string");
  }
  if (typeof value.rubric !== 'string' || value.rubric.length === 0) {
    return fail('iteration_delta', "field 'rubric' must be a non-empty string");
  }
  if (!stepData.visionEval || typeof stepData.visionEval !== 'function') {
    return pass('iteration_delta', 'SKIPPED — visionEval unavailable (requires vision model configuration)');
  }
  const screenshot = stepData._canvasScreenshot;
  if (!screenshot) {
    return fail('iteration_delta', 'no canvas screenshot available — canvas_screenshot must run before this evaluator in the assert block');
  }

  // Validate round sequence: round N requires exactly N-1 prior scores
  if (!stepData._roundScores) stepData._roundScores = [];
  const expectedPriorScores = value.round - 1;
  if (stepData._roundScores.length !== expectedPriorScores) {
    return fail('iteration_delta',
      `round ${value.round} requires ${expectedPriorScores} prior score(s) in _roundScores, ` +
      `but found ${stepData._roundScores.length} — rounds may have been skipped or run out of order`);
  }

  const thresholdFinal = typeof value.threshold_final === 'number' ? value.threshold_final : 6;
  const thresholdDeltaTotal = typeof value.threshold_delta_total === 'number' ? value.threshold_delta_total : 2;
  const thresholdDeltaStep = typeof value.threshold_delta_step === 'number' ? value.threshold_delta_step : 0;

  try {
    const rubricContent = resolveRubric(value.rubric, stepData);
    const prompt = buildDesignCritPrompt(value.brief, value.rubric, rubricContent);
    const result = await stepData.visionEval(screenshot, prompt);
    if (!result || typeof result.mean !== 'number') {
      return fail('iteration_delta', `visionEval returned invalid result: ${JSON.stringify(result)}`);
    }

    stepData._roundScores.push(result.mean);

    const round = value.round;
    const scores = stepData._roundScores;
    const currentScore = result.mean;

    if (round === 1) {
      return pass('iteration_delta', `R1 baseline: ${currentScore.toFixed(1)}/10`);
    }

    // Evaluate deltas for round > 1
    const failures = [];
    const details = [];
    const firstScore = scores[0];
    const prevScore = scores[scores.length - 2];
    const deltaTotal = currentScore - firstScore;
    const deltaStep = currentScore - prevScore;

    details.push(`R${round}: ${currentScore.toFixed(1)}/10`);
    details.push(`delta R1→R${round}: ${deltaTotal >= 0 ? '+' : ''}${deltaTotal.toFixed(1)}`);
    details.push(`delta R${round - 1}→R${round}: ${deltaStep >= 0 ? '+' : ''}${deltaStep.toFixed(1)}`);

    // Final round checks
    if (round === scores.length && currentScore < thresholdFinal) {
      failures.push(`final score ${currentScore.toFixed(1)} < threshold ${thresholdFinal}`);
    }
    if (deltaTotal < thresholdDeltaTotal) {
      failures.push(`total delta ${deltaTotal.toFixed(1)} < threshold ${thresholdDeltaTotal}`);
    }
    if (deltaStep < thresholdDeltaStep) {
      failures.push(`step delta ${deltaStep.toFixed(1)} < threshold ${thresholdDeltaStep} (regression)`);
    }

    const detail = `${details.join(', ')} [scores: ${scores.map(s => s.toFixed(1)).join(' → ')}]`;
    if (failures.length === 0) {
      return pass('iteration_delta', detail);
    }
    return fail('iteration_delta', `${failures.join('; ')} — ${detail}`);
  } catch (err) {
    return fail('iteration_delta', `visionEval error: ${err && err.message ? err.message : String(err)}`);
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
    return pass('metric', 'SKIPPED — metricsAfter unavailable (rebuild with BOTTEGA_AGENT_TEST=1 for precise metric assertions)');
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
    return pass('metric_growth', 'SKIPPED — metricsBefore/metricsAfter unavailable (rebuild with BOTTEGA_AGENT_TEST=1 for precise metric growth assertions)');
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
  // B-021: When metrics are unavailable (non-test build), fall back to heuristic
  // detection: look for judge-related evidence in tool calls or response text.
  if (!stepData.metricsBefore || !stepData.metricsAfter) {
    const judgeToolPatterns = ['judge', 'quality_check', 'quality check'];
    const toolNames = (stepData.toolsCalled || []).map(t => (typeof t === 'string' ? t : t.name || '').toLowerCase());
    const hasJudgeTool = toolNames.some(n => judgeToolPatterns.some(p => n.includes(p)));
    const responseText = (stepData.responseText || stepData.responseTextTruncated || '').toLowerCase();
    const hasJudgeText = /quality check|judge|verdict|pass ✓|pass ✔|suggestions|criteria/.test(responseText);
    const detected = hasJudgeTool || hasJudgeText;

    if (value === true) {
      return detected
        ? pass('judge_triggered', 'judge activity detected via heuristic (metrics unavailable)')
        : fail('judge_triggered', 'no judge activity detected (metrics unavailable — rebuild with BOTTEGA_AGENT_TEST=1 for precise tracking)');
    }
    if (value === false) {
      return !detected
        ? pass('judge_triggered', 'no judge activity detected (as expected, metrics unavailable)')
        : fail('judge_triggered', 'judge activity detected but expected none (metrics unavailable)');
    }
    // Numeric threshold: heuristic can only detect presence, not count
    return detected
      ? pass('judge_triggered', `judge activity detected via heuristic (exact count unavailable — rebuild with BOTTEGA_AGENT_TEST=1)`)
      : fail('judge_triggered', `no judge activity detected (metrics unavailable)`);
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
    return pass('judge_verdict', 'SKIPPED — metricsAfter unavailable (rebuild with BOTTEGA_AGENT_TEST=1 for verdict count assertions)');
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
  canvas_screenshot: evalCanvasScreenshot,
  floor_check: evalFloorCheck,
  design_crit: evalDesignCrit,
  iteration_delta: evalIterationDelta,
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
