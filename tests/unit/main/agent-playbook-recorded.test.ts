/**
 * Playbook tests derived from QA recording data.
 *
 * Covers 4 scenarios observed in real QA sessions:
 * 1. Image fill fallback chain: figma_set_image_fill timeout → figma_generate_image fallback
 * 2. Invalid JSX error recovery: figma_render_jsx with <InvalidTag> → graceful error
 * 3. Batch operations pipeline: figma_render_jsx → figma_batch_set_fills
 * 4. Image fill WS timeout (60 s) behavior — error surface + continuation
 *
 * Recording data source: /tmp/bottega-qa/recordings/
 *   - tool-sequences.json   (2 real QA sessions)
 *   - error-scenarios.json  (5 real error cases)
 *   - timing-baselines.json (p50/p90/p99 per tool)
 *
 * NOTE on isError semantics: When a ToolDefinition's execute() resolves with
 * { isError: true } in the returned value (as the Bottega tool wrapper does
 * when propagateErrors: false catches a thrown error at tests/helpers/bottega-test-session.ts
 * lines 308-328), the event collector propagates isError=true to the result record.
 * When execute() resolves with error text only in content (e.g. a mock returning
 * an error string without setting isError), the result records isError=false.
 * In this file we check result.text for error content AND result.isError where
 * appropriate to the specific scenario being tested.
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
// 1. Image Fill Fallback Chain
//    Recorded: tool-sequences.json sequence 1 — SET_IMAGE_FILL
//    times out after 60 s, agent falls back to figma_generate_image.
// ═══════════════════════════════════════════════════════════

// UX-011 NOTE: Previously these tests passed `imageUrl` and relied on
// connector.setImageFill rejecting with the 60 s WS timeout error. That code
// path no longer exists — the tool now fetches the URL host-side in
// manipulation.ts and only passes bytes to the connector. To preserve the
// fallback-chain intent of these recorded tests (connector failure → agent
// falls back to generate_image), we now drive the same failure by passing
// `base64` directly. The connector rejection is still the thing being tested.
describe('Image fill fallback chain (recorded from QA)', () => {
  it('set_image_fill timeout error text is surfaced in tool result', async () => {
    const connector = createMockConnector();
    // Simulate the exact 60 s WebSocket timeout error observed in QA
    connector.setImageFill.mockRejectedValue(new Error('WebSocket command SET_IMAGE_FILL timed out after 60000ms'));

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('Apply image fill to node 136:497', [
        calls('figma_set_image_fill', {
          nodeIds: ['136:497'],
          base64: 'ZmFrZS1iYXNlNjQ=',
        }),
        says('The image fill timed out. I will use image generation instead.'),
      ]),
    );

    const results = t.events.toolResultsFor('figma_set_image_fill');
    expect(results).toHaveLength(1);
    // Error text is surfaced in the result content (propagateErrors:false catches and returns)
    expect(results[0].text).toContain('SET_IMAGE_FILL timed out after 60000ms');
    // connector.setImageFill was called (it threw — tool was reached)
    expect(connector.setImageFill).toHaveBeenCalledWith(['136:497'], 'ZmFrZS1iYXNlNjQ=', 'FILL');
  });

  it('agent falls back to generate_image after set_image_fill timeout', async () => {
    const connector = createMockConnector();
    connector.setImageFill.mockRejectedValue(new Error('WebSocket command SET_IMAGE_FILL timed out after 60000ms'));
    connector.captureScreenshot.mockResolvedValue({
      success: true,
      image: { base64: 'iVBORw0KGgoAAAANS', format: 'PNG', scale: 1 },
    });

    // NOTE on coverage: figma_generate_image is fully mocked via mockTools.
    // This test verifies the fallback SEQUENCE (set_image_fill fails →
    // generate_image is called → screenshot confirms), but NOT the internal
    // execution of generate_image itself (Gemini API, prompt building,
    // operationQueue wrapping). Real tool execution of figma_generate_image
    // is covered in agent-playbook-extended.test.ts.
    //
    // getImageGenerator MUST be provided (even with an empty stub) because
    // tools/index.ts:124 only registers image-gen tools when deps.getImageGenerator
    // is defined. Without it, figma_generate_image would not exist in the tool
    // list and mockTools would have nothing to bind to. The stub's methods are
    // never invoked because mockTools short-circuits the real tool execution.
    t = await createBottegaTestSession({
      toolDeps: {
        connector,
        getImageGenerator: () => ({}) as any,
      },
      mockTools: {
        figma_generate_image:
          '{"success": true, "count": 1, "appliedToNodes": ["136:497"], "hint": "Image applied to nodes. Use figma_screenshot to verify."}',
      },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('Apply image fill to hero node', [
        calls('figma_set_image_fill', {
          nodeIds: ['136:497'],
          base64: 'ZmFrZS1iYXNlNjQ=',
        }),
        says('Image fill timed out. Falling back to AI image generation.'),
      ]),
      when('Generate an image instead', [
        calls('figma_generate_image', {
          prompt: 'Simple placeholder image with a mountain landscape, blue sky, green hills, minimal style',
          nodeIds: ['136:497'],
          styles: ['minimalist'],
        }),
        calls('figma_screenshot', { nodeId: '136:497' }),
        says('Image generated and applied via fallback.'),
      ]),
    );

    // set_image_fill failed (error text in result)
    const fillResults = t.events.toolResultsFor('figma_set_image_fill');
    expect(fillResults).toHaveLength(1);
    expect(fillResults[0].text).toContain('SET_IMAGE_FILL timed out after 60000ms');

    // generate_image succeeded as fallback
    const genResults = t.events.toolResultsFor('figma_generate_image');
    expect(genResults).toHaveLength(1);
    expect(genResults[0].isError).toBe(false);
    expect(genResults[0].text).toContain('appliedToNodes');

    // Screenshot taken to verify
    const screenshotResults = t.events.toolResultsFor('figma_screenshot');
    expect(screenshotResults).toHaveLength(1);

    // Verify full tool sequence matches QA recording
    expect(t.events.toolSequence()).toEqual(['figma_set_image_fill', 'figma_generate_image', 'figma_screenshot']);
  });

  it('multi-turn fallback: .chain() captures timeout error text', async () => {
    let capturedFallbackResult = '';

    const connector = createMockConnector();
    connector.setImageFill.mockRejectedValue(new Error('WebSocket command SET_IMAGE_FILL timed out after 60000ms'));

    // NOTE: figma_generate_image mocked via mockTools (see first test in this
    // describe block for full rationale on the empty getImageGenerator stub).
    t = await createBottegaTestSession({
      toolDeps: {
        connector,
        getImageGenerator: () => ({}) as any,
      },
      mockTools: {
        figma_generate_image: '{"success": true, "count": 1, "appliedToNodes": ["136:497"], "hint": "Image applied."}',
      },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('Try image fill', [
        calls('figma_set_image_fill', {
          nodeIds: ['136:497'],
          base64: 'ZmFrZS1iYXNlNjQ=',
        }).chain((result) => {
          capturedFallbackResult = result.text;
        }),
        says('Image fill failed.'),
      ]),
      when('Fallback to generate_image', [
        calls('figma_generate_image', {
          prompt: 'Mountain landscape',
          nodeIds: ['136:497'],
          styles: ['minimalist'],
        }),
        says('Fallback complete.'),
      ]),
    );

    // .chain() callback received the timeout error text
    expect(capturedFallbackResult).toContain('SET_IMAGE_FILL timed out');

    // generate_image ran successfully as fallback
    const genResults = t.events.toolResultsFor('figma_generate_image');
    expect(genResults).toHaveLength(1);
    expect(genResults[0].text).toContain('appliedToNodes');
    expect(genResults[0].isError).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// 2. Invalid JSX Error Recovery
//    Recorded: error-scenarios.json — "InvalidTag is not defined"
//    from figma_render_jsx with <Frame><InvalidTag>test</InvalidTag></Frame>
// ═══════════════════════════════════════════════════════════

describe('Invalid JSX error recovery (recorded from QA)', () => {
  it('render_jsx with unknown tag produces error text result, not crash', async () => {
    const connector = createMockConnector();
    // The JSX parser in jsx-parser.ts uses a vm sandbox; unknown tags throw ReferenceError
    // We let the real tool run — the parser should reject the invalid tag gracefully.
    // createFromJsx should NOT be called when parsing fails.
    connector.createFromJsx.mockResolvedValue({ nodeId: '99:1', childIds: [] });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('Render invalid JSX', [
        calls('figma_render_jsx', {
          jsx: '<Frame><InvalidTag>test</InvalidTag></Frame>',
        }),
        says('The JSX contained an invalid tag. Let me fix it.'),
      ]),
    );

    const results = t.events.toolResultsFor('figma_render_jsx');
    expect(results).toHaveLength(1);
    // The real parser throws "InvalidTag is not defined" — error surfaced in text
    expect(results[0].text).toMatch(/InvalidTag|not defined|unknown tag/i);

    // createFromJsx must NOT have been called when parsing fails
    expect(connector.createFromJsx).not.toHaveBeenCalled();
  });

  it('render_jsx error does not abort the subsequent screenshot', async () => {
    const connector = createMockConnector();
    connector.captureScreenshot.mockResolvedValue({
      success: true,
      image: { base64: 'recovery-screenshot', format: 'PNG', scale: 1 },
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('Try bad JSX then screenshot for recovery', [
        calls('figma_render_jsx', {
          jsx: '<Frame><InvalidTag>content</InvalidTag></Frame>',
        }),
        calls('figma_screenshot'),
        says('Took screenshot after the JSX error to verify canvas state.'),
      ]),
    );

    // render_jsx produced an error result
    const jsxResults = t.events.toolResultsFor('figma_render_jsx');
    expect(jsxResults).toHaveLength(1);
    expect(jsxResults[0].text).toMatch(/InvalidTag|not defined/i);

    // screenshot still executed successfully
    const screenshotResults = t.events.toolResultsFor('figma_screenshot');
    expect(screenshotResults).toHaveLength(1);
    expect(screenshotResults[0].isError).toBe(false);

    // Sequence: bad JSX → screenshot
    expect(t.events.toolSequence()).toEqual(['figma_render_jsx', 'figma_screenshot']);
  });

  it('render_jsx with valid JSX after invalid one succeeds', async () => {
    const connector = createMockConnector();
    connector.createFromJsx.mockResolvedValue({ nodeId: '55:1', childIds: ['55:2'] });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('Bad JSX attempt', [
        calls('figma_render_jsx', {
          jsx: '<Frame><InvalidTag>test</InvalidTag></Frame>',
        }),
        says('Bad tag — will retry with valid JSX.'),
      ]),
      when('Corrected JSX', [
        calls('figma_render_jsx', {
          jsx: '<Frame flex="col" p={16} bg="#FFFFFF"><Text>Hello</Text></Frame>',
        }),
        says('Valid JSX rendered successfully.'),
      ]),
    );

    const allJsxResults = t.events.toolResultsFor('figma_render_jsx');
    expect(allJsxResults).toHaveLength(2);

    // First call: error (invalid tag)
    expect(allJsxResults[0].text).toMatch(/InvalidTag|not defined/i);

    // Second call: success (valid JSX — contains the node ID)
    expect(allJsxResults[1].isError).toBe(false);
    expect(allJsxResults[1].text).toContain('55:1');

    // createFromJsx called exactly once (only for the valid JSX)
    expect(connector.createFromJsx).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════
// 3. Batch Operations Pipeline
//    Recorded: tool-sequences.json sequence 2 — figma_render_jsx
//    followed by figma_batch_set_fills on the created child nodes.
// ═══════════════════════════════════════════════════════════

describe('render_jsx → batch_set_fills pipeline (recorded from QA)', () => {
  it('render_jsx creates nodes then batch_set_fills colors them', async () => {
    let createdParentId = '';
    let createdChildIds: string[] = [];

    const connector = createMockConnector();
    connector.createFromJsx.mockResolvedValue({
      nodeId: '138:712',
      childIds: ['138:713', '138:714', '138:715', '138:716'],
    });
    connector.batchSetFills.mockResolvedValue({
      updated: 4,
      total: 4,
      results: [
        { nodeId: '138:713', success: true },
        { nodeId: '138:714', success: true },
        { nodeId: '138:715', success: true },
        { nodeId: '138:716', success: true },
      ],
    });
    connector.captureScreenshot.mockResolvedValue({
      success: true,
      image: { base64: 'batch-result-screenshot', format: 'PNG', scale: 1 },
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'balanced',
    });

    await t.run(
      when('Create 4-column color grid', [
        calls('figma_render_jsx', {
          jsx: '<Frame flex="row" gap={8} p={24}><Frame w={100} h={100} /><Frame w={100} h={100} /><Frame w={100} h={100} /><Frame w={100} h={100} /></Frame>',
        }).chain((result) => {
          const parsed = JSON.parse(result.text);
          createdParentId = parsed.nodeId;
          createdChildIds = parsed.childIds;
        }),
        calls('figma_batch_set_fills', () => ({
          updates: [
            { nodeId: createdChildIds[0], fills: [{ type: 'SOLID', color: '#FF0000' }] },
            { nodeId: createdChildIds[1], fills: [{ type: 'SOLID', color: '#00FF00' }] },
            { nodeId: createdChildIds[2], fills: [{ type: 'SOLID', color: '#0000FF' }] },
            { nodeId: createdChildIds[3], fills: [{ type: 'SOLID', color: '#FFFF00' }] },
          ],
        })),
        calls('figma_screenshot', () => ({ nodeId: createdParentId })),
        says('Color grid created and colored.'),
      ]),
    );

    // Node IDs captured correctly via .chain()
    expect(createdParentId).toBe('138:712');
    expect(createdChildIds).toEqual(['138:713', '138:714', '138:715', '138:716']);

    // batch_set_fills received the resolved node IDs
    expect(connector.batchSetFills).toHaveBeenCalledWith([
      { nodeId: '138:713', fills: [{ type: 'SOLID', color: '#FF0000' }] },
      { nodeId: '138:714', fills: [{ type: 'SOLID', color: '#00FF00' }] },
      { nodeId: '138:715', fills: [{ type: 'SOLID', color: '#0000FF' }] },
      { nodeId: '138:716', fills: [{ type: 'SOLID', color: '#FFFF00' }] },
    ]);

    // Screenshot was taken on the parent node
    expect(connector.captureScreenshot).toHaveBeenCalledWith('138:712', expect.anything());

    // Compression: batch result compressed to OK batch=4/4
    const batchResults = t.events.toolResultsFor('figma_batch_set_fills');
    expect(batchResults).toHaveLength(1);
    expect(batchResults[0].text).toBe('OK batch=4/4');

    // Full sequence matches QA recording pattern
    expect(t.events.toolSequence()).toEqual(['figma_render_jsx', 'figma_batch_set_fills', 'figma_screenshot']);
  });

  it('batch_set_fills with 4 real node IDs from QA recording compresses correctly', async () => {
    const connector = createMockConnector();
    // Real QA node IDs from tool-sequences.json
    connector.batchSetFills.mockResolvedValue({
      updated: 4,
      total: 4,
      results: [
        { nodeId: '138:713', success: true },
        { nodeId: '138:714', success: true },
        { nodeId: '138:715', success: true },
        { nodeId: '138:716', success: true },
      ],
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'balanced',
    });

    await t.run(
      when('Apply 4 colors from QA recording', [
        calls('figma_batch_set_fills', {
          updates: [
            { nodeId: '138:713', fills: [{ type: 'SOLID', color: '#FF0000' }] },
            { nodeId: '138:714', fills: [{ type: 'SOLID', color: '#00FF00' }] },
            { nodeId: '138:715', fills: [{ type: 'SOLID', color: '#0000FF' }] },
            { nodeId: '138:716', fills: [{ type: 'SOLID', color: '#FFFF00' }] },
          ],
        }),
        says('All 4 nodes colored.'),
      ]),
    );

    const results = t.events.toolResultsFor('figma_batch_set_fills');
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('OK batch=4/4');

    // Verify the connector received the exact QA-recorded node IDs —
    // without this assertion, the test would pass even if the runtime
    // stripped or reordered the updates array.
    expect(connector.batchSetFills).toHaveBeenCalledTimes(1);
    expect(connector.batchSetFills).toHaveBeenCalledWith([
      { nodeId: '138:713', fills: [{ type: 'SOLID', color: '#FF0000' }] },
      { nodeId: '138:714', fills: [{ type: 'SOLID', color: '#00FF00' }] },
      { nodeId: '138:715', fills: [{ type: 'SOLID', color: '#0000FF' }] },
      { nodeId: '138:716', fills: [{ type: 'SOLID', color: '#FFFF00' }] },
    ]);

    const metrics = t.compressionMetrics.getSessionMetrics();
    expect(metrics.totalToolCalls).toBe(1);
  });

  it('multi-turn: render_jsx → search_components → batch_set_fills (second QA session pattern)', async () => {
    // This test exercises the late-binding pattern: render_jsx creates child
    // nodes, and a later turn applies fills to the IDs returned by that call.
    // Unlike the hardcoded version, this validates that .chain() + late-bound
    // params correctly propagate dynamic IDs across multi-turn conversations.
    let renderedChildIds: string[] = [];

    const connector = createMockConnector();
    connector.createFromJsx.mockResolvedValue({
      nodeId: '138:712',
      childIds: ['138:713', '138:714'],
    });
    connector.batchSetFills.mockResolvedValue({ updated: 2, total: 2, results: [] });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      mockTools: {
        figma_search_components: '[{"key": "card-v1", "name": "Card/Default"}]',
        figma_get_file_data: '{"document": {"id": "0:1", "name": "Test File", "children": []}}',
      },
      compressionProfile: 'minimal',
    });

    await t.run(
      when('Get file structure', [calls('figma_get_file_data', { mode: 'full' }), says('File has the main canvas.')]),
      when('Create layout', [
        calls('figma_render_jsx', {
          jsx: '<Frame flex="row" gap={8}><Frame w={200} h={120} /><Frame w={200} h={120} /></Frame>',
        }).chain((result) => {
          const parsed = JSON.parse(result.text);
          renderedChildIds = parsed.childIds;
        }),
        says('Layout rendered.'),
      ]),
      when('Color the cards', [
        calls('figma_batch_set_fills', () => ({
          updates: [
            { nodeId: renderedChildIds[0], fills: [{ type: 'SOLID', color: '#FF0000' }] },
            { nodeId: renderedChildIds[1], fills: [{ type: 'SOLID', color: '#00FF00' }] },
          ],
        })),
        calls('figma_search_components', { query: '*' }),
        says('Cards colored and components found.'),
      ]),
    );

    // Node IDs were dynamically resolved from render_jsx result, not hardcoded
    expect(renderedChildIds).toEqual(['138:713', '138:714']);

    // batch_set_fills received the dynamically-resolved IDs
    expect(connector.batchSetFills).toHaveBeenCalledWith([
      { nodeId: '138:713', fills: [{ type: 'SOLID', color: '#FF0000' }] },
      { nodeId: '138:714', fills: [{ type: 'SOLID', color: '#00FF00' }] },
    ]);

    expect(t.events.toolSequence()).toEqual([
      'figma_get_file_data',
      'figma_render_jsx',
      'figma_batch_set_fills',
      'figma_search_components',
    ]);
    expect(t.playbook.consumed).toBe(7); // 4 calls + 3 says
  });
});

// ═══════════════════════════════════════════════════════════
// 4. Image Fill WS Timeout (60 s) Behavior
//    Recorded: error-scenarios.json — 4 occurrences across 2 sessions.
//    Timing-baselines: figma_set_image_fill p50=60009ms, all 4 timed out.
// ═══════════════════════════════════════════════════════════

describe('figma_set_image_fill WS timeout behavior (recorded from QA)', () => {
  it('timeout error message matches exact QA-recorded error string', async () => {
    const connector = createMockConnector();
    connector.setImageFill.mockRejectedValue(new Error('WebSocket command SET_IMAGE_FILL timed out after 60000ms'));

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('Set image fill that will time out', [
        calls('figma_set_image_fill', {
          nodeIds: ['136:497'],
          base64: 'ZmFrZS1iYXNlNjQ=',
        }),
        says('Set image fill timed out.'),
      ]),
    );

    const results = t.events.toolResultsFor('figma_set_image_fill');
    expect(results).toHaveLength(1);
    // Exact error string from QA error-scenarios.json
    expect(results[0].text).toContain('WebSocket command SET_IMAGE_FILL timed out after 60000ms');
  });

  it('two consecutive set_image_fill timeouts both recorded (two sessions in QA)', async () => {
    const connector = createMockConnector();
    connector.setImageFill.mockRejectedValue(new Error('WebSocket command SET_IMAGE_FILL timed out after 60000ms'));

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('First image fill attempt', [
        calls('figma_set_image_fill', { nodeIds: ['136:497'], base64: 'Zmlyc3Q=' }),
        says('First attempt timed out.'),
      ]),
      when('Second image fill attempt', [
        calls('figma_set_image_fill', { nodeIds: ['136:497'], base64: 'c2Vjb25k' }),
        says('Second attempt also timed out.'),
      ]),
    );

    const results = t.events.toolResultsFor('figma_set_image_fill');
    // Both timeouts captured
    expect(results).toHaveLength(2);
    expect(results[0].text).toContain('SET_IMAGE_FILL timed out after 60000ms');
    expect(results[1].text).toContain('SET_IMAGE_FILL timed out after 60000ms');
    // Both were actually called
    expect(connector.setImageFill).toHaveBeenCalledTimes(2);
  });

  it('set_image_fill timeout does NOT block subsequent mutation tools', async () => {
    const executionOrder: string[] = [];

    const connector = createMockConnector();
    connector.setImageFill.mockRejectedValue(new Error('WebSocket command SET_IMAGE_FILL timed out after 60000ms'));
    connector.setNodeFills.mockImplementation(async (nodeId: string) => {
      executionOrder.push(`set_fills:${nodeId}`);
      return { nodeId, success: true };
    });
    connector.captureScreenshot.mockImplementation(async () => {
      executionOrder.push('screenshot');
      return { success: true, image: { base64: 'ok', format: 'PNG', scale: 1 } };
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('Try image fill, then continue with solid fill and screenshot', [
        calls('figma_set_image_fill', { nodeIds: ['136:497'], base64: 'ZmFrZS1iYXNlNjQ=' }),
        calls('figma_set_fills', { nodeId: '136:497', fills: [{ type: 'SOLID', color: '#CCCCCC' }] }),
        calls('figma_screenshot', { nodeId: '136:497' }),
        says('Image fill failed but I applied a solid fill instead.'),
      ]),
    );

    // set_image_fill timed out — error in result text
    const imageFillResults = t.events.toolResultsFor('figma_set_image_fill');
    expect(imageFillResults[0].text).toContain('SET_IMAGE_FILL timed out after 60000ms');

    // Subsequent tools still executed in order
    expect(executionOrder).toEqual(['set_fills:136:497', 'screenshot']);

    // All 3 tools in sequence
    expect(t.events.toolSequence()).toEqual(['figma_set_image_fill', 'figma_set_fills', 'figma_screenshot']);
  });

  it('OperationQueue not deadlocked after set_image_fill error', async () => {
    // Regression: if OperationQueue wraps the erroring tool, a rejection must
    // release the lock so subsequent queue.execute() calls proceed normally.
    const executionLog: string[] = [];

    const connector = createMockConnector();
    connector.setImageFill.mockRejectedValue(new Error('WebSocket command SET_IMAGE_FILL timed out after 60000ms'));
    connector.setNodeFills.mockImplementation(async (nodeId: string) => {
      executionLog.push(`fills-${nodeId}`);
      return { nodeId, success: true };
    });
    connector.setTextContent.mockImplementation(async (nodeId: string) => {
      executionLog.push(`text-${nodeId}`);
      return { nodeId, success: true };
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('Queue should survive a timeout error', [
        calls('figma_set_image_fill', { nodeIds: ['1:1'], base64: 'ZmFrZS1iYXNlNjQ=' }),
        calls('figma_set_fills', { nodeId: '1:2', fills: [] }),
        calls('figma_set_text', { nodeId: '1:3', text: 'After timeout' }),
        says('All queued mutations ran despite the initial timeout.'),
      ]),
    );

    // The two mutations after the timeout must have executed in order
    expect(executionLog).toEqual(['fills-1:2', 'text-1:3']);

    // All 3 tool calls captured
    expect(t.events.toolCallsFor('figma_set_image_fill')).toHaveLength(1);
    expect(t.events.toolCallsFor('figma_set_fills')).toHaveLength(1);
    expect(t.events.toolCallsFor('figma_set_text')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════
// 5. Other Error Scenarios (from QA error-scenarios.json)
//    These errors are unrelated to WS timeout behavior but were captured
//    in the same QA session. Grouped separately for clarity.
// ═══════════════════════════════════════════════════════════

describe('Other error scenarios from QA recordings', () => {
  it('no_websocket_client error (from connector fixtures) surfaces correctly', async () => {
    // From error-scenarios.json: figma_screenshot when no WebSocket client connected
    const connector = createMockConnector();
    connector.captureScreenshot.mockRejectedValue(
      new Error('No WebSocket client connected. Make sure the Desktop Bridge plugin is open in Figma.'),
    );

    t = await createBottegaTestSession({
      toolDeps: { connector },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('Take screenshot when Figma not connected', [
        calls('figma_screenshot'),
        says('Figma bridge is not connected.'),
      ]),
    );

    const results = t.events.toolResultsFor('figma_screenshot');
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain('No WebSocket client connected');
    // connector was called (threw)
    expect(connector.captureScreenshot).toHaveBeenCalledTimes(1);
  });

  it('figma_get_library_components 403 error surfaces (from error-scenarios.json)', async () => {
    // From error-scenarios.json: Figma API 403 invalid token
    t = await createBottegaTestSession({
      mockTools: {
        figma_get_library_components: {
          content: [
            {
              type: 'text',
              text: 'Figma API error (403): {"status":403,"err":"Invalid token"}',
            },
          ],
          isError: true,
        },
      },
      compressionProfile: 'minimal',
      propagateErrors: false,
    });

    await t.run(
      when('Get library components with invalid token', [
        // figma_get_library_components requires fileKey param per its TypeBox schema
        calls('figma_get_library_components', { fileKey: 'test-file-key' }),
        says('The API token is invalid.'),
      ]),
    );

    const results = t.events.toolResultsFor('figma_get_library_components');
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain('403');
    expect(results[0].text).toContain('Invalid token');
  });
});
