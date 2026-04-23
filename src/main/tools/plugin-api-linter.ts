/**
 * Pre-flight linter for figma_execute code.
 *
 * Regex-based detection of patterns that WILL throw at runtime based on Bottega's
 * Plugin API Safety Rules (system-prompt rules 1-20 + figma-execute-safety reference).
 *
 * Purpose: fail fast before WebSocket roundtrip. Plugin timeout ~30s per call;
 * returning a linter error saves ~30s × retry count on each violation class.
 *
 * Scope: deliberately narrow — only patterns with ~0% false-positive rate.
 * Single tokenizer (`stripSource`) with a `keepStrings` flag handles both
 * syntactic rules (strings blanked) and literal-matching rules (strings kept).
 *
 * Authors can opt code out with comment directives:
 *   // lint-disable-next-line <ruleId>     — disables only the following line
 *   // lint-disable <ruleId>               — disables from here to end of source
 */

export type LintSeverity = 'error' | 'warning';
export type RuleKind = 'syntactic' | 'literal';

export interface LintIssue {
  severity: LintSeverity;
  ruleId: string;
  message: string;
  hint: string;
  /** 1-based line number in the original source where the pattern matched. */
  line?: number;
}

export interface LintResult {
  ok: boolean;
  errors: LintIssue[];
  warnings: LintIssue[];
}

/**
 * Strip JS/TS comments (always) and optionally string/template content.
 * Preserves line positions (replacements use whitespace of equal length)
 * so match indices map back to original line numbers.
 *
 * When `keepStrings` is true, string/template body is retained — useful for
 * rules matching on literal tokens like `"ALL_SCOPES"`. When false, string
 * interiors are blanked out (empty-quote placeholders) so syntactic rules
 * don't match inside arbitrary user text.
 */
export function stripSource(src: string, opts: { keepStrings: boolean }): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? '';
    const next = src[i + 1] ?? '';

    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out.push(' ');
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '*') {
      out.push('  ');
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out.push(src[i] === '\n' ? '\n' : ' ');
        i++;
      }
      if (i < src.length) {
        out.push('  ');
        i += 2;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      if (opts.keepStrings) {
        out.push(ch);
        i++;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === '\\' && i + 1 < src.length) {
            out.push(src[i] ?? '', src[i + 1] ?? '');
            i += 2;
            continue;
          }
          out.push(src[i] ?? '');
          i++;
        }
        if (i < src.length) {
          out.push(src[i] ?? '');
          i++;
        }
      } else {
        out.push(quote, quote);
        i++;
        while (i < src.length && src[i] !== quote) {
          if (src[i] === '\\' && i + 1 < src.length) {
            out.push(src[i] === '\n' ? '\n' : ' ', src[i + 1] === '\n' ? '\n' : ' ');
            i += 2;
            continue;
          }
          out.push(src[i] === '\n' ? '\n' : ' ');
          i++;
        }
        if (i < src.length) i++;
      }
      continue;
    }

    out.push(ch);
    i++;
  }
  return out.join('');
}

/**
 * Parse `// lint-disable` / `// lint-disable-next-line` directives.
 * Returns map of ruleId → set of 1-based line numbers where it's disabled.
 * - `lint-disable <id>` disables from its line to EOF
 * - `lint-disable-next-line <id>` disables only the following line
 * Runs on the original source (directives live in comments).
 */
export function parseDisableDirectives(src: string): Map<string, Set<number>> {
  const disabled = new Map<string, Set<number>>();
  const lines = src.split('\n');
  const totalLines = lines.length;
  const add = (id: string, line: number) => {
    let set = disabled.get(id);
    if (!set) {
      set = new Set();
      disabled.set(id, set);
    }
    set.add(line);
  };
  const directive = /\/\/\s*lint-disable(-next-line)?\s+([a-zA-Z0-9_,\s-]+)/;
  for (let idx = 0; idx < totalLines; idx++) {
    const line = lines[idx] ?? '';
    const m = directive.exec(line);
    if (!m) continue;
    const isNextLine = Boolean(m[1]);
    const ids = (m[2] ?? '')
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((s) => s.trim());
    const startLine = idx + 1;
    if (isNextLine) {
      for (const id of ids) add(id, startLine + 1);
    } else {
      for (const id of ids) {
        for (let l = startLine; l <= totalLines; l++) add(id, l);
      }
    }
  }
  return disabled;
}

/** Compute 1-based line number for a byte offset in source. */
function offsetToLine(src: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === '\n') line++;
  }
  return line;
}

interface Rule {
  id: string;
  kind: RuleKind;
  severity: LintSeverity;
  pattern: RegExp;
  message: string;
  hint: string;
  /** Plugin API version where this restriction applies (informational). */
  pluginApiSince?: string;
}

// Intentionally NOT enforced here (from mcp-server-guide v2.1.7 gotchas):
// `"object is not extensible"` — thrown when assigning to a node property that
// doesn't exist on that type (e.g. `strokeDashes` instead of `dashPattern`, or
// any invented property). A regex rule would require an allowlist of ~300
// Plugin API properties per node type to avoid churning on legitimate code,
// and that allowlist would drift across Plugin API releases. The behavioral
// guidance (grep the typings before assigning unfamiliar properties) lives in
// system-prompt Rule 19 instead — the agent learns the pattern declaratively
// rather than being blocked at pre-flight.

// HARD ERRORS — pattern will throw at runtime, caller refuses to execute
export const HARD_ERROR_RULES: Rule[] = [
  {
    id: 'sync-currentPage-setter',
    kind: 'syntactic',
    severity: 'error',
    pattern: /\bfigma\s*\.\s*currentPage\s*=(?!=)/,
    message: 'Synchronous `figma.currentPage = page` throws in dynamic-page mode',
    hint: 'Use `await figma.setCurrentPageAsync(page)` instead',
    pluginApiSince: '1.90',
  },
  {
    id: 'width-height-readonly',
    kind: 'syntactic',
    severity: 'error',
    // Require property access ending at `width`/`height` (exclude minWidth, widthChanged, etc).
    pattern: /\.\s*(width|height)(?![a-zA-Z0-9_])\s*=(?!=)/,
    message: '`node.width` and `node.height` are READ-ONLY; assignment throws',
    hint: 'Use `node.resize(w, h)` or `node.resizeWithoutConstraints(w, h)`',
  },
  {
    id: 'get-plugin-data',
    kind: 'syntactic',
    severity: 'error',
    pattern: /\.\s*(get|set)PluginData\s*\(/,
    message: 'getPluginData/setPluginData are NOT available in this environment',
    hint: 'Use `node.getSharedPluginData(namespace, key)` / `setSharedPluginData(namespace, key, value)`',
  },
  {
    id: 'get-local-components',
    kind: 'syntactic',
    severity: 'error',
    pattern: /\bfigma\s*\.\s*getLocalComponent(?:Sets|s)\s*\(/,
    message: '`figma.getLocalComponents()` / `getLocalComponentSets()` do NOT exist',
    hint: 'Use `figma.root.findAll(n => n.type === "COMPONENT")` or `findAllWithCriteria({ types: ["COMPONENT"] })`',
  },
  {
    id: 'all-scopes-variable',
    kind: 'literal',
    severity: 'error',
    pattern: /['"]ALL_SCOPES['"]/,
    message: '`ALL_SCOPES` variable scope breaks binding UX — picker shows variable everywhere',
    hint: 'Set specific scopes per variable type (e.g., ["CORNER_RADIUS"], ["GAP"], ["WIDTH_HEIGHT"])',
  },
  {
    id: 'primary-axis-sizing-fill',
    kind: 'literal',
    severity: 'error',
    pattern: /\bprimaryAxisSizingMode\s*=\s*['"]FILL['"]/,
    message: '`primaryAxisSizingMode = "FILL"` is INVALID — enum only accepts "FIXED" / "AUTO"',
    hint: 'On the frame use "AUTO" or "FIXED"; on children use `child.layoutSizingHorizontal = "FILL"`',
  },
  {
    id: 'paint-color-alpha',
    kind: 'syntactic',
    // Match `color: { ..., a: ... }` inside paint objects.
    // `[^{}]*` excludes nested braces so we only flag flat paint-color literals,
    // not unrelated outer structures that happen to contain `color:` and `a:`.
    // Variable values use top-level `{r,g,b,a}` (no `color:` prefix) and are unaffected.
    //
    // Known limitation: `GradientPaint.gradientStops[].color` legally accepts
    // `{r,g,b,a}`, but we can't distinguish "gradient stop context" from
    // "solid paint context" with a regex alone — both use the same `color:`
    // key. `severity: warning` (not `error`) so legitimate gradient code
    // still proceeds; the hint surfaces the variable-value / gradient-stop
    // exceptions so the agent can correct solid-paint mistakes while
    // gradient code passes through.
    pattern: /\bcolor\s*:\s*\{[^{}]*\ba\s*:/,
    severity: 'warning',
    message: 'Paint `color` must not include `a` — throws "Unrecognized key(s) in object: \'a\'"',
    hint: 'Use `opacity` at the paint level: `{ type: "SOLID", color: {r,g,b}, opacity: 0.5 }`. Variable values with `{r,g,b,a}` are the only exception — those do NOT live under a `color:` key.',
  },
];

// WARNINGS — pattern is likely a bug but not always fatal; never blocks.
// (missing-return rule removed: contradicted figma-execute-safety.md:26 which
// explicitly sanctions side-effect-only IIFEs without outer return.)
export const WARNING_RULES: Rule[] = [
  {
    id: 'no-font-load-before-text',
    kind: 'syntactic',
    severity: 'warning',
    pattern: /\.\s*characters\s*=(?!=)/,
    message: 'Assignment to `.characters` detected — ensure `await figma.loadFontAsync(...)` was called first',
    hint: 'Pattern: `await figma.loadFontAsync(fontName); node.fontName = fontName; node.characters = "..."`',
  },
  {
    id: 'direct-fill-color-mutation',
    kind: 'syntactic',
    severity: 'warning',
    // Match any index form: fills[0], fills[i], fills[fills.length - 1]
    pattern: /\.\s*fills\s*\[[^\]]+\]\s*\.\s*color\s*\.\s*[rgba]\s*=(?!=)/,
    message: 'Direct mutation `fills[i].color.X = ...` silently fails (fills array is immutable)',
    hint: 'Clone and reassign: `node.fills = node.fills.map(f => ({...f, color: {...f.color, r: 0.5}}))`',
  },
  {
    id: 'type-specific-method-without-guard',
    kind: 'syntactic',
    severity: 'warning',
    // TEXT: getStyledTextSegments / setRange*
    // COMPONENT_SET: createVariant
    // COMPONENT/COMPONENT_SET: addComponentProperty
    // Warning only — a guard may exist earlier in the flow that regex can't see.
    // MAINTENANCE: update the alternation list when Plugin API adds new
    // node-type-specific methods. Cross-reference:
    //   https://www.figma.com/plugin-docs/api/nodes/
    pattern:
      /\.(getStyledTextSegments|setRangeFontName|setRangeFontSize|setRangeFills|setRangeTextStyleId|createVariant|addComponentProperty)\s*\(/,
    message: 'Type-specific method call — throws "not a function" if node type is wrong',
    hint: 'Guard first: `if (node?.type !== "TEXT") return`. TEXT: setRange*, getStyledTextSegments. COMPONENT_SET: createVariant. COMPONENT/COMPONENT_SET: addComponentProperty.',
  },
];

const RULES: Rule[] = [...HARD_ERROR_RULES, ...WARNING_RULES];

/**
 * Lint figma_execute code. Returns structured errors/warnings.
 * Callers should refuse execution if `ok === false`.
 */
export function lintPluginCode(code: string): LintResult {
  if (!code || typeof code !== 'string') {
    return { ok: true, errors: [], warnings: [] };
  }

  const syntactic = stripSource(code, { keepStrings: false });
  const literal = stripSource(code, { keepStrings: true });
  const disabled = parseDisableDirectives(code);
  const errors: LintIssue[] = [];
  const warnings: LintIssue[] = [];

  for (const rule of RULES) {
    const target = rule.kind === 'literal' ? literal : syntactic;
    const match = rule.pattern.exec(target);
    if (!match) continue;
    const line = offsetToLine(code, match.index);
    if (disabled.get(rule.id)?.has(line)) continue;
    const issue: LintIssue = {
      severity: rule.severity,
      ruleId: rule.id,
      message: rule.message,
      hint: rule.hint,
      line,
    };
    if (rule.severity === 'error') errors.push(issue);
    else warnings.push(issue);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Structured telemetry payload derived from a LintResult. Designed for
 * ingestion into Axiom (or any pino destination) so violation counts per
 * ruleId can be queried over time.
 */
export interface LintTelemetry {
  event: 'tool:figma_execute_lint';
  ok: boolean;
  /** True when result has errors and would be blocked by the caller. */
  wouldBlock: boolean;
  codeLength: number;
  errorCount: number;
  warningCount: number;
  /** Error ruleIds in deterministic order (for stable Axiom group-by). */
  errorRules: string[];
  /** Warning ruleIds in deterministic order. */
  warningRules: string[];
  /** Hashed file key (opaque session-level identifier). */
  fileKeyHash?: string;
}

/** Minimal logger contract so this module does not depend on pino directly. */
export interface LintLogger {
  info(obj: Record<string, unknown>, msg?: string): void;
}

/**
 * Build a structured telemetry payload from a LintResult + context.
 * Pure function — emit via `logger.info(buildLintTelemetry(...))`.
 */
export function buildLintTelemetry(
  result: LintResult,
  context: { codeLength: number; fileKeyHash?: string },
): LintTelemetry {
  return {
    event: 'tool:figma_execute_lint',
    ok: result.ok,
    wouldBlock: !result.ok,
    codeLength: context.codeLength,
    errorCount: result.errors.length,
    warningCount: result.warnings.length,
    errorRules: result.errors.map((e) => e.ruleId).sort(),
    warningRules: result.warnings.map((w) => w.ruleId).sort(),
    fileKeyHash: context.fileKeyHash,
  };
}

/**
 * Emit linter telemetry via the provided logger. No-op when no rules fired
 * AND code was accepted (avoids Axiom spam on clean runs).
 *
 * Records every non-empty event (errors, warnings, or blocked) so Axiom
 * queries like `| summarize count() by errorRules` yield accurate rates.
 */
export function recordLintTelemetry(
  logger: LintLogger,
  result: LintResult,
  context: { codeLength: number; fileKeyHash?: string },
): void {
  if (result.ok && result.warnings.length === 0) return;
  const payload: Record<string, unknown> = { ...buildLintTelemetry(result, context) };
  logger.info(payload, 'figma_execute pre-flight lint');
}

/**
 * Format a LintResult into a human-readable error message suitable for
 * returning as a tool result when execution is refused. Includes 1-based
 * line numbers when available.
 */
export function formatLintErrors(result: LintResult): string {
  if (result.ok && result.warnings.length === 0) return '';
  const lines: string[] = [];
  if (result.errors.length > 0) {
    lines.push(
      `figma_execute pre-flight check FAILED (${result.errors.length} error${result.errors.length > 1 ? 's' : ''}):`,
    );
    for (const e of result.errors) {
      const loc = e.line !== undefined ? ` (line ${e.line})` : '';
      lines.push(`  [${e.ruleId}]${loc} ${e.message}`);
      lines.push(`    → ${e.hint}`);
    }
  }
  if (result.warnings.length > 0) {
    lines.push(`Warnings (${result.warnings.length}):`);
    for (const w of result.warnings) {
      const loc = w.line !== undefined ? ` (line ${w.line})` : '';
      lines.push(`  [${w.ruleId}]${loc} ${w.message}`);
      lines.push(`    → ${w.hint}`);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Preflight facade — run lint + record telemetry + expose block decision
// ---------------------------------------------------------------------------

export interface PreflightOutcome {
  /** Whether the caller should allow execution to proceed. */
  allowed: boolean;
  /** Structured lint result (errors + warnings). */
  result: LintResult;
  /** Human-readable report suitable for returning to the agent when blocked. */
  report: string;
}

/**
 * One-shot preflight: lint code, emit telemetry, package outcome.
 * Callers block execution when `allowed === false` and surface `report` as
 * the tool error message. Warnings do NOT block but are emitted to telemetry.
 */
export function runPreflightLint(
  code: string,
  context: { codeLength: number; fileKeyHash?: string },
  logger: LintLogger,
): PreflightOutcome {
  const result = lintPluginCode(code);
  recordLintTelemetry(logger, result, context);
  return {
    allowed: result.ok,
    result,
    report: result.ok ? '' : formatLintErrors(result),
  };
}
