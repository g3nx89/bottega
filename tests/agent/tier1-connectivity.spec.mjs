/**
 * Tier 1 — Connectivity Tests (requires Figma Desktop + Bridge plugin)
 *
 * Validates that the agent can use base Figma tools:
 * status check, screenshot, selection, file structure, design system.
 *
 * Cost: ~$0.25 per run
 */

import { test, expect } from '@playwright/test';
import {
  useFigmaTierLifecycle,
  sendAndWait,
  assertToolCalled,
  assertNoToolErrors,
  assertResponseContains,
  hasScreenshotInChat,
  skipIfTierFiltered,
} from '../helpers/agent-harness.mjs';

const ctx = useFigmaTierLifecycle(test, 1);

test.describe('Tier 1 — Connectivity', () => {
  test.beforeEach(() => skipIfTierFiltered(test, 1));

  test('1.1 @smoke connection status', async () => {
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      "What's the Figma connection status?",
    );
    assertToolCalled(toolCalls, 'figma_status', 'figma_get_status');
    assertNoToolErrors(toolCalls);
    assertResponseContains(response, ['connected', 'active', 'running', 'file']);
  });

  test('1.2 screenshot capture', async () => {
    const { toolCalls } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      'Take a screenshot of the current page.',
    );
    assertToolCalled(toolCalls, 'figma_screenshot', 'figma_capture_screenshot');
    const screenshot = await hasScreenshotInChat(ctx.win);
    expect(screenshot).toBe(true);
  });

  test('1.3 selection query', async () => {
    const { toolCalls } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      "What's currently selected on the page?",
    );
    assertToolCalled(toolCalls, 'figma_get_selection');
    assertNoToolErrors(toolCalls);
  });

  test('1.4 file structure', async () => {
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      'Describe the structure of this file.',
    );
    assertToolCalled(toolCalls, 'figma_get_file_data');
    assertNoToolErrors(toolCalls);
    assertResponseContains(response, ['page', 'file']);
  });

  test('1.5 design system check', async () => {
    const { toolCalls } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      'Check if there are any design system tokens or variables defined.',
    );
    assertToolCalled(toolCalls, 'figma_design_system', 'figma_get_variables');
    assertNoToolErrors(toolCalls);
  });
});
