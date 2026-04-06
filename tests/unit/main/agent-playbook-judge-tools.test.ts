/**
 * Playbook tests for new batch/component/layout tools.
 *
 * Covers: figma_batch_rename, figma_batch_bind_variable,
 * figma_create_component, figma_set_layout_sizing, and multi-tool chains.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { type BottegaTestSession, createBottegaTestSession } from '../../helpers/bottega-test-session.js';
import { createMockConnector } from '../../helpers/mock-connector.js';
import { calls, says, when } from '../../helpers/playbook.js';

let t: BottegaTestSession | null = null;

afterEach(() => {
  t?.dispose();
  t = null;
});

// ═══════════════════════════════════════════════════════════
// 1. Batch Rename Flow
// ═══════════════════════════════════════════════════════════

describe('Batch rename flow', () => {
  it('creates elements then batch-renames them', async () => {
    const connector = createMockConnector();
    connector.createFromJsx.mockResolvedValue({ nodeId: '1:1', type: 'FRAME', children: ['1:1', '1:2', '1:3'] });
    connector.renameNode.mockResolvedValue({ success: true });
    connector.captureScreenshot.mockResolvedValue({ base64: 'iVBOR...' });

    t = await createBottegaTestSession({
      toolDeps: { connector },
    });

    await t.run(
      when('Create 3 frames and rename them semantically', [
        calls('figma_render_jsx', { jsx: '<Frame><Frame /><Frame /><Frame /></Frame>' }),
        calls('figma_batch_rename', {
          updates: [
            { nodeId: '1:1', name: 'Header' },
            { nodeId: '1:2', name: 'Body' },
            { nodeId: '1:3', name: 'Footer' },
          ],
        }),
        calls('figma_screenshot', {}),
        says('Created and renamed 3 frames'),
      ]),
    );

    // Tool sequence is correct
    expect(t.events.toolSequence()).toEqual(['figma_render_jsx', 'figma_batch_rename', 'figma_screenshot']);

    // renameNode was called 3 times (once per update)
    expect(connector.renameNode).toHaveBeenCalledTimes(3);
    expect(connector.renameNode).toHaveBeenCalledWith('1:1', 'Header');
    expect(connector.renameNode).toHaveBeenCalledWith('1:2', 'Body');
    expect(connector.renameNode).toHaveBeenCalledWith('1:3', 'Footer');

    // Batch rename result reports success
    const renameResults = t.events.toolResultsFor('figma_batch_rename');
    expect(renameResults).toHaveLength(1);
    const parsed = JSON.parse(renameResults[0].text);
    expect(parsed.succeeded).toBe(3);
    expect(parsed.failed).toBe(0);
  });

  it('batch rename reports partial failures', async () => {
    const connector = createMockConnector();
    connector.renameNode
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('Node not found'))
      .mockResolvedValueOnce({ success: true });

    t = await createBottegaTestSession({
      toolDeps: { connector },
    });

    await t.run(
      when('Rename some nodes', [
        calls('figma_batch_rename', {
          updates: [
            { nodeId: '1:1', name: 'Good' },
            { nodeId: '9:9', name: 'Missing' },
            { nodeId: '1:3', name: 'AlsoGood' },
          ],
        }),
        says('2 of 3 renamed'),
      ]),
    );

    const renameResults = t.events.toolResultsFor('figma_batch_rename');
    expect(renameResults).toHaveLength(1);
    const parsed = JSON.parse(renameResults[0].text);
    expect(parsed.succeeded).toBe(2);
    expect(parsed.failed).toBe(1);
    expect(parsed.results[1].error).toContain('Node not found');
  });
});

// ═══════════════════════════════════════════════════════════
// 2. Batch Bind Variables Flow
// ═══════════════════════════════════════════════════════════

describe('Batch bind variables flow', () => {
  it('batch-binds design tokens to nodes', async () => {
    const connector = createMockConnector();
    connector.bindVariable.mockResolvedValue({ success: true });

    t = await createBottegaTestSession({
      toolDeps: { connector },
    });

    await t.run(
      when('Bind all colors to tokens', [
        calls('figma_batch_bind_variable', {
          bindings: [
            { nodeId: '1:1', variableName: 'colors/primary', property: 'fill' },
            { nodeId: '1:2', variableName: 'colors/secondary', property: 'fill' },
          ],
        }),
        says('Bound 2 variables to design tokens'),
      ]),
    );

    expect(t.events.toolSequence()).toEqual(['figma_batch_bind_variable']);
    expect(connector.bindVariable).toHaveBeenCalledTimes(2);
    expect(connector.bindVariable).toHaveBeenCalledWith('1:1', 'colors/primary', 'fill');
    expect(connector.bindVariable).toHaveBeenCalledWith('1:2', 'colors/secondary', 'fill');

    const bindResults = t.events.toolResultsFor('figma_batch_bind_variable');
    expect(bindResults).toHaveLength(1);
    const parsed = JSON.parse(bindResults[0].text);
    expect(parsed.succeeded).toBe(2);
    expect(parsed.failed).toBe(0);
  });

  it('batch bind reports partial failures', async () => {
    const connector = createMockConnector();
    connector.bindVariable
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('Variable not found'));

    t = await createBottegaTestSession({
      toolDeps: { connector },
    });

    await t.run(
      when('Bind tokens', [
        calls('figma_batch_bind_variable', {
          bindings: [
            { nodeId: '1:1', variableName: 'colors/primary', property: 'fill' },
            { nodeId: '1:2', variableName: 'colors/missing', property: 'stroke' },
          ],
        }),
        says('1 bound, 1 failed'),
      ]),
    );

    const bindResults = t.events.toolResultsFor('figma_batch_bind_variable');
    const parsed = JSON.parse(bindResults[0].text);
    expect(parsed.succeeded).toBe(1);
    expect(parsed.failed).toBe(1);
    expect(parsed.results[1].error).toContain('Variable not found');
  });
});

// ═══════════════════════════════════════════════════════════
// 3. Create Component Flow
// ═══════════════════════════════════════════════════════════

describe('Create component flow', () => {
  it('converts a frame to a component', async () => {
    const connector = createMockConnector();
    connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({ success: true, componentId: 'comp:1', name: 'Button/Primary', converted: true }),
    );
    connector.captureScreenshot.mockResolvedValue({ base64: 'iVBOR...' });

    t = await createBottegaTestSession({
      toolDeps: { connector },
    });

    await t.run(
      when('Convert this frame to a reusable component', [
        calls('figma_create_component', { name: 'Button/Primary', fromFrameId: '1:10' }),
        calls('figma_screenshot', {}),
        says('Converted frame to component'),
      ]),
    );

    expect(t.events.toolSequence()).toEqual(['figma_create_component', 'figma_screenshot']);

    // executeCodeViaUI was called with code referencing the frame ID
    expect(connector.executeCodeViaUI).toHaveBeenCalledTimes(1);
    const codeArg = connector.executeCodeViaUI.mock.calls[0][0] as string;
    expect(codeArg).toContain('1:10');

    // Result includes component data
    const results = t.events.toolResultsFor('figma_create_component');
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain('comp:1');
    expect(results[0].text).toContain('Button/Primary');
  });

  it('creates a component from scratch', async () => {
    const connector = createMockConnector();
    connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({ success: true, componentId: 'comp:2', name: 'Card/Default', converted: false }),
    );

    t = await createBottegaTestSession({
      toolDeps: { connector },
    });

    await t.run(
      when('Create a new empty component', [
        calls('figma_create_component', { name: 'Card/Default', width: 320, height: 200 }),
        says('Component created'),
      ]),
    );

    expect(t.events.toolSequence()).toEqual(['figma_create_component']);
    const results = t.events.toolResultsFor('figma_create_component');
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain('comp:2');
  });
});

// ═══════════════════════════════════════════════════════════
// 4. Layout Sizing Flow
// ═══════════════════════════════════════════════════════════

describe('Layout sizing flow', () => {
  it('sets layout sizing on a child node', async () => {
    const connector = createMockConnector();
    connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({
        success: true,
        nodeId: '1:5',
        layoutSizingHorizontal: 'FILL',
        layoutSizingVertical: 'HUG',
      }),
    );
    connector.captureScreenshot.mockResolvedValue({ base64: 'iVBOR...' });

    t = await createBottegaTestSession({
      toolDeps: { connector },
    });

    await t.run(
      when('Make all children fill the container width', [
        calls('figma_set_layout_sizing', { nodeId: '1:5', horizontal: 'FILL', vertical: 'HUG' }),
        calls('figma_screenshot', {}),
        says('Set layout sizing to FILL horizontal'),
      ]),
    );

    expect(t.events.toolSequence()).toEqual(['figma_set_layout_sizing', 'figma_screenshot']);

    // executeCodeViaUI was called with code setting layout sizing
    expect(connector.executeCodeViaUI).toHaveBeenCalledTimes(1);
    const codeArg = connector.executeCodeViaUI.mock.calls[0][0] as string;
    expect(codeArg).toContain('layoutSizingHorizontal');
    expect(codeArg).toContain('FILL');

    // Result contains sizing info
    const results = t.events.toolResultsFor('figma_set_layout_sizing');
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain('FILL');
    expect(results[0].text).toContain('HUG');
  });

  it('rejects when neither horizontal nor vertical is provided', async () => {
    const connector = createMockConnector();

    t = await createBottegaTestSession({
      toolDeps: { connector },
      propagateErrors: false,
    });

    await t.run(
      when('Set sizing without params', [
        calls('figma_set_layout_sizing', { nodeId: '1:5' }),
        says('Missing sizing param'),
      ]),
    );

    // executeCodeViaUI should NOT be called — validation fails first
    expect(connector.executeCodeViaUI).not.toHaveBeenCalled();

    // The tool result should report an error about missing params
    const results = t.events.toolResultsFor('figma_set_layout_sizing');
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain('horizontal');
  });
});

// ═══════════════════════════════════════════════════════════
// 5. Multi-Tool Chain with New Tools
// ═══════════════════════════════════════════════════════════

describe('Multi-tool chain with new tools', () => {
  it('create → rename → bind tokens → layout sizing → screenshot', async () => {
    const connector = createMockConnector();
    connector.createFromJsx.mockResolvedValue({ nodeId: '1:1', type: 'FRAME' });
    connector.renameNode.mockResolvedValue({ success: true });
    connector.bindVariable.mockResolvedValue({ success: true });
    connector.executeCodeViaUI.mockResolvedValue(
      JSON.stringify({ success: true, nodeId: '1:1', layoutSizingHorizontal: 'FILL' }),
    );
    connector.captureScreenshot.mockResolvedValue({ base64: 'iVBOR...' });

    t = await createBottegaTestSession({
      toolDeps: { connector },
    });

    await t.run(
      when('Create a tokenized card', [
        calls('figma_render_jsx', { jsx: '<Frame name="Card"><Text>Hello</Text></Frame>' }),
        says('Card created'),
      ]),
      when('Now rename and tokenize it', [
        calls('figma_batch_rename', {
          updates: [
            { nodeId: '1:1', name: 'Card/Container' },
            { nodeId: '1:2', name: 'Card/Title' },
          ],
        }),
        calls('figma_batch_bind_variable', {
          bindings: [
            { nodeId: '1:1', variableName: 'colors/surface', property: 'fill' },
            { nodeId: '1:2', variableName: 'colors/on-surface', property: 'fill' },
          ],
        }),
        calls('figma_set_layout_sizing', { nodeId: '1:1', horizontal: 'FILL' }),
        calls('figma_screenshot', {}),
        says('Card renamed and tokenized'),
      ]),
    );

    // Full tool sequence across both turns
    const sequence = t.events.toolSequence();
    expect(sequence).toEqual([
      'figma_render_jsx',
      'figma_batch_rename',
      'figma_batch_bind_variable',
      'figma_set_layout_sizing',
      'figma_screenshot',
    ]);

    // All 5 tools were called
    expect(t.events.toolCalls).toHaveLength(5);

    // Verify the new tools were exercised against the connector
    expect(connector.createFromJsx).toHaveBeenCalledTimes(1);
    expect(connector.renameNode).toHaveBeenCalledTimes(2);
    expect(connector.bindVariable).toHaveBeenCalledTimes(2);
    expect(connector.executeCodeViaUI).toHaveBeenCalledTimes(1); // layout sizing
    expect(connector.captureScreenshot).toHaveBeenCalledTimes(1);

    // Playbook fully consumed
    expect(t.playbook.remaining).toBe(0);
  });

  it('chains result from render_jsx into batch_rename via .chain() callback', async () => {
    let renderedNodeId = '';

    const connector = createMockConnector();
    connector.createFromJsx.mockResolvedValue({ nodeId: '5:1', type: 'FRAME' });
    connector.renameNode.mockResolvedValue({ success: true });

    t = await createBottegaTestSession({
      toolDeps: { connector },
    });

    await t.run(
      when('Create and rename', [
        calls('figma_render_jsx', { jsx: '<Frame />' }).chain((result) => {
          const parsed = JSON.parse(result.text);
          renderedNodeId = parsed.nodeId;
        }),
        calls('figma_batch_rename', () => ({
          updates: [{ nodeId: renderedNodeId, name: 'Renamed' }],
        })),
        says('Done'),
      ]),
    );

    // Late-bound param captured the nodeId from the first tool
    expect(renderedNodeId).toBe('5:1');
    expect(connector.renameNode).toHaveBeenCalledWith('5:1', 'Renamed');
  });
});

// ═══════════════════════════════════════════════════════════
// 6. Compression Interaction with New Tools
// ═══════════════════════════════════════════════════════════

describe('Compression with new tools', () => {
  it('batch_rename result goes through compression extension', async () => {
    const connector = createMockConnector();
    connector.renameNode.mockResolvedValue({ success: true });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'balanced',
    });

    await t.run(
      when('Rename nodes', [
        calls('figma_batch_rename', {
          updates: [{ nodeId: '1:1', name: 'Test' }],
        }),
        says('Renamed'),
      ]),
    );

    // Compression metrics should have recorded the tool call
    const metrics = t.compressionMetrics.getSessionMetrics();
    expect(metrics.totalToolCalls).toBe(1);
  });
});
