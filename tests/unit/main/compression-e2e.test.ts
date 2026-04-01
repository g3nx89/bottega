/**
 * Compression E2E integration tests.
 *
 * Creates mock Figma connectors and exercises the full compression pipeline
 * across all profiles: config → tool execution → compression → metrics.
 */

import { describe, expect, it, vi } from 'vitest';
import { CompressionConfigManager, type CompressionProfile } from '../../../src/main/compression/compression-config.js';
import { DesignSystemCache } from '../../../src/main/compression/design-system-cache.js';
import { enrichExecuteResult } from '../../../src/main/compression/execute-enricher.js';
import { createCompressionExtensionFactory } from '../../../src/main/compression/extension-factory.js';
import { CompressionMetricsCollector } from '../../../src/main/compression/metrics.js';
import { compressMutationResult } from '../../../src/main/compression/mutation-compressor.js';
import { extractTree } from '../../../src/main/compression/project-tree.js';

// Mock logger
vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// ── Helpers ─────────────────────────────────

function mockPi() {
  const handlers: Record<string, (...args: any[]) => any> = {};
  return {
    on(event: string, handler: (...args: any[]) => any) {
      handlers[event] = handler;
    },
    fire(event: string, data: any) {
      return handlers[event]?.(data);
    },
  };
}

function makeToolEvent(toolName: string, resultData: any, isError = false) {
  return {
    toolName,
    toolCallId: `tc_${Date.now()}`,
    content: [{ type: 'text', text: typeof resultData === 'string' ? resultData : JSON.stringify(resultData) }],
    isError,
  };
}

function setupPipeline(profile: CompressionProfile = 'balanced') {
  const configManager = new CompressionConfigManager();
  configManager.setProfile(profile);
  const metrics = new CompressionMetricsCollector('e2e-test', 'test-model', 200_000);
  const factory = createCompressionExtensionFactory(configManager, metrics);
  const pi = mockPi();
  factory(pi);
  return { configManager, metrics, fire: pi.fire };
}

// ── Tests ───────────────────────────────────

describe('Compression E2E — balanced profile (default)', () => {
  it('mutation tool results are compressed to OK node=X:Y', async () => {
    const { fire } = setupPipeline('balanced');
    const result = await fire(
      'tool_result',
      makeToolEvent('figma_set_fills', {
        success: true,
        node: { id: '42:15', name: 'Rect', width: 200, height: 100, fills: [{ type: 'SOLID' }] },
      }),
    );
    expect(result).not.toBeNull();
    expect(result.content[0].text).toBe('OK node=42:15');
  });

  it('figma_execute gets ID prefix with full result preserved', async () => {
    const { fire } = setupPipeline('balanced');
    const payload = JSON.stringify({ nodeId: '99:10', name: 'Frame', children: Array(100).fill({ id: '0:0' }) });
    const result = await fire('tool_result', makeToolEvent('figma_execute', payload));
    expect(result).not.toBeNull();
    expect(result.content[0].text).toMatch(/^Returned IDs: 99:10/);
    // Full payload preserved
    expect(result.content[0].text).toContain('"children"');
  });

  it('non-compressible tool passes through unchanged', async () => {
    const { fire } = setupPipeline('balanced');
    const result = await fire(
      'tool_result',
      makeToolEvent('figma_status', { connected: true, fileInfo: { fileName: 'test.fig' } }),
    );
    expect(result).toBeNull();
  });

  it('error results pass through unmodified', async () => {
    const { fire } = setupPipeline('balanced');
    const result = await fire(
      'tool_result',
      makeToolEvent('figma_set_fills', { success: false, error: 'Node not found' }, true),
    );
    expect(result).toBeNull();
  });
});

describe('Compression E2E — minimal profile', () => {
  it('mutation tool results pass through uncompressed', async () => {
    const { fire } = setupPipeline('minimal');
    const result = await fire(
      'tool_result',
      makeToolEvent('figma_set_fills', { success: true, node: { id: '42:15', name: 'Rect' } }),
    );
    expect(result).toBeNull(); // no compression applied
  });

  it('figma_execute still gets ID enrichment (executeIdExtraction=true)', async () => {
    const { fire } = setupPipeline('minimal');
    const result = await fire('tool_result', makeToolEvent('figma_execute', JSON.stringify({ nodeId: '5:6' })));
    expect(result).not.toBeNull();
    expect(result.content[0].text).toContain('Returned IDs: 5:6');
  });
});

describe('Compression E2E — exploration profile', () => {
  it('mutations still compressed (exploration has compressMutationResults=true)', async () => {
    const { fire } = setupPipeline('exploration');
    const result = await fire(
      'tool_result',
      makeToolEvent('figma_resize', { success: true, node: { id: '10:20', name: 'Box', width: 300, height: 150 } }),
    );
    expect(result).not.toBeNull();
    expect(result.content[0].text).toBe('OK node=10:20');
  });
});

describe('Compression E2E — profile switching at runtime', () => {
  it('switching profile changes compression behavior immediately', async () => {
    const { fire, configManager } = setupPipeline('balanced');
    const event = makeToolEvent('figma_set_fills', { success: true, node: { id: '1:2', name: 'R' } });

    // Balanced: compressed
    const r1 = await fire('tool_result', event);
    expect(r1).not.toBeNull();
    expect(r1.content[0].text).toBe('OK node=1:2');

    // Switch to minimal: not compressed
    configManager.setProfile('minimal');
    const r2 = await fire('tool_result', event);
    expect(r2).toBeNull();

    // Switch back to balanced
    configManager.setProfile('balanced');
    const r3 = await fire('tool_result', event);
    expect(r3).not.toBeNull();
    expect(r3.content[0].text).toBe('OK node=1:2');
  });
});

describe('Compression E2E — design system cache', () => {
  const rawDesignSystem = {
    variables: [
      {
        name: 'Tokens',
        id: 'VC:1',
        modes: [{ modeId: 'm1', name: 'Light' }],
        variables: [
          {
            name: 'colors/primary',
            resolvedType: 'COLOR',
            valuesByMode: { m1: { r: 0.2, g: 0.4, b: 1, a: 1 } },
          },
        ],
      },
    ],
    components: [{ name: 'Button', key: 'comp:1', componentSetName: 'Buttons' }],
  };

  it('cache stores and returns compact data', () => {
    const cache = new DesignSystemCache(60_000);
    const { compact } = cache.set(rawDesignSystem);

    expect(compact.variables).toHaveLength(1);
    expect(compact.variables[0].name).toBe('Tokens');

    // Get compact
    const cachedCompact = cache.get(true);
    expect(cachedCompact).toEqual(compact);

    // Get raw
    const cachedRaw = cache.get(false);
    expect(cachedRaw).toEqual(rawDesignSystem);
  });

  it('invalidate clears cache', () => {
    const cache = new DesignSystemCache(60_000);
    cache.set(rawDesignSystem);
    expect(cache.isValid()).toBe(true);

    cache.invalidate();
    expect(cache.isValid()).toBe(false);
    expect(cache.get(true)).toBeNull();
  });

  it('forceRefresh pattern works', () => {
    const cache = new DesignSystemCache(60_000);
    cache.set(rawDesignSystem);

    // Simulate forceRefresh: skip cache, re-set
    const newRaw = { ...rawDesignSystem, components: [] };
    cache.set(newRaw);
    const result = cache.get(false);
    expect((result as any).components).toEqual([]);
  });
});

describe('Compression E2E — tree extraction', () => {
  it('extracts a realistic Figma node tree', () => {
    const rawTree = {
      id: '0:1',
      type: 'FRAME',
      name: 'Page',
      width: 1440,
      height: 900,
      visible: true,
      opacity: 1,
      layoutMode: 'VERTICAL',
      itemSpacing: 16,
      paddingTop: 24,
      paddingRight: 24,
      paddingBottom: 24,
      paddingLeft: 24,
      fills: [{ type: 'SOLID', visible: true, color: { r: 1, g: 1, b: 1 } }],
      strokes: [],
      effects: [],
      children: [
        {
          id: '1:1',
          type: 'TEXT',
          name: 'Title',
          width: 200,
          height: 32,
          visible: true,
          opacity: 1,
          characters: 'Hello World',
          fontSize: 24,
          fills: [{ type: 'SOLID', visible: true, color: { r: 0, g: 0, b: 0 } }],
          strokes: [],
          effects: [],
          children: [],
        },
        {
          id: '2:1',
          type: 'INSTANCE',
          name: 'Button',
          width: 120,
          height: 40,
          visible: false,
          opacity: 1,
          mainComponent: { key: 'comp:btn' },
          fills: [],
          strokes: [],
          effects: [{ type: 'DROP_SHADOW', visible: true }],
          children: [],
        },
      ],
    };

    const result = extractTree(rawTree, 'full');
    const page = result.nodes[0];

    expect(page.id).toBe('0:1');
    expect(page.type).toBe('FRAME');
    expect(page.name).toBe('Page');
    expect(page.layout?.mode).toBe('column');
    expect(page.layout?.gap).toBe('16px');
    expect(page.layout?.padding).toBe('24px');

    // Children — the INSTANCE with visible:false is filtered out by extractTree
    expect(page.children).toHaveLength(1);

    const title = page.children![0];
    expect(title.type).toBe('TEXT');
    expect(title.text).toBe('Hello World');

    // Verify compression: extracted JSON should be much smaller
    const rawSize = JSON.stringify(rawTree).length;
    const extractedSize = JSON.stringify(result).length;
    expect(extractedSize).toBeLessThan(rawSize * 0.5);
  });

  it('full mode includes text and opacity', () => {
    const rawNode = {
      id: '1:1',
      type: 'TEXT',
      name: 'Label',
      width: 100,
      height: 20,
      visible: true,
      opacity: 0.8,
      characters: 'Test',
      fontSize: 14,
      fills: [],
      strokes: [],
      effects: [],
    };

    const result = extractTree(rawNode, 'full');
    const node = result.nodes[0];
    expect(node.text).toBe('Test');
    expect(node.opacity).toBe(0.8);
  });
});

describe('Compression E2E — metrics collection', () => {
  it('records metrics for all tool calls across a session', async () => {
    const { fire, metrics } = setupPipeline('balanced');

    // Simulate a mini session
    await fire('tool_result', makeToolEvent('figma_set_fills', { success: true, node: { id: '1:1', name: 'R' } }));
    await fire(
      'tool_result',
      makeToolEvent('figma_resize', { success: true, node: { id: '1:1', name: 'R', width: 100, height: 50 } }),
    );
    await fire('tool_result', makeToolEvent('figma_execute', JSON.stringify({ nodeId: '2:2', data: 'x'.repeat(100) })));
    await fire('tool_result', makeToolEvent('figma_screenshot', '{"image":"base64..."}'));

    const session = metrics.getSessionMetrics();
    expect(session.totalToolCalls).toBe(4);
    expect(session.totalTokensSaved).toBeGreaterThan(0);
    expect(session.toolCallsByCategory.mutation).toBe(2);
    expect(session.toolCallsByCategory.execute).toBe(1);
    expect(session.toolCallsByCategory.screenshot).toBe(1);
  });

  it('flags large figma_execute results', async () => {
    const { fire, metrics } = setupPipeline('balanced');
    const spy = vi.spyOn(metrics, 'recordToolCompression');

    const largePayload = JSON.stringify({ id: '1:2', data: 'x'.repeat(15_000) });
    await fire('tool_result', makeToolEvent('figma_execute', largePayload));

    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ largeResult: true }));
  });
});

describe('Compression E2E — individual compressors', () => {
  it('compressMutationResult handles all 17 mutation tools', () => {
    const mutationTools = [
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
      'figma_instantiate',
      'figma_set_instance_properties',
      'figma_arrange_component_set',
      'figma_setup_tokens',
      'figma_render_jsx',
      'figma_create_icon',
      'figma_bind_variable',
    ];

    // Tool-specific payloads for special-cased tools
    const payloads: Record<string, any> = {
      figma_delete: { success: true, deleted: { id: '1:1', name: 'N' } },
      figma_setup_tokens: {
        collectionId: 'VC:1:2',
        modeIds: { Light: '1:0' },
        variables: [{ name: 'c/p', id: 'V:3:4' }],
      },
      figma_render_jsx: { success: true, nodeId: '1:1', childIds: ['2:2'] },
    };
    const defaultPayload = { success: true, node: { id: '1:1', name: 'N' } };

    for (const tool of mutationTools) {
      const data = payloads[tool] ?? defaultPayload;
      const content = [{ type: 'text', text: JSON.stringify(data) }];
      const result = compressMutationResult(tool, content, false);
      expect(result, `${tool} should be compressed`).not.toBeNull();
      expect(result!.content[0].text).toContain('OK');
    }
  });

  it('enrichExecuteResult extracts IDs without truncating', () => {
    const bigPayload = `{"nodes":["10:20","30:40"],"data":"${'x'.repeat(50_000)}"}`;
    const content = [{ type: 'text', text: bigPayload }];
    const result = enrichExecuteResult(content);

    expect(result).not.toBeNull();
    expect(result!.extractedIds).toContain('10:20');
    expect(result!.extractedIds).toContain('30:40');
    // Full content preserved
    expect(result!.content[0].text.length).toBeGreaterThan(50_000);
  });
});
