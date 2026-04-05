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
  it('figma_create_child → full', () => {
    expect(determineTier(['figma_create_child'])).toBe('full');
  });

  it('figma_execute → full', () => {
    expect(determineTier(['figma_execute'])).toBe('full');
  });

  it('figma_render_jsx → full', () => {
    expect(determineTier(['figma_render_jsx'])).toBe('full');
  });

  it('figma_clone → full', () => {
    expect(determineTier(['figma_clone'])).toBe('full');
  });

  it('figma_instantiate → full', () => {
    expect(determineTier(['figma_instantiate'])).toBe('full');
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

  it('mixed tools: figma_set_fills + figma_create_child → full (highest wins)', () => {
    expect(determineTier(['figma_set_fills', 'figma_create_child'])).toBe('full');
  });

  it('mixed: figma_screenshot + figma_set_fills → visual', () => {
    expect(determineTier(['figma_screenshot', 'figma_set_fills'])).toBe('visual');
  });

  it('discovery-only → narrow', () => {
    expect(determineTier(['figma_get_file_data', 'figma_screenshot'])).toBe('narrow');
  });
});
