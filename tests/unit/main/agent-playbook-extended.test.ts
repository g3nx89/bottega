/**
 * Extended playbook-based agent tests.
 *
 * Tests 6 categories that were previously impossible or too expensive:
 * 1. Compression extension end-to-end
 * 2. Real tool execution against mocked deps
 * 3. OperationQueue serialization
 * 4. JSX render pipeline
 * 5. Error recovery mid-chain
 * 6. Realistic tool chaining patterns
 */

import { afterEach, describe, expect, it } from 'vitest';
import { type BottegaTestSession, createBottegaTestSession } from '../../helpers/bottega-test-session.js';
import { createMockConnector, createMockWsServer } from '../../helpers/mock-connector.js';
import { calls, says, when } from '../../helpers/playbook.js';

let t: BottegaTestSession | null = null;

afterEach(() => {
  t?.dispose();
  t = null;
});

// ═══════════════════════════════════════════════════════════
// 1. Compression Extension End-to-End
// ═══════════════════════════════════════════════════════════

describe('Compression extension e2e', () => {
  it('compresses mutation tool results when profile is balanced', async () => {
    // Configure mock connector to return data with nodeId (required for compression)
    const connector = createMockConnector();
    connector.setNodeFills.mockResolvedValue({ nodeId: '42:15', success: true });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'balanced',
    });

    await t.run(
      when('Set fills', [
        calls('figma_set_fills', { nodeId: '42:15', fills: [{ type: 'SOLID', color: '#FF0000' }] }),
        says('Fills applied.'),
      ]),
    );

    // Compression extension should have compressed the result
    const metrics = t.compressionMetrics.getSessionMetrics();
    expect(metrics.totalToolCalls).toBe(1);

    // The tool_result event goes through compression hook chain.
    // With nodeId present, the mutation compressor produces "OK node=42:15"
    const results = t.events.toolResultsFor('figma_set_fills');
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain('OK node=42:15');
  });

  it('does NOT compress when profile is minimal', async () => {
    const connector = createMockConnector();
    connector.setNodeFills.mockResolvedValue({ nodeId: '42:15', success: true });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
    });

    await t.run(
      when('Set fills', [
        calls('figma_set_fills', { nodeId: '42:15', fills: [{ type: 'SOLID', color: '#00FF00' }] }),
        says('Done.'),
      ]),
    );

    // Minimal profile: compressMutationResults is false
    const results = t.events.toolResultsFor('figma_set_fills');
    expect(results).toHaveLength(1);
    // Result should be the full JSON, not compressed
    expect(results[0].text).toContain('42:15');
    expect(results[0].text).not.toBe('OK node=42:15');
  });

  it('compresses multiple mutation tools in sequence', async () => {
    const connector = createMockConnector();
    connector.setNodeFills.mockResolvedValue({ nodeId: '10:1', success: true });
    connector.setNodeStrokes.mockResolvedValue({ nodeId: '10:2', success: true });
    connector.setTextContent.mockResolvedValue({ nodeId: '10:3', success: true });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'creative', // most aggressive compression
    });

    await t.run(
      when('Style three elements', [
        calls('figma_set_fills', { nodeId: '10:1', fills: [] }),
        calls('figma_set_strokes', { nodeId: '10:2', strokes: [], weight: 2 }),
        calls('figma_set_text', { nodeId: '10:3', text: 'Hello' }),
        says('All styled.'),
      ]),
    );

    const metrics = t.compressionMetrics.getSessionMetrics();
    expect(metrics.totalToolCalls).toBe(3);

    // All three should be compressed
    expect(t.events.toolResultsFor('figma_set_fills')[0].text).toBe('OK node=10:1');
    expect(t.events.toolResultsFor('figma_set_strokes')[0].text).toBe('OK node=10:2');
    expect(t.events.toolResultsFor('figma_set_text')[0].text).toBe('OK node=10:3');
  });

  it('does NOT compress non-mutation tools (discovery)', async () => {
    const connector = createMockConnector();
    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'creative',
    });

    // figma_get_file_data goes through connector.executeCodeViaUI (it's in core tools),
    // but for testing we mock it since it's a complex tool
    await t.run(when('Get file data', [calls('figma_status'), says('File info retrieved.')]));

    // figma_status is not in the mutation compressor's list
    const results = t.events.toolResultsFor('figma_status');
    expect(results).toHaveLength(1);
    // Should NOT start with "OK node="
    expect(results[0].text).not.toMatch(/^OK node=/);
  });
});

// ═══════════════════════════════════════════════════════════
// 2. Real Tool Execution Against Mocked Deps
// ═══════════════════════════════════════════════════════════

describe('Real tool execution (no mockTools)', () => {
  it('figma_set_fills executes against mock connector', async () => {
    const connector = createMockConnector();
    connector.setNodeFills.mockResolvedValue({ nodeId: '1:2', type: 'RECTANGLE' });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal', // disable compression to see raw result
    });

    await t.run(
      when('Set red fill', [
        calls('figma_set_fills', { nodeId: '1:2', fills: [{ type: 'SOLID', color: '#FF0000' }] }),
        says('Done.'),
      ]),
    );

    // Verify the actual connector method was called
    expect(connector.setNodeFills).toHaveBeenCalledWith('1:2', [{ type: 'SOLID', color: '#FF0000' }]);
    expect(t.events.toolResultsFor('figma_set_fills')[0].isError).toBe(false);
  });

  it('figma_status reads from wsServer', async () => {
    const wsServer = createMockWsServer();
    wsServer.isClientConnected.mockReturnValue(true);
    wsServer.getConnectedFileInfo.mockReturnValue({
      fileKey: 'xyz789',
      fileName: 'Design.fig',
      connectedAt: Date.now(),
    });

    t = await createBottegaTestSession({
      toolDeps: { wsServer },
      compressionProfile: 'minimal',
    });

    await t.run(when('Check connection', [calls('figma_status'), says('Connected.')]));

    const result = t.events.toolResultsFor('figma_status')[0];
    expect(result.isError).toBe(false);
    expect(result.text).toContain('xyz789');
  });

  it('figma_screenshot captures via connector', async () => {
    const connector = createMockConnector();
    connector.captureScreenshot.mockResolvedValue({
      success: true,
      image: { base64: 'iVBORw0KGgoAAAANS', format: 'PNG', scale: 1 },
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
    });

    await t.run(when('Take a screenshot', [calls('figma_screenshot', { nodeId: '1:5' }), says('Here it is.')]));

    expect(connector.captureScreenshot).toHaveBeenCalledWith('1:5', expect.objectContaining({ format: 'PNG' }));

    // Screenshot tool returns image content, not text
    const results = t.events.toolResultsFor('figma_screenshot');
    expect(results).toHaveLength(1);
    expect(results[0].isError).toBe(false);
  });

  it('figma_execute runs code via connector', async () => {
    const connector = createMockConnector();
    connector.executeCodeViaUI.mockResolvedValue({ result: 42 });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
    });

    await t.run(
      when('Run code', [
        calls('figma_execute', { code: 'figma.currentPage.children.length' }),
        says('There are 42 elements.'),
      ]),
    );

    expect(connector.executeCodeViaUI).toHaveBeenCalledWith('figma.currentPage.children.length', 30000);
  });
});

// ═══════════════════════════════════════════════════════════
// 3. OperationQueue Serialization
// ═══════════════════════════════════════════════════════════

describe('OperationQueue serialization', () => {
  it('mutation tools execute sequentially through real OperationQueue', async () => {
    const executionLog: string[] = [];
    const connector = createMockConnector();

    // Track execution order with a small delay to verify serialization
    connector.setNodeFills.mockImplementation(async (nodeId: string) => {
      executionLog.push(`fills-start-${nodeId}`);
      await new Promise((r) => setTimeout(r, 10));
      executionLog.push(`fills-end-${nodeId}`);
      return { nodeId, success: true };
    });
    connector.setNodeStrokes.mockImplementation(async (nodeId: string) => {
      executionLog.push(`strokes-start-${nodeId}`);
      await new Promise((r) => setTimeout(r, 10));
      executionLog.push(`strokes-end-${nodeId}`);
      return { nodeId, success: true };
    });
    connector.moveNode.mockImplementation(async (nodeId: string) => {
      executionLog.push(`move-start-${nodeId}`);
      await new Promise((r) => setTimeout(r, 10));
      executionLog.push(`move-end-${nodeId}`);
      return { nodeId, success: true };
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
    });

    await t.run(
      when('Style and move', [
        calls('figma_set_fills', { nodeId: 'A', fills: [] }),
        calls('figma_set_strokes', { nodeId: 'B', strokes: [] }),
        calls('figma_move', { nodeId: 'C', x: 100, y: 200 }),
        says('Done.'),
      ]),
    );

    // Operations should be fully serialized: each start-end pair before next starts
    expect(executionLog).toEqual([
      'fills-start-A',
      'fills-end-A',
      'strokes-start-B',
      'strokes-end-B',
      'move-start-C',
      'move-end-C',
    ]);
  });

  it('all mutation calls tracked by event collector', async () => {
    const connector = createMockConnector();
    connector.setNodeFills.mockResolvedValue({ nodeId: '1:1' });
    connector.setTextContent.mockResolvedValue({ nodeId: '1:2' });

    t = await createBottegaTestSession({
      toolDeps: { connector },
    });

    await t.run(
      when('Two mutations', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [] }),
        calls('figma_set_text', { nodeId: '1:2', text: 'Hi' }),
        says('Done.'),
      ]),
    );

    const mutations = t.events.mutationTools();
    expect(mutations).toHaveLength(2);
    expect(mutations.map((m) => m.toolName)).toEqual(['figma_set_fills', 'figma_set_text']);
  });
});

// ═══════════════════════════════════════════════════════════
// 4. JSX Render Pipeline
// ═══════════════════════════════════════════════════════════

describe('JSX render pipeline', () => {
  it('figma_render_jsx parses JSX and calls createFromJsx', async () => {
    const connector = createMockConnector();
    connector.createFromJsx.mockResolvedValue({
      nodeId: '99:1',
      childIds: ['99:2', '99:3'],
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
    });

    await t.run(
      when('Create a card', [
        calls('figma_render_jsx', {
          jsx: '<Frame flex="col" p={16} bg="#FFFFFF" rounded={8}><Text>Hello</Text></Frame>',
          x: 0,
          y: 0,
        }),
        says('Card created.'),
      ]),
    );

    // Verify createFromJsx was called with parsed TreeNode
    expect(connector.createFromJsx).toHaveBeenCalledTimes(1);
    const [treeNode, opts] = connector.createFromJsx.mock.calls[0];

    // TreeNode should have the parsed structure (jsx-parser lowercases tag names)
    expect(treeNode).toBeDefined();
    expect(treeNode.type.toLowerCase()).toBe('frame');
    expect(opts).toEqual(expect.objectContaining({ x: 0, y: 0 }));

    // Verify result
    const result = t.events.toolResultsFor('figma_render_jsx')[0];
    expect(result.isError).toBe(false);
    expect(result.text).toContain('99:1');
  });

  it('JSX with nested elements produces correct tree', async () => {
    const connector = createMockConnector();
    connector.createFromJsx.mockResolvedValue({ nodeId: '50:1', childIds: ['50:2', '50:3', '50:4'] });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
    });

    await t.run(
      when('Create a layout', [
        calls('figma_render_jsx', {
          jsx: `
            <Frame flex="row" gap={8} p={24}>
              <Frame w={100} h={100} bg="#FF0000" />
              <Frame w={100} h={100} bg="#00FF00" />
              <Frame w={100} h={100} bg="#0000FF" />
            </Frame>
          `,
        }),
        says('Layout created.'),
      ]),
    );

    const [treeNode] = connector.createFromJsx.mock.calls[0];
    expect(treeNode.type.toLowerCase()).toBe('frame');
    expect(treeNode.children).toHaveLength(3);
    // Each child should be a Frame (jsx-parser lowercases tag names)
    for (const child of treeNode.children) {
      expect(child.type.toLowerCase()).toBe('frame');
    }
  });

  it('compression compresses figma_render_jsx result with nodeId', async () => {
    const connector = createMockConnector();
    connector.createFromJsx.mockResolvedValue({ nodeId: '77:1', childIds: ['77:2'] });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'balanced',
    });

    await t.run(
      when('Render JSX', [
        calls('figma_render_jsx', { jsx: '<Frame bg="#FFF"><Text>Hi</Text></Frame>' }),
        says('Rendered.'),
      ]),
    );

    // Compression should produce compact form for render_jsx
    const result = t.events.toolResultsFor('figma_render_jsx')[0];
    expect(result.text).toBe('OK node=77:1 children=77:2');
  });
});

// ═══════════════════════════════════════════════════════════
// 5. Error Recovery Mid-Chain
// ═══════════════════════════════════════════════════════════

describe('Error recovery mid-chain', () => {
  it('tool error does not crash test with propagateErrors: false', async () => {
    const connector = createMockConnector();
    connector.setNodeFills.mockRejectedValue(new Error('Node not found'));
    connector.captureScreenshot.mockResolvedValue({
      success: true,
      image: { base64: 'abc123', format: 'PNG', scale: 1 },
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      propagateErrors: false,
    });

    // First tool will throw, but the agent loop should continue
    await t.run(
      when('Try to set fills then screenshot', [
        calls('figma_set_fills', { nodeId: 'bad:1', fills: [] }),
        calls('figma_screenshot'),
        says('Recovered from the error.'),
      ]),
    );

    const fillResults = t.events.toolResultsFor('figma_set_fills');
    expect(fillResults).toHaveLength(1);
    // The tool threw, so result should contain error message
    expect(fillResults[0].text).toContain('Node not found');

    // Second tool should still have executed
    expect(t.events.toolCallsFor('figma_screenshot')).toHaveLength(1);
  });

  it('.chain() callback receives error result', async () => {
    let capturedError = '';
    const connector = createMockConnector();
    connector.executeCodeViaUI.mockRejectedValue(new Error('Plugin crashed'));

    t = await createBottegaTestSession({
      toolDeps: { connector },
      propagateErrors: false,
    });

    await t.run(
      when('Execute bad code', [
        calls('figma_execute', { code: 'crash()' }).chain((result) => {
          capturedError = result.text;
        }),
        says('Handled.'),
      ]),
    );

    expect(capturedError).toContain('Plugin crashed');
  });

  it('mixed mock and real tools — mock works even when real tool fails', async () => {
    const connector = createMockConnector();
    connector.setNodeFills.mockRejectedValue(new Error('Oops'));

    t = await createBottegaTestSession({
      toolDeps: { connector },
      mockTools: {
        figma_screenshot: '{"base64": "recovered"}',
      },
      propagateErrors: false,
    });

    await t.run(
      when('Fail then recover', [
        calls('figma_set_fills', { nodeId: '1:1', fills: [] }),
        calls('figma_screenshot'),
        says('Used screenshot to verify.'),
      ]),
    );

    expect(t.events.toolResultsFor('figma_set_fills')[0].text).toContain('Oops');
    expect(t.events.toolResultsFor('figma_screenshot')[0].text).toBe('{"base64": "recovered"}');
  });
});

// ═══════════════════════════════════════════════════════════
// 6. Realistic Tool Chaining Patterns
// ═══════════════════════════════════════════════════════════

describe('Realistic tool chaining', () => {
  it('search → instantiate → set properties → screenshot', async () => {
    let componentKey = '';
    let instanceNodeId = '';

    const connector = createMockConnector();
    connector.instantiateComponent.mockResolvedValue({
      nodeId: '200:1',
      type: 'INSTANCE',
      name: 'Button',
    });
    connector.setInstanceProperties.mockResolvedValue({
      nodeId: '200:1',
      success: true,
    });
    connector.captureScreenshot.mockResolvedValue({
      success: true,
      image: { base64: 'screenshot-data', format: 'PNG', scale: 1 },
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      mockTools: {
        figma_search_components: '[{"key": "btn-primary-v2", "name": "Button/Primary"}]',
      },
      compressionProfile: 'minimal',
    });

    await t.run(
      when('Create a styled button', [
        calls('figma_search_components', { query: 'Button Primary' }).chain((result) => {
          const parsed = JSON.parse(result.text);
          componentKey = parsed[0].key;
        }),
        calls('figma_instantiate', () => ({ componentKey })).chain((result) => {
          const parsed = JSON.parse(result.text);
          instanceNodeId = parsed.nodeId;
        }),
        calls('figma_set_instance_properties', () => ({
          nodeId: instanceNodeId,
          properties: { label: 'Click Me', disabled: false },
        })),
        calls('figma_screenshot', () => ({ nodeId: instanceNodeId })),
        says('Button created and configured.'),
      ]),
    );

    // Verify the chain resolved correctly
    expect(componentKey).toBe('btn-primary-v2');
    expect(instanceNodeId).toBe('200:1');

    // Verify connector received the resolved values
    expect(connector.instantiateComponent).toHaveBeenCalledWith('btn-primary-v2', expect.anything());
    expect(connector.setInstanceProperties).toHaveBeenCalledWith('200:1', {
      label: 'Click Me',
      disabled: false,
    });
    expect(connector.captureScreenshot).toHaveBeenCalledWith('200:1', expect.anything());

    // Full sequence
    expect(t.events.toolSequence()).toEqual([
      'figma_search_components',
      'figma_instantiate',
      'figma_set_instance_properties',
      'figma_screenshot',
    ]);
  });

  it('multi-turn: analyze file → create elements → verify', async () => {
    const connector = createMockConnector();
    connector.executeCodeViaUI.mockResolvedValue({ result: 'Page 1 has 5 children' });
    connector.createFromJsx.mockResolvedValue({ nodeId: '300:1', childIds: ['300:2'] });
    connector.captureScreenshot.mockResolvedValue({
      success: true,
      image: { base64: 'final-screenshot', format: 'PNG', scale: 1 },
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
    });

    await t.run(
      when('What does the file look like?', [
        calls('figma_execute', { code: 'figma.currentPage.children.length' }),
        says('The page has 5 elements.'),
      ]),
      when('Create a header', [
        calls('figma_render_jsx', {
          jsx: '<Frame flex="row" p={16} bg="#1A1A2E"><Text fontSize={24}>Dashboard</Text></Frame>',
        }),
        says('Header created.'),
      ]),
      when('Show me the result', [calls('figma_screenshot'), says('Here is the current state.')]),
    );

    // 3 turns, 3 tool calls
    expect(t.playbook.consumed).toBe(6); // 3 calls + 3 says
    expect(t.events.toolSequence()).toEqual(['figma_execute', 'figma_render_jsx', 'figma_screenshot']);
  });

  it('create → fill → rename → screenshot with full late-binding', async () => {
    let createdNodeId = '';

    const connector = createMockConnector();
    connector.createChildNode.mockResolvedValue({ nodeId: '400:1', type: 'FRAME' });
    connector.setNodeFills.mockResolvedValue({ nodeId: '400:1', success: true });
    connector.renameNode.mockResolvedValue({ nodeId: '400:1', name: 'Hero Section' });
    connector.captureScreenshot.mockResolvedValue({
      success: true,
      image: { base64: 'img', format: 'PNG', scale: 1 },
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
    });

    await t.run(
      when('Create a hero section', [
        calls('figma_create_child', { parentId: '0:1', type: 'FRAME' }).chain((result) => {
          const parsed = JSON.parse(result.text);
          createdNodeId = parsed.nodeId;
        }),
        calls('figma_set_fills', () => ({
          nodeId: createdNodeId,
          fills: [{ type: 'SOLID', color: '#1A1A2E' }],
        })),
        calls('figma_rename', () => ({ nodeId: createdNodeId, name: 'Hero Section' })),
        calls('figma_screenshot', () => ({ nodeId: createdNodeId })),
        says('Hero section created.'),
      ]),
    );

    expect(createdNodeId).toBe('400:1');
    expect(connector.setNodeFills).toHaveBeenCalledWith('400:1', [{ type: 'SOLID', color: '#1A1A2E' }]);
    expect(connector.renameNode).toHaveBeenCalledWith('400:1', 'Hero Section');
    expect(connector.captureScreenshot).toHaveBeenCalledWith('400:1', expect.anything());
  });
});
