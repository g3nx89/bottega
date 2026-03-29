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
  it('returns true for all 16 mutation tools', () => {
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
      'figma_bind_variable',
      'figma_instantiate',
      'figma_set_instance_properties',
      'figma_arrange_component_set',
      'figma_setup_tokens',
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

  it('MUTATION_TOOLS Set has 17 entries', () => {
    expect(MUTATION_TOOLS.size).toBe(17);
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

describe('compressMutationResult — figma_setup_tokens', () => {
  it('extracts collectionId and variable count', () => {
    const payload = {
      collectionId: 'VariableCollectionId:1:2',
      modeIds: { Light: '1:0' },
      variables: [
        { name: 'colors/primary', id: 'VariableID:3:4' },
        { name: 'colors/secondary', id: 'VariableID:3:5' },
      ],
    };
    const result = compressMutationResult('figma_setup_tokens', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK collection=VariableCollectionId:1:2 vars=2');
  });

  it('handles zero variables', () => {
    const payload = { collectionId: 'VariableCollectionId:1:2', modeIds: {}, variables: [] };
    const result = compressMutationResult('figma_setup_tokens', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK collection=VariableCollectionId:1:2 vars=0');
  });

  it('returns null when collectionId is missing', () => {
    const payload = { modeIds: {}, variables: [] };
    const result = compressMutationResult('figma_setup_tokens', makeContent(payload), false);
    expect(result).toBeNull();
  });
});

describe('compressMutationResult — figma_bind_variable', () => {
  it('returns null when result has no nodeId (bind_variable returns only success: true)', () => {
    const payload = { success: true };
    const result = compressMutationResult('figma_bind_variable', makeContent(payload), false);
    expect(result).toBeNull();
  });

  it('compresses when node id is present', () => {
    const payload = { success: true, node: { id: '300:400', name: 'Text' } };
    const result = compressMutationResult('figma_bind_variable', makeContent(payload), false);
    expect(result!.content[0].text).toBe('OK node=300:400');
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
