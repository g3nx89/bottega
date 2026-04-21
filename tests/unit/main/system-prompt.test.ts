import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, type DsBlockData } from '../../../src/main/system-prompt.js';

describe('buildSystemPrompt', () => {
  it('should replace {{MODEL}} with the given label', () => {
    const result = buildSystemPrompt('Claude Sonnet 4');
    expect(result).toContain('Claude Sonnet 4');
    expect(result).not.toContain('{{MODEL}}');
  });

  it('should include key sections', () => {
    const result = buildSystemPrompt('Test Model');
    expect(result).toContain('Bottega');
    expect(result).toContain('## Workflow');
    expect(result).toContain('## Tool Selection Guide');
    expect(result).toContain('## Critical Rules');
    expect(result).toContain('## Anti-Patterns');
    expect(result).toContain('figma_render_jsx');
    expect(result).toContain('figma_execute');
  });

  it('should nudge dedicated tools over figma_execute for reversible atomic operations', () => {
    expect(buildSystemPrompt('Test Model')).toMatch(/preferisci il tool dedicato rispetto a figma_execute/i);
  });

  it('should include Action Bias section', () => {
    const result = buildSystemPrompt('Test Model');
    expect(result).toContain('## Action Bias');
    expect(result).toContain('ALWAYS use tools to execute it');
    expect(result).toContain('Do first, refine later');
    expect(result).toContain('session reset');
  });

  it('should produce a string of reasonable length', () => {
    const result = buildSystemPrompt('X');
    // System prompt should be substantial (>1000 chars)
    expect(result.length).toBeGreaterThan(1000);
  });

  it('should handle empty model label', () => {
    const result = buildSystemPrompt('');
    expect(result).toContain('Bottega (powered by )');
    expect(result).not.toContain('{{MODEL}}');
  });

  it('should handle special characters in model label', () => {
    const result = buildSystemPrompt('GPT-5.4 (128K)');
    expect(result).toContain('GPT-5.4 (128K)');
  });

  describe('DS block injection', () => {
    it('should not inject DS block when dsData is undefined', () => {
      const result = buildSystemPrompt('Test Model');
      expect(result).not.toContain('## Active Design System');
    });

    it('should not inject DS block when dsData.status is "none"', () => {
      const ds: DsBlockData = { status: 'none', colors: 'primary=#A259FF' };
      const result = buildSystemPrompt('Test Model', ds);
      expect(result).not.toContain('## Active Design System');
    });

    it('should inject DS block when status is "active"', () => {
      const ds: DsBlockData = {
        status: 'active',
        colors: 'primary=#A259FF secondary=#4A90D9',
        spacing: '8px grid [4 8 16 24 32 48]',
      };
      const result = buildSystemPrompt('Test Model', ds);
      expect(result).toContain('## Active Design System');
      expect(result).toContain('Colors: primary=#A259FF secondary=#4A90D9');
      expect(result).toContain('Space: 8px grid [4 8 16 24 32 48]');
      expect(result).toContain('Bind colors and spacing to these tokens');
    });

    it('should inject DS block when status is "partial"', () => {
      const ds: DsBlockData = { status: 'partial', colors: 'primary=#FF0000' };
      const result = buildSystemPrompt('Test Model', ds);
      expect(result).toContain('## Active Design System');
    });

    it('should inject DS block before Tool Selection Guide', () => {
      const ds: DsBlockData = { status: 'active', colors: 'primary=#A259FF' };
      const result = buildSystemPrompt('Test Model', ds);
      const dsIdx = result.indexOf('## Active Design System');
      const toolIdx = result.indexOf('## Tool Selection Guide');
      expect(dsIdx).toBeGreaterThan(-1);
      expect(toolIdx).toBeGreaterThan(-1);
      expect(dsIdx).toBeLessThan(toolIdx);
    });

    it('should show fallback when ds has status but no token details', () => {
      const ds: DsBlockData = { status: 'active' };
      const result = buildSystemPrompt('Test Model', ds);
      expect(result).toContain('Design system detected but no token details available');
    });

    it('should include typography and radii when provided', () => {
      const ds: DsBlockData = {
        status: 'active',
        typography: 'Inter — body=16/24/400',
        radii: 'sm=4 md=8 lg=16',
      };
      const result = buildSystemPrompt('Test Model', ds);
      expect(result).toContain('Type: Inter — body=16/24/400');
      expect(result).toContain('Radii: sm=4 md=8 lg=16');
    });
  });
});
