/**
 * tool-meta.ts — side-map metadata for Bottega tools.
 * Asserts the override table wins over the category-derived defaults, that
 * the mutation flag covers the three "destructive" categories (mutation,
 * execute, ds), and that figma_execute is flagged non-restorable.
 */

import { describe, expect, it } from 'vitest';
import { CATEGORY_MAP } from '../../../src/main/compression/metrics.js';
import { getToolMeta, isMutation, isRestorable } from '../../../src/main/tool-meta.js';

describe('isMutation', () => {
  it('flags figma_set_fills as mutation', () => {
    expect(isMutation('figma_set_fills')).toBe(true);
  });
  it('flags figma_execute as mutation (execute category)', () => {
    expect(isMutation('figma_execute')).toBe(true);
  });
  it('flags figma_bind_variable as mutation (ds category)', () => {
    expect(isMutation('figma_bind_variable')).toBe(true);
  });
  it('does NOT flag figma_screenshot as mutation', () => {
    expect(isMutation('figma_screenshot')).toBe(false);
  });
  it('does NOT flag figma_get_selection as mutation', () => {
    expect(isMutation('figma_get_selection')).toBe(false);
  });
  it('does NOT flag task_create as mutation', () => {
    expect(isMutation('task_create')).toBe(false);
  });
});

describe('isRestorable', () => {
  it('flags figma_set_fills as restorable', () => {
    expect(isRestorable('figma_set_fills')).toBe(true);
  });
  it('flags figma_execute as NOT restorable (OVERRIDE)', () => {
    expect(isRestorable('figma_execute')).toBe(false);
  });
  it('flags non-mutation tools as NOT restorable', () => {
    expect(isRestorable('figma_screenshot')).toBe(false);
  });
});

describe('getToolMeta', () => {
  it('returns high blastRadius for figma_setup_tokens (OVERRIDE)', () => {
    expect(getToolMeta('figma_setup_tokens').blastRadius).toBe('high');
  });
  it('returns medium blastRadius for figma_delete (OVERRIDE)', () => {
    expect(getToolMeta('figma_delete').blastRadius).toBe('medium');
  });
  it('returns low blastRadius for figma_clone (OVERRIDE)', () => {
    expect(getToolMeta('figma_clone').blastRadius).toBe('low');
  });
  it('returns medium blastRadius by default for unknown mutation tool', () => {
    // figma_set_fills has no override → default medium
    expect(getToolMeta('figma_set_fills').blastRadius).toBe('medium');
  });
  it('returns other category for unknown tool', () => {
    expect(getToolMeta('figma_nonexistent').category).toBe('other');
  });
  it('override takes precedence over base spread', () => {
    const meta = getToolMeta('figma_execute');
    expect(meta.restorable).toBe(false);
    expect(meta.blastRadius).toBe('high');
    expect(meta.mutation).toBe(true); // base-derived, not overridden
    expect(meta.category).toBe('execute');
  });
});

describe('tool-meta OVERRIDES integrity', () => {
  // Imported at the top of this file.
  const TOOL_NAMES_IN_REGISTRY = new Set(Object.keys(CATEGORY_MAP));

  // Keep in sync with the OVERRIDES map in tool-meta.ts.
  const OVERRIDE_KEYS = [
    'figma_execute',
    'figma_delete',
    'figma_batch_transform',
    'figma_batch_set_text',
    'figma_batch_set_fills',
    'figma_clone',
    'figma_setup_tokens',
    'figma_bind_variable',
    'figma_update_ds_page',
  ] as const;

  for (const toolName of OVERRIDE_KEYS) {
    it(`OVERRIDES key "${toolName}" refers to a registered tool`, () => {
      expect(TOOL_NAMES_IN_REGISTRY.has(toolName)).toBe(true);
      expect(getToolMeta(toolName).category).not.toBe('other');
    });
  }
});
