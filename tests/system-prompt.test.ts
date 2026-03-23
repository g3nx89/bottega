import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/main/system-prompt.js';

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
});
