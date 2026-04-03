import { describe, expect, it } from 'vitest';
import { CATEGORY_MAP } from '../../../../src/main/compression/metrics.js';
import { compressMutationResult, MUTATION_TOOLS } from '../../../../src/main/compression/mutation-compressor.js';

describe('DS tools are NOT in MUTATION_TOOLS', () => {
  it('figma_setup_tokens is not a mutation tool', () => {
    expect(MUTATION_TOOLS.has('figma_setup_tokens')).toBe(false);
    expect(CATEGORY_MAP.figma_setup_tokens).toBe('ds');
  });

  it('figma_bind_variable is not a mutation tool', () => {
    expect(MUTATION_TOOLS.has('figma_bind_variable')).toBe(false);
    expect(CATEGORY_MAP.figma_bind_variable).toBe('ds');
  });

  it('figma_update_ds_page is categorized as ds', () => {
    expect(CATEGORY_MAP.figma_update_ds_page).toBe('ds');
    expect(MUTATION_TOOLS.has('figma_update_ds_page')).toBe(false);
  });

  it('compressMutationResult returns null for DS tools', () => {
    const content = [
      { type: 'text', text: JSON.stringify({ collectionId: 'col1', variables: [{ name: 'x', id: 'y' }] }) },
    ];
    expect(compressMutationResult('figma_setup_tokens', content, false)).toBeNull();
    expect(compressMutationResult('figma_bind_variable', content, false)).toBeNull();
  });

  it('task tools are categorized as task', () => {
    expect(CATEGORY_MAP.task_create).toBe('task');
    expect(CATEGORY_MAP.task_update).toBe('task');
    expect(CATEGORY_MAP.task_list).toBe('task');
  });

  it('mutation tools still include standard mutations', () => {
    expect(MUTATION_TOOLS.has('figma_set_fills')).toBe(true);
    expect(MUTATION_TOOLS.has('figma_set_text')).toBe(true);
    expect(MUTATION_TOOLS.has('figma_render_jsx')).toBe(true);
  });
});
