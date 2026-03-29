/**
 * Tier 3 — Resilience Tests (requires Figma Desktop + Bridge plugin)
 *
 * Validates that the agent handles failure gracefully:
 * missing components, deleted nodes, invalid inputs, bad code,
 * invalid annotation categories.
 *
 * Uses multi-outcome assertions: agent may explain the error,
 * create a fallback, or recover — any is acceptable.
 *
 * Criticalities covered: #2, #3, #4, #6, #7, #10, #11
 *
 * Cost: ~$0.90 per run
 */

import { test, expect } from '@playwright/test';
import {
  useFigmaTierLifecycle,
  sendAndWait,
  assertAgentStable,
  assertResponseContains,
  queryFigma,
  skipIfTierFiltered,
} from '../helpers/agent-harness.mjs';

const ctx = useFigmaTierLifecycle(test, 3);

test.describe('Tier 3 — Resilience', () => {
  test.beforeEach(() => skipIfTierFiltered(test, 3));

  test('3.1 component not found', async () => {
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      "Search the design system for a component called 'XyzNonExistentWidget_99' and instantiate it.",
    );
    await assertAgentStable(ctx.win);
    // Multi-outcome: explains not found OR creates fallback OR tries alternatives
    const ok =
      /not found|doesn't exist|couldn't find|no component|no results/i.test(response) ||
      toolCalls.some((c) =>
        ['figma_create_child', 'figma_execute', 'figma_render_jsx'].includes(c.name),
      );
    expect(ok).toBeTruthy();
  });

  test('3.2 operate on deleted node', async () => {
    // Agent creates, deletes, then tries to modify — tests criticality #2
    // (stale node reference after delete within same conversation)
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      "Create a small rectangle named 'TempRect', then delete it, then try to change its fill color to red (#EF4444).",
    );
    await assertAgentStable(ctx.win);
    // Multi-outcome: explains node gone OR creates new one OR reports error
    expect(toolCalls.length).toBeGreaterThanOrEqual(2);
    const ok =
      /deleted|doesn't exist|removed|no longer|not found|cannot|created|new/i.test(response) ||
      toolCalls.some((c) => c.error);
    expect(ok).toBeTruthy();
  });

  test('3.3 invalid icon name', async () => {
    const { response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      "Create an icon using the name 'totally-fake-icon-set:nonexistent-icon-xyz'.",
    );
    await assertAgentStable(ctx.win);
    expect(response.length).toBeGreaterThan(0);
  });

  test('3.4 move in auto-layout', async () => {
    // Create auto-layout frame via oracle to set up the scenario
    await queryFigma(
      ctx.win,
      `var frame = figma.createFrame();
      frame.name = 'AutoFrame';
      frame.layoutMode = 'VERTICAL';
      frame.resize(200, 400);
      for (var i = 0; i < 3; i++) {
        var r = figma.createRectangle();
        r.name = 'Item_' + i;
        r.resize(100, 50);
        frame.appendChild(r);
      }
      return frame.id;`,
    );

    const { response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      "Move 'Item_1' inside 'AutoFrame' to absolute position x=50, y=300.",
    );
    await assertAgentStable(ctx.win);
    // Multi-outcome: explains auto-layout constraint OR adjusts layout OR moves it
    assertResponseContains(response, [
      'auto-layout',
      'auto layout',
      'autolayout',
      'moved',
      'position',
      'layout',
      'absolute',
    ]);
  });

  test('3.5 execute bad code', async () => {
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      "Use figma_execute to run this code: `const x = figma.currentPage.findAll(n => n.nonExistentMethod()); return x;`",
    );
    await assertAgentStable(ctx.win);
    // Multi-outcome: tool error reported OR agent explains runtime error
    const ok =
      /error|not a function|invalid|failed|couldn't|undefined/i.test(response) ||
      toolCalls.some((c) => c.error);
    expect(ok).toBeTruthy();
  });

  test('3.6 invalid annotation category', async () => {
    // Criticality #10: invalid categoryId should be handled gracefully
    const result = await sendAndWait(
      ctx.win,
      ctx.slotId,
      "Add an annotation to any node on the page with categoryId 'FAKE_CATEGORY_99999' and label 'Test annotation'.",
    );
    await assertAgentStable(ctx.win);
    // Multi-outcome: agent reports invalid category OR creates annotation anyway OR explains
    expect(result.response.length).toBeGreaterThan(0);
  });
});
