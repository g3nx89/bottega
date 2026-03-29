import { describe, expect, it } from 'vitest';
import {
  buildBatchPrompts,
  buildDiagramPrompt,
  buildIconPrompt,
  buildPatternPrompt,
  buildStoryStepPrompt,
} from '../../../src/main/image-gen/prompt-builders.js';

// ── buildBatchPrompts ───────────────────────────

describe('buildBatchPrompts', () => {
  const base = 'a futuristic city skyline';

  it('returns single prompt when no options provided', () => {
    const result = buildBatchPrompts(base, {});
    expect(result).toEqual([base]);
  });

  it('returns one prompt per style with " style" suffix', () => {
    const result = buildBatchPrompts(base, { styles: ['watercolor', 'oil painting'] });
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(`${base}, watercolor style`);
    expect(result[1]).toBe(`${base}, oil painting style`);
  });

  it('expands variations using VARIATION_MAP lookups', () => {
    const result = buildBatchPrompts(base, { variations: ['lighting'] });
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('dramatic lighting');
    expect(result[1]).toContain('soft lighting');
  });

  it('produces cartesian product of styles × variations', () => {
    const result = buildBatchPrompts(base, {
      styles: ['pixel art'],
      variations: ['angle'],
    });
    // 1 style × 2 angle variations = 2 prompts
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('pixel art style');
    expect(result[0]).toContain('from above');
    expect(result[1]).toContain('pixel art style');
    expect(result[1]).toContain('close-up view');
  });

  it('caps total prompts at MAX_BATCH_PROMPTS (8)', () => {
    const result = buildBatchPrompts(base, {
      styles: ['a', 'b', 'c', 'd', 'e'],
      variations: ['lighting', 'angle', 'mood'],
      outputCount: 100,
    });
    expect(result.length).toBeLessThanOrEqual(8);
  });

  it('returns single prompt for empty styles and variations arrays', () => {
    const result = buildBatchPrompts(base, { styles: [], variations: [] });
    expect(result).toEqual([base]);
  });

  it('duplicates base prompt when only outputCount > 1 is given', () => {
    const result = buildBatchPrompts(base, { outputCount: 3 });
    expect(result).toHaveLength(3);
    result.forEach((p) => expect(p).toBe(base));
  });

  it('uses variation key as suffix when not in VARIATION_MAP', () => {
    const result = buildBatchPrompts(base, { variations: ['fisheye'] });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(`${base}, fisheye`);
  });
});

// ── buildIconPrompt ─────────────────────────────

describe('buildIconPrompt', () => {
  const base = 'a house';

  it('uses defaults: modern style, app-icon type, rounded corners', () => {
    const result = buildIconPrompt(base);
    expect(result).toContain('modern style app-icon');
    expect(result).toContain('rounded corners');
    expect(result).toContain('professional');
  });

  it('integrates all specified options', () => {
    const result = buildIconPrompt(base, {
      type: 'app-icon',
      style: 'flat',
      background: 'blue',
      corners: 'square',
    });
    expect(result).toContain('flat style app-icon');
    expect(result).toContain('square corners');
    expect(result).toContain('blue background');
  });

  it('omits corners text for favicon type', () => {
    const result = buildIconPrompt(base, { type: 'favicon' });
    expect(result).not.toContain('corners');
    expect(result).toContain('favicon');
  });

  it('omits background text when background is transparent (default)', () => {
    const result = buildIconPrompt(base);
    expect(result).not.toContain('background');
  });
});

// ── buildPatternPrompt ──────────────────────────

describe('buildPatternPrompt', () => {
  const base = 'geometric shapes';

  it('uses defaults: seamless type, tileable, repeating pattern', () => {
    const result = buildPatternPrompt(base);
    expect(result).toContain('seamless pattern');
    expect(result).toContain('tileable');
    expect(result).toContain('repeating pattern');
  });

  it('does not add tileable text for non-seamless type', () => {
    const result = buildPatternPrompt(base, { type: 'scatter' });
    expect(result).not.toContain('tileable');
    expect(result).toContain('scatter pattern');
  });

  it('integrates all specified options', () => {
    const result = buildPatternPrompt(base, {
      type: 'seamless',
      style: 'geometric',
      density: 'high',
      colors: 'monochrome',
      size: '512x512',
    });
    expect(result).toContain('geometric style seamless pattern');
    expect(result).toContain('high density');
    expect(result).toContain('monochrome colors');
    expect(result).toContain('512x512 tile size');
  });
});

// ── buildDiagramPrompt ──────────────────────────

describe('buildDiagramPrompt', () => {
  const base = 'user authentication flow';

  it('uses defaults: flowchart type, professional style', () => {
    const result = buildDiagramPrompt(base);
    expect(result).toContain('flowchart diagram');
    expect(result).toContain('professional style');
    expect(result).toContain('hierarchical layout');
    expect(result).toContain('clean technical illustration');
  });

  it('integrates all specified options', () => {
    const result = buildDiagramPrompt(base, {
      type: 'sequence',
      style: 'minimal',
      layout: 'horizontal',
      complexity: 'simple',
      colors: 'grayscale',
      annotations: 'minimal',
    });
    expect(result).toContain('sequence diagram');
    expect(result).toContain('minimal style');
    expect(result).toContain('horizontal layout');
    expect(result).toContain('simple level of detail');
    expect(result).toContain('grayscale color scheme');
    expect(result).toContain('minimal annotations and labels');
  });
});

// ── buildStoryStepPrompt ────────────────────────

describe('buildStoryStepPrompt', () => {
  const base = 'a hero journey';

  it('does not include transition text for step 1', () => {
    const result = buildStoryStepPrompt(base, 1, 5);
    expect(result).toContain('step 1 of 5');
    expect(result).not.toContain('transition');
  });

  it('includes transition text for step > 1', () => {
    const result = buildStoryStepPrompt(base, 3, 5);
    expect(result).toContain('step 3 of 5');
    expect(result).toContain('smooth transition from previous step');
  });

  it('uses narrative sequence text for story type (default)', () => {
    const result = buildStoryStepPrompt(base, 1, 3);
    expect(result).toContain('narrative sequence');
    expect(result).toContain('consistent art style');
  });

  it('uses procedural step text for process type', () => {
    const result = buildStoryStepPrompt(base, 2, 4, { type: 'process' });
    expect(result).toContain('procedural step');
    expect(result).toContain('instructional illustration');
  });
});
