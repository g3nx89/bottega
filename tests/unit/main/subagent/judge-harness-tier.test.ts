/**
 * Tests for determineTier — the function that maps tool usage to judge activation tier.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('../../../../src/main/subagent/orchestrator.js', () => ({
  runSubagentBatch: vi.fn(),
  runMicroJudgeBatch: vi.fn(),
}));

vi.mock('../../../../src/main/subagent/read-only-tools.js', () => ({
  createReadOnlyTools: vi.fn(() => []),
}));

vi.mock('../../../../src/main/subagent/context-prefetch.js', () => ({
  prefetchCommonContext: vi.fn(),
  formatBriefing: vi.fn(() => ''),
  prefetchForMicroJudges: vi.fn().mockResolvedValue({
    screenshot: null,
    fileData: null,
    designSystem: null,
    lint: null,
    libraryComponents: null,
    componentAnalysis: null,
  }),
}));

import { determineTier } from '../../../../src/main/subagent/judge-harness.js';

describe('determineTier', () => {
  // Complexity-based: structural tool COUNT determines tier
  it('1 structural tool → minimal', () => {
    expect(determineTier(['figma_create_child'])).toBe('minimal');
  });

  it('1 execute → minimal', () => {
    expect(determineTier(['figma_execute'])).toBe('minimal');
  });

  it('1 render_jsx → minimal', () => {
    expect(determineTier(['figma_render_jsx'])).toBe('minimal');
  });

  it('1 clone → minimal', () => {
    expect(determineTier(['figma_clone'])).toBe('minimal');
  });

  it('1 instantiate → minimal', () => {
    expect(determineTier(['figma_instantiate'])).toBe('minimal');
  });

  it('3 structural tools → standard', () => {
    expect(determineTier(['figma_create_child', 'figma_clone', 'figma_render_jsx'])).toBe('standard');
  });

  it('9+ structural tools → full', () => {
    const tools = Array.from({ length: 9 }, () => 'figma_create_child');
    expect(determineTier(tools)).toBe('full');
  });

  it('figma_set_fills → visual', () => {
    expect(determineTier(['figma_set_fills'])).toBe('visual');
  });

  it('figma_set_text → visual', () => {
    expect(determineTier(['figma_set_text'])).toBe('visual');
  });

  it('figma_setup_tokens → visual (ds category)', () => {
    expect(determineTier(['figma_setup_tokens'])).toBe('visual');
  });

  it('figma_rename alone → narrow (naming-only tool)', () => {
    expect(determineTier(['figma_rename'])).toBe('narrow');
  });

  it('figma_rename + figma_set_fills → visual (rename + visual mutation)', () => {
    expect(determineTier(['figma_rename', 'figma_set_fills'])).toBe('visual');
  });

  it('mixed: figma_set_fills + figma_create_child → minimal (1 structural)', () => {
    expect(determineTier(['figma_set_fills', 'figma_create_child'])).toBe('minimal');
  });

  it('mixed: figma_screenshot + figma_set_fills → visual', () => {
    expect(determineTier(['figma_screenshot', 'figma_set_fills'])).toBe('visual');
  });

  it('discovery-only → narrow', () => {
    expect(determineTier(['figma_get_file_data', 'figma_screenshot'])).toBe('narrow');
  });

  // ── Boundary edge cases ─────────────────────────────────────────────

  it('exactly 2 structural tools → minimal (boundary)', () => {
    expect(determineTier(['figma_create_child', 'figma_clone'])).toBe('minimal');
  });

  it('exactly 8 structural tools → standard (boundary, < 9)', () => {
    const tools = Array.from({ length: 8 }, () => 'figma_create_child');
    expect(determineTier(tools)).toBe('standard');
  });

  it('exactly 9 structural tools → full (boundary)', () => {
    const tools = Array.from({ length: 9 }, () => 'figma_clone');
    expect(determineTier(tools)).toBe('full');
  });

  it('mix of structural + visual + rename → tier determined by structural count only', () => {
    // 2 structural + 1 visual + 1 rename = minimal (structural count = 2)
    const tools = ['figma_create_child', 'figma_clone', 'figma_set_fills', 'figma_rename'];
    expect(determineTier(tools)).toBe('minimal');
  });

  it('3 structural + visual mutations → standard (structural count = 3)', () => {
    const tools = [
      'figma_create_child',
      'figma_clone',
      'figma_render_jsx',
      'figma_set_fills',
      'figma_set_text',
      'figma_rename',
    ];
    expect(determineTier(tools)).toBe('standard');
  });

  it('figma_execute counts as structural', () => {
    // 3 execute calls = standard
    expect(determineTier(['figma_execute', 'figma_execute', 'figma_execute'])).toBe('standard');
  });

  it('10 structural tools → full (well above boundary)', () => {
    const tools = Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? 'figma_create_child' : 'figma_render_jsx'));
    expect(determineTier(tools)).toBe('full');
  });
});
