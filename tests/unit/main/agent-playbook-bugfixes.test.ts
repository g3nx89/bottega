/**
 * Playbook-based bug fix regression tests.
 *
 * Each test exercises a scenario from BUG-REPORT.md to prevent regressions,
 * using scripted model responses instead of real LLM calls.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { type BottegaTestSession, createBottegaTestSession } from '../../helpers/bottega-test-session.js';
import { calls, says, when } from '../../helpers/playbook.js';

let t: BottegaTestSession | null = null;

afterEach(() => {
  t?.dispose();
  t = null;
});

// ── B-008: Screenshot fallback when Figma disconnected ─────

describe('B-008 — screenshot fallback on disconnect', () => {
  it('records error when figma_screenshot fails due to disconnection', async () => {
    t = await createBottegaTestSession({
      mockTools: {
        figma_screenshot: {
          content: [{ type: 'text', text: 'Error: Not connected' }],
          isError: true,
        },
      },
    });

    await t.run(
      when('Take a screenshot of the current page', [
        calls('figma_screenshot'),
        says('Figma is not connected. Please check the bridge plugin.'),
      ]),
    );

    // Tool call was attempted
    expect(t.events.toolSequence()).toContain('figma_screenshot');
    expect(t.events.toolCallsFor('figma_screenshot')).toHaveLength(1);

    // Result recorded with error content
    const results = t.events.toolResultsFor('figma_screenshot');
    expect(results).toHaveLength(1);
    expect(results[0].text).toContain('Not connected');
  });
});

// ── B-003: Abort during tool chain ─────────────────────────

describe('B-003 — multi-step tool chain completes', () => {
  it('executes all 3 tools in a discovery-create-verify chain', async () => {
    t = await createBottegaTestSession({
      mockTools: {
        figma_get_file_data: '{"document": {"children": [{"id": "0:1", "name": "Page 1"}]}}',
        figma_create_child: '{"nodeId": "42:10", "type": "FRAME", "name": "New Frame"}',
        figma_screenshot: '{"base64": "iVBOR..."}',
      },
    });

    await t.run(
      when('Create a frame on the page and screenshot it', [
        calls('figma_get_file_data', { depth: 2 }),
        calls('figma_create_child', { parentId: '0:1', type: 'FRAME', name: 'New Frame' }),
        calls('figma_screenshot'),
        says('Frame created and verified via screenshot.'),
      ]),
    );

    // All 3 tool calls present in correct order
    expect(t.events.toolSequence()).toEqual(['figma_get_file_data', 'figma_create_child', 'figma_screenshot']);

    // Results recorded correctly (no errors)
    expect(t.events.errorResults()).toHaveLength(0);

    // Each tool has exactly one result
    expect(t.events.toolResultsFor('figma_get_file_data')).toHaveLength(1);
    expect(t.events.toolResultsFor('figma_create_child')).toHaveLength(1);
    expect(t.events.toolResultsFor('figma_screenshot')).toHaveLength(1);

    // Mutation tool tracked
    const mutations = t.events.mutationTools();
    expect(mutations.map((m) => m.toolName)).toContain('figma_create_child');
  });
});

// ── W-002: Tool call resilience after API errors ───────────

describe('W-002 — tool resilience after API error', () => {
  it('recovers in second turn after first-turn tool error', async () => {
    t = await createBottegaTestSession({
      mockTools: {
        figma_execute: (params) => {
          const code = (params as any).code ?? '';
          if (code === 'broken()') {
            return {
              content: [{ type: 'text', text: 'Error: figma.broken is not a function' }],
              isError: true,
            };
          }
          return '{"result": "success", "nodeCount": 5}';
        },
      },
    });

    await t.run(
      // Turn 1: tool fails
      when('Run some code on the canvas', [
        calls('figma_execute', { code: 'broken()' }),
        says('That failed. Let me try a different approach.'),
      ]),
      // Turn 2: retry with corrected params succeeds
      when('Try again with the correct code', [
        calls('figma_execute', { code: 'figma.currentPage.children.length' }),
        says('Success — found 5 nodes.'),
      ]),
    );

    // Both turns recorded
    expect(t.events.toolCallsFor('figma_execute')).toHaveLength(2);
    expect(t.playbook.consumed).toBe(4);

    // First call returned error content
    const results = t.events.toolResultsFor('figma_execute');
    expect(results[0].text).toContain('not a function');

    // Second call succeeded
    expect(results[1].text).toContain('success');
  });
});

// ── P-003: Compression with multi-tool turns ───────────────

describe('P-003 — compression with multi-tool turn', () => {
  it('tracks all tools and mutations under balanced compression', async () => {
    t = await createBottegaTestSession({
      compressionProfile: 'balanced',
      mockTools: {
        figma_execute: '{"result": "executed", "nodeId": "1:5"}',
        figma_set_fills: '{"success": true}',
        figma_screenshot: '{"base64": "iVBOR...screenshot..."}',
      },
    });

    await t.run(
      when('Execute code, set fills, then screenshot', [
        calls('figma_execute', { code: 'figma.createRectangle()' }),
        calls('figma_set_fills', {
          nodeId: '1:5',
          fills: [{ type: 'SOLID', color: { r: 0.6, g: 0.35, b: 1 } }],
        }),
        calls('figma_screenshot'),
        says('Rectangle created and styled.'),
      ]),
    );

    // All 3 tools called in order
    expect(t.events.toolSequence()).toEqual(['figma_execute', 'figma_set_fills', 'figma_screenshot']);

    // Mutation tools identified (execute + set_fills but NOT screenshot)
    const mutationNames = t.events.mutationTools().map((m) => m.toolName);
    expect(mutationNames).toContain('figma_execute');
    expect(mutationNames).toContain('figma_set_fills');
    expect(mutationNames).not.toContain('figma_screenshot');

    // Compression metrics collector is active
    expect(t.compressionMetrics).toBeDefined();
    expect(t.configManager.getActiveProfile()).toBe('balanced');
  });
});

// ── B-009/B-011: Multi-turn with suggestions context ───────

describe('B-009/B-011 — multi-turn with follow-up context', () => {
  it('records tool usage across two conversational turns', async () => {
    t = await createBottegaTestSession({
      mockTools: {
        figma_get_file_data: '{"document": {"children": [{"id": "0:1", "name": "Page 1"}]}}',
        figma_set_text: '{"success": true, "nodeId": "3:7"}',
        figma_screenshot: '{"base64": "iVBOR..."}',
      },
    });

    await t.run(
      // Turn 1: discovery + response
      when('What is on the canvas?', [
        calls('figma_get_file_data', { depth: 1 }),
        says('The canvas has a single page called "Page 1".'),
      ]),
      // Turn 2: follow-up with mutation + verification
      when('Change the heading text to "Welcome"', [
        calls('figma_set_text', { nodeId: '3:7', characters: 'Welcome' }),
        calls('figma_screenshot'),
        says('Updated the heading to "Welcome".'),
      ]),
    );

    // Both turns fully consumed
    expect(t.playbook.consumed).toBe(5);
    expect(t.playbook.remaining).toBe(0);

    // Tool sequence spans both turns
    expect(t.events.toolSequence()).toEqual(['figma_get_file_data', 'figma_set_text', 'figma_screenshot']);

    // Turn 1 tool is a read (not in mutations)
    const mutationNames = t.events.mutationTools().map((m) => m.toolName);
    expect(mutationNames).not.toContain('figma_get_file_data');

    // Turn 2 mutation tracked
    expect(mutationNames).toContain('figma_set_text');

    // No errors in the tool results we care about
    const fileDataResults = t.events.toolResultsFor('figma_get_file_data');
    const screenshotResults = t.events.toolResultsFor('figma_screenshot');
    expect(fileDataResults[0].isError).toBe(false);
    expect(screenshotResults[0].isError).toBe(false);

    // Messages recorded from both turns
    expect(t.events.messages.length).toBeGreaterThanOrEqual(2);
  });
});
