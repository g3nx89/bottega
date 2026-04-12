/**
 * Tests for determineTier — the function that maps tool usage to judge activation tier.
 *
 * Tier thresholds (post-calibration):
 * - standard: 1-4 structural tools → core quality judges
 * - full: 5+ structural tools → all judges
 * - visual: styling-only (no structural) → styling-relevant subset
 * - narrow: rename or token-only changes
 *
 * Note: the old 'minimal' tier was removed — even simple creations (1 structural tool)
 * now get the standard tier with 5 judges for meaningful quality evaluation.
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
    judgeEvidence: null,
  }),
}));

import { determineTier } from '../../../../src/main/subagent/judge-harness.js';

describe('determineTier', () => {
  // ── Standard tier: any creation (1-4 structural tools) ─────────────

  it('1 structural tool → standard', () => {
    expect(determineTier(['figma_create_child'])).toBe('standard');
  });

  it('1 execute → standard', () => {
    expect(determineTier(['figma_execute'])).toBe('standard');
  });

  it('1 render_jsx → standard', () => {
    expect(determineTier(['figma_render_jsx'])).toBe('standard');
  });

  it('1 clone → standard', () => {
    expect(determineTier(['figma_clone'])).toBe('standard');
  });

  it('1 instantiate → standard', () => {
    expect(determineTier(['figma_instantiate'])).toBe('standard');
  });

  it('3 structural tools → standard', () => {
    expect(determineTier(['figma_create_child', 'figma_clone', 'figma_render_jsx'])).toBe('standard');
  });

  it('4 structural tools → standard (boundary)', () => {
    expect(determineTier(['figma_create_child', 'figma_clone', 'figma_render_jsx', 'figma_instantiate'])).toBe(
      'standard',
    );
  });

  // ── Full tier: complex multi-element designs (5+ structural) ───────

  it('5 structural tools → full (boundary)', () => {
    const tools = Array.from({ length: 5 }, () => 'figma_create_child');
    expect(determineTier(tools)).toBe('full');
  });

  it('9+ structural tools → full', () => {
    const tools = Array.from({ length: 9 }, () => 'figma_create_child');
    expect(determineTier(tools)).toBe('full');
  });

  it('10 structural tools → full (well above boundary)', () => {
    const tools = Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? 'figma_create_child' : 'figma_render_jsx'));
    expect(determineTier(tools)).toBe('full');
  });

  // ── Visual tier: styling-only changes ──────────────────────────────

  it('figma_set_fills → visual', () => {
    expect(determineTier(['figma_set_fills'])).toBe('visual');
  });

  it('figma_set_text → visual', () => {
    expect(determineTier(['figma_set_text'])).toBe('visual');
  });

  it('figma_setup_tokens → visual (ds category)', () => {
    expect(determineTier(['figma_setup_tokens'])).toBe('visual');
  });

  // ── Narrow tier: rename or discovery only ──────────────────────────

  it('figma_rename alone → narrow (naming-only tool)', () => {
    expect(determineTier(['figma_rename'])).toBe('narrow');
  });

  it('discovery-only → narrow', () => {
    expect(determineTier(['figma_get_file_data', 'figma_screenshot'])).toBe('narrow');
  });

  // ── Mixed tool scenarios ───────────────────────────────────────────

  it('figma_rename + figma_set_fills → visual (rename + visual mutation)', () => {
    expect(determineTier(['figma_rename', 'figma_set_fills'])).toBe('visual');
  });

  it('mixed: figma_set_fills + figma_create_child → standard (1 structural)', () => {
    expect(determineTier(['figma_set_fills', 'figma_create_child'])).toBe('standard');
  });

  it('mixed: figma_screenshot + figma_set_fills → visual', () => {
    expect(determineTier(['figma_screenshot', 'figma_set_fills'])).toBe('visual');
  });

  it('mix of structural + visual + rename → tier determined by structural count only', () => {
    // 2 structural + 1 visual + 1 rename = standard (structural count = 2)
    const tools = ['figma_create_child', 'figma_clone', 'figma_set_fills', 'figma_rename'];
    expect(determineTier(tools)).toBe('standard');
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
});
