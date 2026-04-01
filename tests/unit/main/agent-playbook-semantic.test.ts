/**
 * Playbook integration tests for the semantic extraction pipeline.
 *
 * Exercises figma_get_file_data with mode params, style dedup, SVG collapse,
 * and format-aware output through the full Pi SDK agent session.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompressionConfigManager } from '../../../src/main/compression/compression-config.js';
import type { BottegaTestSession } from '../../helpers/bottega-test-session.js';
import { createBottegaTestSession } from '../../helpers/bottega-test-session.js';
import { calls, says, when } from '../../helpers/playbook.js';

// Mock logger
vi.mock('../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('semantic extraction — playbook integration', () => {
  let t: BottegaTestSession | null = null;

  afterEach(() => {
    t?.dispose();
    t = null;
  });

  describe('figma_get_file_data with mode param', () => {
    it('full mode returns SemanticResult with nodes', async () => {
      const rawTree = JSON.stringify({
        id: '0:1',
        type: 'FRAME',
        name: 'Page',
        visible: true,
        width: 1440,
        height: 900,
        layoutMode: 'VERTICAL',
        fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true }],
        children: [
          {
            id: '1:1',
            type: 'TEXT',
            name: 'Title',
            visible: true,
            characters: 'Hello',
            fontSize: 24,
            style: { fontFamily: 'Inter', fontWeight: 700 },
            fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, visible: true }],
          },
        ],
      });

      const configManager = new CompressionConfigManager();
      configManager.setProfile('balanced');

      t = await createBottegaTestSession({
        toolDeps: {
          connector: {
            executeCodeViaUI: vi.fn().mockResolvedValue(rawTree),
          } as any,
          configManager,
        },
        compressionProfile: 'balanced',
      });

      await t.run(
        when('Show me the page structure', [
          calls('figma_get_file_data', { mode: 'full' }),
          says('Here is the page structure.'),
        ]),
      );

      const results = t.events.toolResultsFor('figma_get_file_data');
      expect(results).toHaveLength(1);
      const text = results[0].text;

      // balanced profile → YAML output
      expect(text).not.toMatch(/^\{/);
      expect(text).toContain('nodes');
    });

    it('structure mode omits fills and text', async () => {
      const rawTree = JSON.stringify({
        id: '0:1',
        type: 'FRAME',
        name: 'Page',
        visible: true,
        width: 1440,
        height: 900,
        layoutMode: 'HORIZONTAL',
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
        children: [{ id: '1:1', type: 'TEXT', name: 'Label', visible: true, characters: 'Hello', fontSize: 14 }],
      });

      t = await createBottegaTestSession({
        toolDeps: {
          connector: {
            executeCodeViaUI: vi.fn().mockResolvedValue(rawTree),
          } as any,
        },
        compressionProfile: 'balanced',
      });

      await t.run(when('Get structure only', [calls('figma_get_file_data', { mode: 'structure' }), says('Done.')]));

      const results = t.events.toolResultsFor('figma_get_file_data');
      const text = results[0].text;
      // Structure mode should have layout but not fills or text content
      expect(text).toContain('row');
      expect(text).not.toContain('#FF0000');
      expect(text).not.toContain('Hello');
    });

    it('briefing mode produces minimal output', async () => {
      const rawTree = JSON.stringify({
        id: '0:1',
        type: 'FRAME',
        name: 'Page',
        visible: true,
        width: 1440,
        height: 900,
        children: [{ id: '1:1', type: 'TEXT', name: 'Title', visible: true, characters: 'Big text', fontSize: 32 }],
      });

      t = await createBottegaTestSession({
        toolDeps: {
          connector: {
            executeCodeViaUI: vi.fn().mockResolvedValue(rawTree),
          } as any,
        },
        compressionProfile: 'balanced',
      });

      await t.run(
        when('Quick briefing', [calls('figma_get_file_data', { mode: 'briefing' }), says('Briefing ready.')]),
      );

      const results = t.events.toolResultsFor('figma_get_file_data');
      const text = results[0].text;
      expect(text).toContain('Page');
      expect(text).toContain('Title');
      expect(text.length).toBeLessThan(500);
    });
  });

  describe('SVG collapse through full pipeline', () => {
    it('vector-only frames collapse to IMAGE-SVG', async () => {
      const rawTree = JSON.stringify({
        id: '0:1',
        type: 'FRAME',
        name: 'Page',
        visible: true,
        width: 800,
        height: 600,
        children: [
          {
            id: '2:1',
            type: 'FRAME',
            name: 'Icon',
            visible: true,
            width: 24,
            height: 24,
            children: [
              { id: '2:2', type: 'VECTOR', name: 'Path1', visible: true },
              { id: '2:3', type: 'VECTOR', name: 'Path2', visible: true },
            ],
          },
        ],
      });

      t = await createBottegaTestSession({
        toolDeps: {
          connector: {
            executeCodeViaUI: vi.fn().mockResolvedValue(rawTree),
          } as any,
        },
        compressionProfile: 'balanced',
      });

      await t.run(when('Analyze', [calls('figma_get_file_data', { mode: 'full' }), says('Done.')]));

      const text = t.events.toolResultsFor('figma_get_file_data')[0].text;
      expect(text).toContain('IMAGE-SVG');
      expect(text).not.toContain('Path1');
      expect(text).not.toContain('Path2');
    });
  });

  describe('profile-controlled output format', () => {
    it('balanced profile outputs YAML', async () => {
      const rawTree = JSON.stringify({
        id: '0:1',
        type: 'FRAME',
        name: 'Page',
        visible: true,
        width: 800,
        height: 600,
        children: [],
      });

      const configManager = new CompressionConfigManager();
      configManager.setProfile('balanced');

      t = await createBottegaTestSession({
        toolDeps: {
          connector: { executeCodeViaUI: vi.fn().mockResolvedValue(rawTree) } as any,
          configManager,
        },
        compressionProfile: 'balanced',
      });

      await t.run(when('Get data', [calls('figma_get_file_data'), says('Done.')]));

      const text = t.events.toolResultsFor('figma_get_file_data')[0].text;
      expect(text).not.toMatch(/^\{/); // YAML, not JSON
    });

    it('minimal profile outputs JSON', async () => {
      const rawTree = JSON.stringify({
        id: '0:1',
        type: 'FRAME',
        name: 'Page',
        visible: true,
        width: 800,
        height: 600,
        children: [],
      });

      const configManager = new CompressionConfigManager();
      configManager.setProfile('minimal');

      t = await createBottegaTestSession({
        toolDeps: {
          connector: { executeCodeViaUI: vi.fn().mockResolvedValue(rawTree) } as any,
          configManager,
        },
        compressionProfile: 'minimal',
      });

      await t.run(when('Get data', [calls('figma_get_file_data'), says('Done.')]));

      const text = t.events.toolResultsFor('figma_get_file_data')[0].text;
      expect(text).toMatch(/^\{/); // JSON
    });
  });

  describe('mutation compression still works', () => {
    it('mutation tools are unaffected by semantic extraction', async () => {
      t = await createBottegaTestSession({
        toolDeps: {
          connector: {
            setNodeFills: vi.fn().mockResolvedValue({ nodeId: '42:15', success: true, node: { id: '42:15' } }),
          } as any,
        },
        compressionProfile: 'balanced',
      });

      await t.run(
        when('Set fills', [
          calls('figma_set_fills', { nodeId: '42:15', fills: [{ type: 'SOLID', color: '#FF0000' }] }),
          says('Fills applied.'),
        ]),
      );

      const results = t.events.toolResultsFor('figma_set_fills');
      expect(results).toHaveLength(1);
      expect(results[0].text).toContain('OK node=42:15');
    });
  });

  describe('style dedup through full pipeline', () => {
    it('shared fills produce globalVars references in output', async () => {
      const sharedColor = { type: 'SOLID', color: { r: 0.2, g: 0.4, b: 1, a: 1 }, visible: true };
      const rawTree = JSON.stringify({
        id: '0:1',
        type: 'FRAME',
        name: 'Page',
        visible: true,
        width: 800,
        height: 600,
        children: [
          { id: '1:1', type: 'FRAME', name: 'Card1', visible: true, width: 200, height: 100, fills: [sharedColor] },
          { id: '1:2', type: 'FRAME', name: 'Card2', visible: true, width: 200, height: 100, fills: [sharedColor] },
          { id: '1:3', type: 'FRAME', name: 'Card3', visible: true, width: 200, height: 100, fills: [sharedColor] },
        ],
      });

      const configManager = new CompressionConfigManager();
      configManager.setProfile('minimal'); // JSON for easy parsing

      t = await createBottegaTestSession({
        toolDeps: {
          connector: { executeCodeViaUI: vi.fn().mockResolvedValue(rawTree) } as any,
          configManager,
        },
        compressionProfile: 'minimal',
      });

      await t.run(when('Analyze', [calls('figma_get_file_data', { mode: 'full' }), says('Done.')]));

      const text = t.events.toolResultsFor('figma_get_file_data')[0].text;
      const parsed = JSON.parse(text);
      // The shared fill should be deduplicated into globalVars
      expect(parsed.globalVars).toBeDefined();
      expect(Object.keys(parsed.globalVars.styles).length).toBeGreaterThan(0);
    });

    it('unique fills are inlined (no globalVars)', async () => {
      const rawTree = JSON.stringify({
        id: '0:1',
        type: 'FRAME',
        name: 'Page',
        visible: true,
        width: 800,
        height: 600,
        fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, visible: true }],
        children: [],
      });

      const configManager = new CompressionConfigManager();
      configManager.setProfile('minimal');

      t = await createBottegaTestSession({
        toolDeps: {
          connector: { executeCodeViaUI: vi.fn().mockResolvedValue(rawTree) } as any,
          configManager,
        },
        compressionProfile: 'minimal',
      });

      await t.run(when('Get data', [calls('figma_get_file_data', { mode: 'full' }), says('Done.')]));

      const text = t.events.toolResultsFor('figma_get_file_data')[0].text;
      const parsed = JSON.parse(text);
      // Single fill → inlined, no globalVars
      expect(parsed.globalVars).toBeUndefined();
    });
  });

  describe('metrics recording with semantic extraction', () => {
    it('metrics record discovery tool calls', async () => {
      const rawTree = JSON.stringify({
        id: '0:1',
        type: 'FRAME',
        name: 'Page',
        visible: true,
        width: 800,
        height: 600,
        children: [],
      });

      t = await createBottegaTestSession({
        toolDeps: {
          connector: { executeCodeViaUI: vi.fn().mockResolvedValue(rawTree) } as any,
        },
        compressionProfile: 'balanced',
      });

      await t.run(when('Get data', [calls('figma_get_file_data'), says('Done.')]));

      const metrics = t.compressionMetrics.getSessionMetrics();
      expect(metrics.totalToolCalls).toBe(1);
      expect(metrics.toolCallsByCategory.discovery).toBe(1);
    });

    it('metrics record both discovery and mutation calls in same session', async () => {
      const rawTree = JSON.stringify({
        id: '0:1',
        type: 'FRAME',
        name: 'Page',
        visible: true,
        width: 800,
        height: 600,
        children: [],
      });

      t = await createBottegaTestSession({
        toolDeps: {
          connector: {
            executeCodeViaUI: vi.fn().mockResolvedValue(rawTree),
            setNodeFills: vi.fn().mockResolvedValue({ nodeId: '1:1', success: true, node: { id: '1:1' } }),
          } as any,
        },
        compressionProfile: 'balanced',
      });

      await t.run(
        when('Work', [
          calls('figma_get_file_data'),
          calls('figma_set_fills', { nodeId: '1:1', fills: [{ type: 'SOLID', color: '#FF0000' }] }),
          says('Done.'),
        ]),
      );

      const metrics = t.compressionMetrics.getSessionMetrics();
      expect(metrics.totalToolCalls).toBe(2);
    });

    it('compression extension preserves semantic extraction output', async () => {
      const rawTree = JSON.stringify({
        id: '0:1',
        type: 'FRAME',
        name: 'Page',
        visible: true,
        width: 800,
        height: 600,
        layoutMode: 'VERTICAL',
        children: [{ id: '1:1', type: 'TEXT', name: 'Title', visible: true, characters: 'Hello', fontSize: 16 }],
      });

      const configManager = new CompressionConfigManager();
      configManager.setProfile('minimal');

      t = await createBottegaTestSession({
        toolDeps: {
          connector: { executeCodeViaUI: vi.fn().mockResolvedValue(rawTree) } as any,
          configManager,
        },
        compressionProfile: 'minimal',
      });

      await t.run(when('Analyze', [calls('figma_get_file_data', { mode: 'full' }), says('Done.')]));

      const text = t.events.toolResultsFor('figma_get_file_data')[0].text;
      // Compression extension should not mangle discovery tool output
      const parsed = JSON.parse(text);
      expect(parsed.nodes).toBeDefined();
      expect(parsed.nodes.length).toBeGreaterThan(0);
      expect(parsed.nodes[0].name).toBe('Page');
    });
  });
});
