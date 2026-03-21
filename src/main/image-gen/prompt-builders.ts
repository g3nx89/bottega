// Prompt enrichment functions for specialized image generation modes.
// Ported from Google's nanobanana extension (Apache 2.0).

export interface StyleVariationOpts {
  styles?: string[];
  variations?: string[];
  outputCount?: number;
}

const VARIATION_MAP: Record<string, string[]> = {
  lighting: ['dramatic lighting', 'soft lighting'],
  angle: ['from above', 'close-up view'],
  'color-palette': ['warm color palette', 'cool color palette'],
  composition: ['centered composition', 'rule of thirds composition'],
  mood: ['cheerful mood', 'dramatic mood'],
  season: ['in spring', 'in winter'],
  'time-of-day': ['at sunrise', 'at sunset'],
};

const MAX_BATCH_PROMPTS = 8;

/** Expand a base prompt into multiple prompts using style and variation combinatorics. */
export function buildBatchPrompts(basePrompt: string, opts: StyleVariationOpts): string[] {
  const limit = Math.min(opts.outputCount || MAX_BATCH_PROMPTS, MAX_BATCH_PROMPTS);

  if (!opts.styles?.length && !opts.variations?.length && !opts.outputCount) {
    return [basePrompt];
  }

  const prompts: string[] = [];

  // Apply styles
  if (opts.styles?.length) {
    for (const style of opts.styles) {
      prompts.push(`${basePrompt}, ${style} style`);
      if (prompts.length >= limit) break;
    }
  }

  // Apply variations (multiply with existing prompts)
  if (opts.variations?.length && prompts.length < limit) {
    const base = prompts.length > 0 ? [...prompts] : [basePrompt];
    const varied: string[] = [];
    for (const bp of base) {
      for (const v of opts.variations) {
        const suffixes = VARIATION_MAP[v] || [`${v}`];
        for (const suffix of suffixes) {
          varied.push(`${bp}, ${suffix}`);
          if (varied.length >= limit) break;
        }
        if (varied.length >= limit) break;
      }
      if (varied.length >= limit) break;
    }
    if (varied.length > 0) {
      prompts.splice(0, prompts.length, ...varied);
    }
  }

  // Simple count duplicates when no styles/variations
  if (prompts.length === 0 && opts.outputCount && opts.outputCount > 1) {
    for (let i = 0; i < limit; i++) prompts.push(basePrompt);
  }

  // Hard cap — defensive guard
  if (prompts.length > limit) {
    prompts.splice(limit);
  }

  return prompts.length > 0 ? prompts : [basePrompt];
}

// ── Icon prompt ─────────────────────────────

export interface IconOpts {
  type?: string;
  style?: string;
  background?: string;
  corners?: string;
}

export function buildIconPrompt(basePrompt: string, opts: IconOpts = {}): string {
  const type = opts.type || 'app-icon';
  const style = opts.style || 'modern';
  const background = opts.background || 'transparent';
  const corners = opts.corners || 'rounded';

  let prompt = `${basePrompt}, ${style} style ${type}`;
  if (type === 'app-icon') prompt += `, ${corners} corners`;
  if (background !== 'transparent') prompt += `, ${background} background`;
  prompt += ', clean design, high quality, professional';
  return prompt;
}

// ── Pattern prompt ──────────────────────────

export interface PatternOpts {
  type?: string;
  style?: string;
  density?: string;
  colors?: string;
  size?: string;
}

export function buildPatternPrompt(basePrompt: string, opts: PatternOpts = {}): string {
  const type = opts.type || 'seamless';
  const style = opts.style || 'abstract';
  const density = opts.density || 'medium';
  const colors = opts.colors || 'colorful';
  const size = opts.size || '256x256';

  let prompt = `${basePrompt}, ${style} style ${type} pattern, ${density} density, ${colors} colors`;
  if (type === 'seamless') prompt += ', tileable, repeating pattern';
  prompt += `, ${size} tile size, high quality`;
  return prompt;
}

// ── Diagram prompt ──────────────────────────

export interface DiagramOpts {
  type?: string;
  style?: string;
  layout?: string;
  complexity?: string;
  colors?: string;
  annotations?: string;
}

export function buildDiagramPrompt(basePrompt: string, opts: DiagramOpts = {}): string {
  const type = opts.type || 'flowchart';
  const style = opts.style || 'professional';
  const layout = opts.layout || 'hierarchical';
  const complexity = opts.complexity || 'detailed';
  const colors = opts.colors || 'accent';
  const annotations = opts.annotations || 'detailed';

  let prompt = `${basePrompt}, ${type} diagram, ${style} style, ${layout} layout`;
  prompt += `, ${complexity} level of detail, ${colors} color scheme`;
  prompt += `, ${annotations} annotations and labels`;
  prompt += ', clean technical illustration, clear visual hierarchy';
  return prompt;
}

// ── Story step prompt ───────────────────────

export interface StoryStepOpts {
  type?: string;
  style?: string;
  transition?: string;
}

export function buildStoryStepPrompt(
  basePrompt: string,
  step: number,
  total: number,
  opts: StoryStepOpts = {},
): string {
  const type = opts.type || 'story';
  const style = opts.style || 'consistent';
  const transition = opts.transition || 'smooth';

  let prompt = `${basePrompt}, step ${step} of ${total}`;
  switch (type) {
    case 'story':
      prompt += `, narrative sequence, ${style} art style`;
      break;
    case 'process':
      prompt += ', procedural step, instructional illustration';
      break;
    case 'tutorial':
      prompt += ', tutorial step, educational diagram';
      break;
    case 'timeline':
      prompt += ', chronological progression, timeline visualization';
      break;
  }
  if (step > 1) prompt += `, ${transition} transition from previous step`;
  return prompt;
}
