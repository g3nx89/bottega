import { describe, expect, it } from 'vitest';
import {
  compressMutationResult,
  isMutationTool,
  MUTATION_TOOLS,
} from '../../../../src/main/compression/mutation-compressor.js';

// Helper to build a content array matching the textResult() shape
function makeContent(data: unknown): any[] {
  return [{ type: 'text', text: JSON.stringify(data) }];
}

// Standard node payload used by most mutation tools
function nodePayload(id = '123:456', name = 'Button') {
  return { success: true, node: { id, name, width: 200, height: 48 } };
}

describe('isMutationTool', () => {
  it('returns true for all mutation tools', () => {
    const expected = [
      'figma_set_fills',
      'figma_set_strokes',
      'figma_set_text',
      'figma_set_image_fill',
      'figma_resize',
      'figma_move',
      'figma_create_child',
      'figma_clone',
      'figma_delete',
      'figma_rename',
      'figma_render_jsx',
      'figma_create_icon',
      'figma_instantiate',
      'figma_set_instance_properties',
      'figma_arrange_component_set',
      'figma_batch_set_text',
      'figma_batch_set_fills',
      'figma_batch_transform',
      'figma_auto_layout',
      'figma_set_variant',
      'figma_set_text_style',
      'figma_set_effects',
      'figma_set_opacity',
      'figma_set_corner_radius',
      'figma_set_annotations',
    ];
    for (const name of expected) {
      expect(isMutationTool(name)).toBe(true);
    }
  });

  it('returns false for non-mutation tools', () => {
    expect(isMutationTool('figma_screenshot')).toBe(false);
    expect(isMutationTool('figma_get_file_data')).toBe(false);
    expect(isMutationTool('figma_design_system')).toBe(false);
    expect(isMutationTool('')).toBe(false);
  });

  it('MUTATION_TOOLS Set has 26 entries', () => {
    expect(MUTATION_TOOLS.size).toBe(26);
  });
});

describe('compressMutationResult — pass-through cases', () => {
  it('returns null for non-mutation tool', () => {
    const result = compressMutationResult('figma_screenshot', makeContent({ url: 'http://x' }), false);
    expect(result).toBeNull();
  });

  it('returns null when isError is true', () => {
    const result = compressMutationResult('figma_set_fills', makeContent({ error: 'timeout' }), true);
    expect(result).toBeNull();
  });

  it('returns null for empty content array', () => {
    const result = compressMutationResult('figma_set_fills', [], false);
    expect(result).toBeNull();
  });

  it('returns null for malformed JSON in content', () => {
    const result = compressMutationResult('figma_set_fills', [{ type: 'text', text: 'not json{{{' }], false);
    expect(result).toBeNull();
  });

  it('returns null when no nodeId can be extracted', () => {
    const result = compressMutationResult('figma_set_fills', makeContent({ success: true }), false);
    expect(result).toBeNull();
  });
});

describe('compressMutationResult — standard mutation tools', () => {
  const standardTools = [
    'figma_set_fills',
    'figma_set_strokes',
    'figma_set_text',
    'figma_set_image_fill',
    'figma_resize',
    'figma_move',
    'figma_create_child',
    'figma_clone',
    'figma_rename',
  ];

  for (const toolName of standardTools) {
    it(`${toolName} → OK node=X:Y`, () => {
      const result = compressMutationResult(toolName, makeContent(nodePayload('123:456')), false);
      expect(result).not.toBeNull();
      expect(result!.content).toHaveLength(1);
      expect(result!.content[0].type).toBe('text');
      expect(result!.content[0].text).toBe('OK node=123:456');
    });
  }

  it('figma_set_fills with different node ID', () => {
    const result = compressMutationResult('figma_set_fills', makeContent(nodePayload('789:101')), false);
    expect(result!.content[0].text).toBe('OK node=789:101');
  });

  it('figma_resize with realistic payload', () => {
    const payload = { success: true, node: { id: '55:66', name: 'Card', width: 320, height: 240 } };
    const result = compressMutationResult('figma_resize', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK node=55:66');
  });
});

describe('compressMutationResult — figma_delete', () => {
  it('extracts id from deleted field', () => {
    const payload = { success: true, deleted: { id: '123:456', name: 'Old Button' } };
    const result = compressMutationResult('figma_delete', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK deleted=123:456');
  });

  it('falls back to node.id if deleted is missing', () => {
    const payload = { success: true, node: { id: '99:1', name: 'Fallback' } };
    const result = compressMutationResult('figma_delete', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK deleted=99:1');
  });
});

describe('compressMutationResult — figma_render_jsx', () => {
  it('includes childIds when present', () => {
    const payload = { success: true, nodeId: '123:456', childIds: ['234:567', '345:678'] };
    const result = compressMutationResult('figma_render_jsx', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK node=123:456 children=234:567,345:678');
  });

  it('omits children part when childIds is empty', () => {
    const payload = { success: true, nodeId: '123:456', childIds: [] };
    const result = compressMutationResult('figma_render_jsx', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK node=123:456');
  });

  it('omits children part when childIds is absent', () => {
    const payload = { success: true, nodeId: '123:456' };
    const result = compressMutationResult('figma_render_jsx', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK node=123:456');
  });

  it('falls back to node.id if nodeId field is missing', () => {
    const payload = { success: true, node: { id: '7:8', name: 'Frame' }, childIds: ['9:10'] };
    const result = compressMutationResult('figma_render_jsx', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK node=7:8 children=9:10');
  });
});

describe('compressMutationResult — figma_instantiate', () => {
  it('extracts node id from standard payload', () => {
    const result = compressMutationResult('figma_instantiate', makeContent(nodePayload('200:300')), false);
    expect(result!.content[0].text).toBe('OK node=200:300');
  });
});

describe('compressMutationResult — figma_set_instance_properties', () => {
  it('extracts node id from standard payload', () => {
    const result = compressMutationResult('figma_set_instance_properties', makeContent(nodePayload('400:500')), false);
    expect(result!.content[0].text).toBe('OK node=400:500');
  });
});

describe('compressMutationResult — figma_arrange_component_set', () => {
  it('returns null when result has no nodeId (arrange returns arranged count)', () => {
    const payload = { success: true, arranged: 8, columns: 4 };
    const result = compressMutationResult('figma_arrange_component_set', makeContent(payload), false);
    expect(result).toBeNull();
  });

  it('compresses when node id is present', () => {
    const result = compressMutationResult('figma_arrange_component_set', makeContent(nodePayload('11:22')), false);
    expect(result!.content[0].text).toBe('OK node=11:22');
  });
});

describe('compressMutationResult — figma_setup_tokens (DS tool, not compressed)', () => {
  it('returns null — figma_setup_tokens is a DS tool, not a mutation tool', () => {
    const payload = {
      collectionId: 'VariableCollectionId:1:2',
      modeIds: { Light: '1:0' },
      variables: [
        { name: 'colors/primary', id: 'VariableID:3:4' },
        { name: 'colors/secondary', id: 'VariableID:3:5' },
      ],
    };
    const result = compressMutationResult('figma_setup_tokens', makeContent(payload), false);
    expect(result).toBeNull();
  });

  it('returns null even with valid collectionId', () => {
    const payload = { collectionId: 'VariableCollectionId:1:2', modeIds: {}, variables: [] };
    const result = compressMutationResult('figma_setup_tokens', makeContent(payload), false);
    expect(result).toBeNull();
  });
});

describe('compressMutationResult — figma_bind_variable (DS tool, not compressed)', () => {
  it('returns null — figma_bind_variable is a DS tool, not a mutation tool', () => {
    const payload = { success: true };
    const result = compressMutationResult('figma_bind_variable', makeContent(payload), false);
    expect(result).toBeNull();
  });

  it('returns null even when node id is present', () => {
    const payload = { success: true, node: { id: '300:400', name: 'Text' } };
    const result = compressMutationResult('figma_bind_variable', makeContent(payload), false);
    expect(result).toBeNull();
  });
});

describe('compressMutationResult — figma_create_icon', () => {
  it('extracts node id', () => {
    const payload = { success: true, node: { id: '500:600', name: 'mdi:home' } };
    const result = compressMutationResult('figma_create_icon', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK node=500:600');
  });

  it('extracts nodeId from flat field', () => {
    const payload = { success: true, nodeId: '700:800' };
    const result = compressMutationResult('figma_create_icon', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK node=700:800');
  });
});

describe('compressMutationResult — batch operations', () => {
  it('compresses figma_batch_set_text to OK batch=N/M format', () => {
    const payload = { updated: 5, total: 5, results: [] };
    const result = compressMutationResult('figma_batch_set_text', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK batch=5/5');
  });

  it('compresses figma_batch_set_fills to OK batch=N/M format', () => {
    const payload = { updated: 3, total: 3, results: [] };
    const result = compressMutationResult('figma_batch_set_fills', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK batch=3/3');
  });

  it('compresses figma_batch_transform to OK batch=N/M format', () => {
    const payload = { updated: 10, total: 10, results: [] };
    const result = compressMutationResult('figma_batch_transform', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK batch=10/10');
  });

  it('handles partial failures', () => {
    const payload = {
      updated: 8,
      total: 10,
      results: [
        { nodeId: '1:1', success: true },
        { nodeId: '1:2', success: false, error: 'Not a text node' },
      ],
    };
    const result = compressMutationResult('figma_batch_set_text', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK batch=8/10');
  });

  it('falls back to counting results when updated field is missing', () => {
    const payload = {
      total: 3,
      results: [
        { nodeId: '1:1', success: true },
        { nodeId: '1:2', success: true },
        { nodeId: '1:3', success: false },
      ],
    };
    const result = compressMutationResult('figma_batch_set_fills', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK batch=2/3');
  });

  it('returns null for error results (no compression)', () => {
    const result = compressMutationResult('figma_batch_set_text', makeContent({ error: 'fail' }), true);
    expect(result).toBeNull();
  });
});

describe('compressMutationResult — new standard mutation tools', () => {
  it('compresses figma_auto_layout', () => {
    const result = compressMutationResult('figma_auto_layout', makeContent(nodePayload('10:20')), false);
    expect(result!.content[0].text).toBe('OK node=10:20');
  });

  it('compresses figma_set_variant via instance.id', () => {
    const payload = { success: true, instance: { id: '30:40', name: 'Button', appliedVariants: {} } };
    const result = compressMutationResult('figma_set_variant', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK node=30:40');
  });

  it('compresses figma_set_text_style', () => {
    const result = compressMutationResult('figma_set_text_style', makeContent(nodePayload('50:60')), false);
    expect(result!.content[0].text).toBe('OK node=50:60');
  });

  it('compresses figma_set_effects', () => {
    const result = compressMutationResult('figma_set_effects', makeContent(nodePayload('70:80')), false);
    expect(result!.content[0].text).toBe('OK node=70:80');
  });

  it('compresses figma_set_opacity', () => {
    const result = compressMutationResult('figma_set_opacity', makeContent(nodePayload('90:100')), false);
    expect(result!.content[0].text).toBe('OK node=90:100');
  });

  it('compresses figma_set_corner_radius', () => {
    const result = compressMutationResult('figma_set_corner_radius', makeContent(nodePayload('110:120')), false);
    expect(result!.content[0].text).toBe('OK node=110:120');
  });
});
