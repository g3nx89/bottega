import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  buildLintTelemetry,
  formatLintErrors,
  HARD_ERROR_RULES,
  lintPluginCode,
  parseDisableDirectives,
  recordLintTelemetry,
  runPreflightLint,
  stripSource,
  WARNING_RULES,
} from '../../../src/main/tools/plugin-api-linter.js';

describe('plugin-api-linter', () => {
  describe('happy path', () => {
    it('valid code passes', () => {
      const code = `
        return (async () => {
          await figma.loadFontAsync({ family: "Inter", style: "Regular" });
          const frame = figma.createFrame();
          frame.name = "MyFrame";
          frame.layoutMode = "VERTICAL";
          frame.resize(375, 600);
          figma.currentPage.appendChild(frame);
          return JSON.stringify({ id: frame.id });
        })();
      `;
      const result = lintPluginCode(code);
      expect(result.ok).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('empty code passes', () => {
      expect(lintPluginCode('').ok).toBe(true);
    });

    it('non-string input is tolerated', () => {
      expect(lintPluginCode(null as unknown as string).ok).toBe(true);
    });

    it('side-effect-only IIFE without outer return is accepted (no missing-return rule)', () => {
      const code = `(async () => { figma.notify("hi"); })();`;
      expect(lintPluginCode(code).ok).toBe(true);
      expect(lintPluginCode(code).warnings).toHaveLength(0);
    });
  });

  describe('hard errors', () => {
    it('flags sync currentPage setter', () => {
      const result = lintPluginCode(`
        figma.currentPage = somePage;
        return null;
      `);
      expect(result.ok).toBe(false);
      expect(result.errors[0]?.ruleId).toBe('sync-currentPage-setter');
      expect(result.errors[0]?.hint).toContain('setCurrentPageAsync');
      expect(result.errors[0]?.line).toBe(2);
    });

    it('flags width/height assignment', () => {
      const result = lintPluginCode(`
        const f = figma.createFrame();
        f.width = 100;
        return null;
      `);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.ruleId === 'width-height-readonly')).toBe(true);
    });

    it('flags height assignment', () => {
      const result = lintPluginCode(`
        node.height = 200;
        return null;
      `);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.ruleId === 'width-height-readonly')).toBe(true);
    });

    it('flags getPluginData / setPluginData', () => {
      expect(lintPluginCode('node.getPluginData("k"); return 1;').ok).toBe(false);
      expect(lintPluginCode('node.setPluginData("k", "v"); return 1;').ok).toBe(false);
    });

    it('flags getLocalComponents / getLocalComponentSets', () => {
      expect(lintPluginCode('const c = figma.getLocalComponents(); return c;').ok).toBe(false);
      expect(lintPluginCode('const c = figma.getLocalComponentSets(); return c;').ok).toBe(false);
    });

    it('flags ALL_SCOPES', () => {
      const result = lintPluginCode(`
        variable.scopes = ["ALL_SCOPES"];
        return null;
      `);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.ruleId === 'all-scopes-variable')).toBe(true);
    });

    it('flags primaryAxisSizingMode FILL', () => {
      const result = lintPluginCode(`
        frame.primaryAxisSizingMode = "FILL";
        return null;
      `);
      expect(result.ok).toBe(false);
      expect(result.errors.some((e) => e.ruleId === 'primary-axis-sizing-fill')).toBe(true);
    });

    it('paint-color-alpha does NOT fire on variable setValueForMode', () => {
      const code = `
        const v = figma.variables.createVariable("bg", coll, "COLOR");
        v.setValueForMode(modeId, { r: 1, g: 0, b: 0, a: 1 });
        return null;
      `;
      const result = lintPluginCode(code);
      expect(result.warnings.some((w) => w.ruleId === 'paint-color-alpha')).toBe(false);
    });

    it('paint-color-alpha does NOT fire on color without alpha', () => {
      const code = `
        node.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 0.5 }];
        return null;
      `;
      expect(lintPluginCode(code).ok).toBe(true);
    });
  });

  describe('regex specificity', () => {
    it('width-height rule does NOT fire on minWidth/maxWidth/widthChanged', () => {
      expect(lintPluginCode('style.minWidth = 100; return 1;').ok).toBe(true);
      expect(lintPluginCode('style.maxHeight = 200; return 1;').ok).toBe(true);
      expect(lintPluginCode('obj.widthChanged = true; return 1;').ok).toBe(true);
    });

    it('direct-fill-color rule fires on non-numeric index forms', () => {
      const r1 = lintPluginCode('node.fills[i].color.r = 0.5; return 1;');
      expect(r1.warnings.some((w) => w.ruleId === 'direct-fill-color-mutation')).toBe(true);
      const r2 = lintPluginCode('node.fills[fills.length - 1].color.g = 0.5; return 1;');
      expect(r2.warnings.some((w) => w.ruleId === 'direct-fill-color-mutation')).toBe(true);
    });

    it('sync-currentPage rule does NOT fire on equality check', () => {
      expect(lintPluginCode('if (figma.currentPage == p) return 1;').ok).toBe(true);
      expect(lintPluginCode('if (figma.currentPage === p) return 1;').ok).toBe(true);
    });
  });

  describe('warnings', () => {
    it('warns on .characters without loadFontAsync context', () => {
      const result = lintPluginCode(`
        text.characters = "hello";
        return null;
      `);
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.ruleId === 'no-font-load-before-text')).toBe(true);
    });

    it('warns on direct fill color mutation', () => {
      const result = lintPluginCode(`
        node.fills[0].color.r = 0.5;
        return null;
      `);
      expect(result.warnings.some((w) => w.ruleId === 'direct-fill-color-mutation')).toBe(true);
    });

    it('warns on getStyledTextSegments without type guard', () => {
      const result = lintPluginCode(`
        const n = await figma.getNodeByIdAsync("1:2");
        const segs = n.getStyledTextSegments(["hyperlink"]);
        return segs;
      `);
      expect(result.warnings.some((w) => w.ruleId === 'type-specific-method-without-guard')).toBe(true);
    });

    it('warns on setRangeFontName', () => {
      const result = lintPluginCode(`
        node.setRangeFontName(0, 5, { family: "Inter", style: "Bold" });
        return null;
      `);
      expect(result.warnings.some((w) => w.ruleId === 'type-specific-method-without-guard')).toBe(true);
    });

    it('warns on createVariant', () => {
      const result = lintPluginCode(`
        const v = compSet.createVariant();
        return v.id;
      `);
      expect(result.warnings.some((w) => w.ruleId === 'type-specific-method-without-guard')).toBe(true);
    });

    it('warns on addComponentProperty', () => {
      const result = lintPluginCode(`
        comp.addComponentProperty("Label", "TEXT", "Button");
        return null;
      `);
      expect(result.warnings.some((w) => w.ruleId === 'type-specific-method-without-guard')).toBe(true);
    });

    it('warns on paint color with alpha field', () => {
      const result = lintPluginCode(`
        node.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 0.5 } }];
        return null;
      `);
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.ruleId === 'paint-color-alpha')).toBe(true);
    });

    it('warns on paint color with alpha — strokes', () => {
      const result = lintPluginCode(`
        node.strokes = [{ type: "SOLID", color: {r: 0, g: 0, b: 0, a: 1} }];
        return null;
      `);
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.ruleId === 'paint-color-alpha')).toBe(true);
    });

    it('paint-color-alpha warns on gradient-stop color (known false positive)', () => {
      // Known regex limitation: GradientPaint.gradientStops[].color legally
      // accepts {r,g,b,a} but we can't distinguish stop-context from paint-
      // context with a regex alone. Warning severity keeps execution flowing.
      const code = `
        node.fills = [{
          type: "GRADIENT_LINEAR",
          gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 0.5 } }],
        }];
        return null;
      `;
      const result = lintPluginCode(code);
      expect(result.ok).toBe(true);
      expect(result.warnings.some((w) => w.ruleId === 'paint-color-alpha')).toBe(true);
    });

    it('paint-color-alpha does NOT match quoted keys (syntactic rule, lock behavior)', () => {
      // String contents are blanked in syntactic stripping, so `"color"` and
      // `"a"` quoted-key JSON literals slip past the rule. Documented here as
      // a known limitation — update this test if the stripper stops blanking
      // quoted property keys.
      const code = `
        node.fills = [{ type: "SOLID", "color": { "r": 1, "g": 0, "b": 0, "a": 0.5 } }];
        return null;
      `;
      const result = lintPluginCode(code);
      expect(result.warnings.some((w) => w.ruleId === 'paint-color-alpha')).toBe(false);
    });

    it('type-specific-method-without-guard fires even with same-expression guard (known limitation)', () => {
      const code = `
        return node.type === "TEXT" ? node.getStyledTextSegments(["hyperlink"]) : null;
      `;
      const result = lintPluginCode(code);
      expect(result.warnings.some((w) => w.ruleId === 'type-specific-method-without-guard')).toBe(true);
    });

    it('does NOT match invented or similarly-named methods (negative regression)', () => {
      const code1 = 'node.setRangeFontFace("Arial"); return null;';
      const code2 = 'compSet.createVariantInstance(); return null;';
      expect(lintPluginCode(code1).warnings.some((w) => w.ruleId === 'type-specific-method-without-guard')).toBe(false);
      expect(lintPluginCode(code2).warnings.some((w) => w.ruleId === 'type-specific-method-without-guard')).toBe(false);
    });

    it('type-method rule does NOT fire on bare method names (no call)', () => {
      const code = `
        const methodName = "setRangeFontName";
        return methodName;
      `;
      expect(lintPluginCode(code).ok).toBe(true);
      expect(lintPluginCode(code).warnings).toHaveLength(0);
    });
  });

  describe('false positive avoidance', () => {
    it('ignores patterns inside strings', () => {
      const code = `
        const msg = "figma.currentPage = page";
        return msg;
      `;
      expect(lintPluginCode(code).ok).toBe(true);
    });

    it('ignores patterns inside line comments', () => {
      const code = `
        // figma.currentPage = page
        return 1;
      `;
      expect(lintPluginCode(code).ok).toBe(true);
    });

    it('ignores patterns inside block comments', () => {
      const code = `
        /* node.width = 100; */
        return 1;
      `;
      expect(lintPluginCode(code).ok).toBe(true);
    });

    it('ignores patterns inside template literals', () => {
      const code = `
        const x = \`node.height = \${v}\`;
        return x;
      `;
      expect(lintPluginCode(code).ok).toBe(true);
    });

    it('does not flag width comparison', () => {
      const code = `
        if (node.width == 100) { return true; }
        return false;
      `;
      expect(lintPluginCode(code).ok).toBe(true);
    });
  });

  describe('formatLintErrors', () => {
    it('returns empty string for clean result', () => {
      const r = lintPluginCode('return 1;');
      expect(formatLintErrors(r)).toBe('');
    });

    it('formats errors with ruleId, line, and hint', () => {
      const r = lintPluginCode('figma.currentPage = p; return 1;');
      const out = formatLintErrors(r);
      expect(out).toContain('sync-currentPage-setter');
      expect(out).toContain('setCurrentPageAsync');
      expect(out).toContain('FAILED');
      expect(out).toContain('line ');
    });

    it('formats warnings separately', () => {
      const r = lintPluginCode('node.characters = "hi"; return 1;');
      const out = formatLintErrors(r);
      expect(out).toContain('Warnings');
      expect(out).toContain('no-font-load-before-text');
    });
  });

  describe('multiple issues', () => {
    it('reports all errors', () => {
      const r = lintPluginCode(`
        figma.currentPage = p;
        node.width = 100;
        return null;
      `);
      expect(r.errors).toHaveLength(2);
      expect(r.errors.map((e) => e.ruleId).sort()).toEqual(['sync-currentPage-setter', 'width-height-readonly']);
    });
  });

  describe('positions', () => {
    it('reports 1-based line numbers', () => {
      const code = [
        'const a = 1;', //
        'figma.currentPage = p;',
        'return 1;',
      ].join('\n');
      const r = lintPluginCode(code);
      expect(r.errors[0]?.line).toBe(2);
    });
  });

  describe('disable directives', () => {
    it('parseDisableDirectives extracts lint-disable-next-line', () => {
      const code = [
        '// lint-disable-next-line sync-currentPage-setter', //
        'figma.currentPage = p;',
        'return 1;',
      ].join('\n');
      const disabled = parseDisableDirectives(code);
      expect(disabled.get('sync-currentPage-setter')?.has(2)).toBe(true);
      expect(disabled.get('sync-currentPage-setter')?.has(1)).toBe(false);
    });

    it('parseDisableDirectives extracts range lint-disable', () => {
      const code = ['// lint-disable width-height-readonly', 'node.width = 100;', 'return 1;'].join('\n');
      const disabled = parseDisableDirectives(code);
      expect(disabled.get('width-height-readonly')?.has(2)).toBe(true);
      expect(disabled.get('width-height-readonly')?.has(3)).toBe(true);
    });

    it('lintPluginCode honors lint-disable-next-line', () => {
      const code = [
        '// lint-disable-next-line sync-currentPage-setter', //
        'figma.currentPage = p;',
        'return 1;',
      ].join('\n');
      expect(lintPluginCode(code).ok).toBe(true);
    });

    it('multiple rule ids in one directive', () => {
      const code = [
        '// lint-disable-next-line sync-currentPage-setter, width-height-readonly', //
        'figma.currentPage = p; node.width = 10;',
        'return 1;',
      ].join('\n');
      expect(lintPluginCode(code).ok).toBe(true);
    });
  });

  describe('stripSource', () => {
    it('handles unclosed block comment gracefully', () => {
      const code = 'figma.currentPage = p; /* unterminated';
      // Should not throw; stripped source simply runs to EOF as comment
      expect(() => stripSource(code, { keepStrings: false })).not.toThrow();
    });

    it('handles unterminated string gracefully', () => {
      const code = 'const s = "unterminated';
      expect(() => stripSource(code, { keepStrings: false })).not.toThrow();
      expect(() => stripSource(code, { keepStrings: true })).not.toThrow();
    });

    it('preserves line positions across comments', () => {
      const code = ['// comment line 1', 'figma.currentPage = p;'].join('\n');
      const stripped = stripSource(code, { keepStrings: false });
      const lines = stripped.split('\n');
      expect(lines[1]).toContain('figma.currentPage');
    });
  });

  describe('rule registry', () => {
    it('HARD_ERROR_RULES + WARNING_RULES cover all rules', () => {
      expect(HARD_ERROR_RULES.length).toBeGreaterThan(0);
      expect(WARNING_RULES.length).toBeGreaterThan(0);
      // Every rule has id, kind, severity, pattern, message, hint
      for (const rule of [...HARD_ERROR_RULES, ...WARNING_RULES]) {
        expect(rule.id).toBeTruthy();
        expect(rule.kind === 'syntactic' || rule.kind === 'literal').toBe(true);
        expect(rule.severity === 'error' || rule.severity === 'warning').toBe(true);
        expect(rule.pattern).toBeInstanceOf(RegExp);
      }
    });

    it('no duplicate rule ids', () => {
      const ids = [...HARD_ERROR_RULES, ...WARNING_RULES].map((r) => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('telemetry', () => {
    it('buildLintTelemetry returns structured payload', () => {
      const r = lintPluginCode('figma.currentPage = p; return 1;');
      const t = buildLintTelemetry(r, { codeLength: 32, fileKeyHash: 'abc123' });
      expect(t.event).toBe('tool:figma_execute_lint');
      expect(t.ok).toBe(false);
      expect(t.wouldBlock).toBe(true);
      expect(t.errorCount).toBe(1);
      expect(t.warningCount).toBe(0);
      expect(t.errorRules).toEqual(['sync-currentPage-setter']);
      expect(t.codeLength).toBe(32);
      expect(t.fileKeyHash).toBe('abc123');
    });

    it('buildLintTelemetry sorts ruleIds deterministically', () => {
      const r = lintPluginCode(`
        figma.currentPage = p;
        node.width = 100;
        return 1;
      `);
      const t = buildLintTelemetry(r, { codeLength: 100 });
      expect(t.errorRules).toEqual(['sync-currentPage-setter', 'width-height-readonly']);
    });

    it('buildLintTelemetry marks clean results as ok', () => {
      const r = lintPluginCode('return 1;');
      const t = buildLintTelemetry(r, { codeLength: 10 });
      expect(t.ok).toBe(true);
      expect(t.wouldBlock).toBe(false);
      expect(t.errorRules).toEqual([]);
      expect(t.warningRules).toEqual([]);
    });

    it('buildLintTelemetry omits fileKeyHash when not provided', () => {
      const r = lintPluginCode('figma.currentPage = p; return 1;');
      const t = buildLintTelemetry(r, { codeLength: 10 });
      expect(t.fileKeyHash).toBeUndefined();
    });

    it('recordLintTelemetry emits on errors', () => {
      const logger = { info: vi.fn() };
      const r = lintPluginCode('figma.currentPage = p; return 1;');
      recordLintTelemetry(logger, r, { codeLength: 32 });
      expect(logger.info).toHaveBeenCalledTimes(1);
      const [payload, msg] = logger.info.mock.calls[0] as [Record<string, unknown>, string];
      expect(payload.event).toBe('tool:figma_execute_lint');
      expect(payload.wouldBlock).toBe(true);
      expect(msg).toBe('figma_execute pre-flight lint');
    });

    it('recordLintTelemetry emits on warnings only', () => {
      const logger = { info: vi.fn() };
      const r = lintPluginCode('node.characters = "hi"; return 1;');
      recordLintTelemetry(logger, r, { codeLength: 30 });
      expect(logger.info).toHaveBeenCalledTimes(1);
      const [payload] = logger.info.mock.calls[0] as [Record<string, unknown>];
      expect(payload.wouldBlock).toBe(false);
      expect(payload.warningCount).toBe(1);
    });

    it('recordLintTelemetry skips clean runs', () => {
      const logger = { info: vi.fn() };
      const r = lintPluginCode('return 1;');
      recordLintTelemetry(logger, r, { codeLength: 10 });
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  describe('runPreflightLint (helper)', () => {
    it('allows valid code, emits no telemetry', () => {
      const logger = { info: vi.fn() };
      const out = runPreflightLint('return 1;', { codeLength: 9 }, logger);
      expect(out.allowed).toBe(true);
      expect(out.report).toBe('');
      expect(logger.info).not.toHaveBeenCalled();
    });

    it('blocks on errors and produces report', () => {
      const logger = { info: vi.fn() };
      const out = runPreflightLint('figma.currentPage = p; return 1;', { codeLength: 32 }, logger);
      expect(out.allowed).toBe(false);
      expect(out.report).toContain('sync-currentPage-setter');
      expect(out.result.errors).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });

    it('allows code with warnings but emits telemetry', () => {
      const logger = { info: vi.fn() };
      const out = runPreflightLint('node.characters = "hi"; return 1;', { codeLength: 30 }, logger);
      expect(out.allowed).toBe(true);
      expect(out.result.warnings).toHaveLength(1);
      expect(logger.info).toHaveBeenCalledTimes(1);
    });
  });
});

describe('reference-loader drift', () => {
  it('variant-system-patterns.md file exists on disk and contains Pattern 1', () => {
    const filePath = join(__dirname, '../../../src/main/workflows/references/variant-system-patterns.md');
    const content = readFileSync(filePath, 'utf-8');
    expect(content).toContain('Pattern 1');
    expect(content.length).toBeGreaterThan(500);
  });
});
