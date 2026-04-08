import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { Type } from '@sinclair/typebox';
import { type ToolDeps, textResult } from './index.js';

export interface LintIssue {
  type: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  nodeId?: string;
  nodeName?: string;
  property?: string;
  suggestedVariable?: string;
  suggestedValue?: unknown;
}

export interface LintContext {
  palette?: Array<{ r: number; g: number; b: number }>;
  spacingTokens?: number[];
  typeScale?: Array<{ fontSize?: number; fontFamily?: string; fontWeight?: string }>;
  effectStyles?: any[];
  dsVariables?: Array<{ id: string; name: string; resolvedValue: any }>;
  requireBinding?: boolean;
}

function colorMatch(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  tolerance = 0.01,
): boolean {
  return Math.abs(a.r - b.r) < tolerance && Math.abs(a.g - b.g) < tolerance && Math.abs(a.b - b.b) < tolerance;
}

function effectMatch(a: any, b: any, tolerance = 0.01): boolean {
  if (a.type !== b.type) return false;
  if (a.radius !== b.radius) return false;
  if (a.offset && b.offset) {
    if (Math.abs(a.offset.x - b.offset.x) > tolerance) return false;
    if (Math.abs(a.offset.y - b.offset.y) > tolerance) return false;
  }
  if (a.color && b.color) {
    if (!colorMatch(a.color, b.color, tolerance)) return false;
    if (Math.abs((a.color.a ?? 1) - (b.color.a ?? 1)) > tolerance) return false;
  }
  return true;
}

/** Check fill colors against a palette. Returns issues for out-of-palette colors and unbound colors. */
export function checkColors(
  fills: any[],
  palette: Array<{ r: number; g: number; b: number }>,
  ctx?: Pick<LintContext, 'requireBinding'>,
): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const fill of fills) {
    if (fill.type !== 'SOLID' || !fill.color) continue;
    const inPalette = palette.some((p) => colorMatch(fill.color, p));
    if (!inPalette) {
      issues.push({
        type: 'color-not-in-palette',
        message: `Color rgb(${Math.round(fill.color.r * 255)},${Math.round(fill.color.g * 255)},${Math.round(fill.color.b * 255)}) is not in the design system palette`,
        severity: 'error',
      });
    } else if (ctx?.requireBinding && !fill.boundVariables?.color) {
      issues.push({
        type: 'unbound-but-correct',
        message: 'Color value matches palette but is not bound to a variable',
        severity: 'warning',
      });
    }
  }
  return issues;
}

/** Check spacing values against token set. */
export function checkSpacing(node: Record<string, number | undefined>, spacingTokens: number[]): LintIssue[] {
  const spacingProps = [
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'itemSpacing',
    'counterAxisSpacing',
  ] as const;
  const issues: LintIssue[] = [];
  for (const prop of spacingProps) {
    const value = node[prop];
    if (value === undefined || value === null) continue;
    if (!spacingTokens.includes(value)) {
      issues.push({
        type: 'non-standard-spacing',
        message: `${prop} value ${value} is not in the spacing token set [${spacingTokens.join(', ')}]`,
        severity: 'warning',
        property: prop,
        suggestedValue: spacingTokens.reduce((prev, curr) =>
          Math.abs(curr - value) < Math.abs(prev - value) ? curr : prev,
        ),
      });
    }
  }
  return issues;
}

/** Check typography against a type scale. */
export function checkTypography(
  node: { fontSize?: number; fontFamily?: string; fontWeight?: string },
  typeScale: Array<{ fontSize?: number; fontFamily?: string; fontWeight?: string }>,
): LintIssue[] {
  const issues: LintIssue[] = [];

  if (node.fontSize !== undefined) {
    const inScale = typeScale.some((s) => s.fontSize === node.fontSize);
    if (!inScale) {
      issues.push({
        type: 'font-size-not-in-scale',
        message: `Font size ${node.fontSize} is not in the type scale`,
        severity: 'warning',
        property: 'fontSize',
      });
    }
  }

  return issues;
}

const DEFAULT_NAME_PATTERNS = [
  /^Frame\s+\d+$/,
  /^Rectangle\s+\d+$/,
  /^Ellipse\s+\d+$/,
  /^Group\s+\d+$/,
  /^Text\s+\d+$/,
  /^Line\s+\d+$/,
  /^Vector\s+\d+$/,
  /^Polygon\s+\d+$/,
  /^Star\s+\d+$/,
  /^Image\s+\d+$/,
];

/** Check node naming conventions. */
export function checkNaming(node: { name: string; type: string }): LintIssue[] {
  const issues: LintIssue[] = [];
  if (DEFAULT_NAME_PATTERNS.some((p) => p.test(node.name))) {
    issues.push({
      type: 'default-name',
      message: `Node "${node.name}" uses a default Figma name. Use semantic slash naming (e.g. "Card/Body")`,
      severity: 'warning',
    });
  }
  return issues;
}

/** Check auto-layout usage. */
export function checkAutoLayout(node: { type: string; layoutMode: string; childCount: number }): LintIssue[] {
  const issues: LintIssue[] = [];
  if (node.type === 'FRAME' && node.childCount > 1 && node.layoutMode === 'NONE') {
    issues.push({
      type: 'missing-auto-layout',
      message: 'Frame has multiple children but no auto-layout. Consider using VERTICAL or HORIZONTAL layout mode.',
      severity: 'warning',
    });
  }
  return issues;
}

/** Check depth and sizing. */
export function checkDepthAndSizing(node: {
  depth?: number;
  sizingH?: string;
  sizingV?: string;
  parentLayoutMode?: string;
}): LintIssue[] {
  const issues: LintIssue[] = [];

  if (node.depth !== undefined && node.depth >= 5) {
    issues.push({
      type: 'excessive-nesting',
      message: `Nesting depth ${node.depth} exceeds recommended maximum of 4`,
      severity: 'info',
      property: 'depth',
    });
  }

  if (node.sizingH === 'FIXED' && (node.parentLayoutMode === 'HORIZONTAL' || node.parentLayoutMode === 'VERTICAL')) {
    issues.push({
      type: 'should-be-fill',
      message: 'Node uses FIXED sizing inside an auto-layout container. Consider using FILL to adapt to layout.',
      severity: 'info',
      property: 'sizingH',
      suggestedValue: 'FILL',
    });
  }

  return issues;
}

/** Check effects against registered effect styles. */
export function checkEffects(effects: any[], effectStyles: any[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const effect of effects) {
    const matched = effectStyles.some((s) => effectMatch(effect, s));
    if (!matched) {
      issues.push({
        type: 'unstandardized-effect',
        message: `Effect of type "${effect.type}" does not match any registered effect style`,
        severity: 'warning',
      });
    }
  }
  return issues;
}

/** Check that fill colors matching DS variables are actually bound. */
export function checkBoundVariables(
  node: { fills?: any[] },
  dsVariables: Array<{ id: string; name: string; resolvedValue: any }>,
): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const fill of node.fills ?? []) {
    if (fill.type !== 'SOLID' || !fill.color) continue;
    // Already bound — skip
    if (fill.boundVariables?.color) continue;
    // Check if value matches a DS variable
    const matched = dsVariables.find((v) => v.resolvedValue && colorMatch(fill.color, v.resolvedValue));
    if (matched) {
      issues.push({
        type: 'should-be-bound',
        message: `Fill color matches variable "${matched.name}" but is not bound`,
        severity: 'warning',
        suggestedVariable: matched.name,
      });
    }
  }
  return issues;
}

export function createLintTools(deps: ToolDeps): ToolDefinition[] {
  const { connector } = deps;

  return [
    {
      name: 'figma_lint',
      label: 'Lint Design',
      description:
        'Run design linting: DS adherence + auto-layout + naming + best practices. Returns structured 3-section report (dsCheck, bestPractices, figmaLint).',
      promptSnippet: 'figma_lint: DS adherence + auto-layout + naming + best practices. Structured 3-section report',
      parameters: Type.Object({
        nodeId: Type.Optional(Type.String({ description: 'Node ID to lint. If omitted, lints entire page.' })),
        rules: Type.Optional(Type.Array(Type.String(), { description: 'Specific rule names to check' })),
      }),
      async execute(_toolCallId, params: any, _signal, _onUpdate, _ctx) {
        const rawResult = await connector.lintDesign(params.nodeId, params.rules);

        // If connector returns structured node data, enhance with client-side matching
        if (rawResult && typeof rawResult === 'object' && Array.isArray((rawResult as any).nodes)) {
          const raw = rawResult as any;
          const context: LintContext = {
            palette: raw.palette,
            spacingTokens: raw.spacingTokens,
            typeScale: raw.typeScale,
            effectStyles: raw.effectStyles,
            dsVariables: raw.dsVariables,
          };

          const issues: LintIssue[] = [];
          for (const node of raw.nodes) {
            if (node.fills) issues.push(...checkColors(node.fills, context.palette ?? [], context));
            if (node.spacing) issues.push(...checkSpacing(node, context.spacingTokens ?? []));
            if (node.type === 'TEXT') issues.push(...checkTypography(node, context.typeScale ?? []));
            issues.push(...checkNaming(node));
            if (node.type === 'FRAME') issues.push(...checkAutoLayout(node));
            issues.push(...checkDepthAndSizing(node));
            if (node.effects) issues.push(...checkEffects(node.effects, context.effectStyles ?? []));
            if (node.fills || node.strokes) issues.push(...checkBoundVariables(node, context.dsVariables ?? []));
          }

          const dsCheck = issues.filter(
            (i) =>
              i.type.includes('color') ||
              i.type.includes('spacing') ||
              i.type.includes('typography') ||
              i.type.includes('bound') ||
              i.type.includes('effect'),
          );
          const bestPractices = issues.filter(
            (i) =>
              i.type.includes('auto-layout') ||
              i.type.includes('depth') ||
              i.type.includes('naming') ||
              i.type.includes('sizing'),
          );
          // UX-T8 / UX-006: for large reports (>10 findings per section), return a top-N
          // slice ordered by severity + type frequency, with a remaining count so the agent
          // can summarise instead of dumping 80+ warnings verbatim. Use topN / remaining
          // together with hasMore as a hint for the caller.
          const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };
          const topN = <T extends { severity: string; type: string }>(arr: T[], n = 10) => {
            const counts = new Map<string, number>();
            for (const it of arr) counts.set(it.type, (counts.get(it.type) ?? 0) + 1);
            const sorted = [...arr].sort((a, b) => {
              const rs = (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99);
              if (rs !== 0) return rs;
              return (counts.get(b.type) ?? 0) - (counts.get(a.type) ?? 0);
            });
            return {
              top: sorted.slice(0, n),
              remaining: Math.max(0, sorted.length - n),
              hasMore: sorted.length > n,
              byType: Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)),
            };
          };

          return textResult({
            dsCheck: dsCheck.length > 10 ? topN(dsCheck) : dsCheck,
            bestPractices: bestPractices.length > 10 ? topN(bestPractices) : bestPractices,
            figmaLint: raw.nativeIssues ?? [],
            summary: {
              total: issues.length,
              errors: issues.filter((i) => i.severity === 'error').length,
              warnings: issues.filter((i) => i.severity === 'warning').length,
              truncated: dsCheck.length > 10 || bestPractices.length > 10,
              hint:
                dsCheck.length > 10 || bestPractices.length > 10
                  ? 'Report truncated to top-10 per section by severity + frequency. Call figma_lint with a specific nodeId to narrow scope, or prioritise the listed types first.'
                  : undefined,
            },
          });
        }

        // Fallback: return raw connector result as-is (legacy connector)
        return textResult(rawResult);
      },
    },
  ];
}
