/**
 * Tier 4 — Chain Tests (requires Figma Desktop + Bridge plugin)
 *
 * Validates multi-step end-to-end flows where the agent must
 * chain multiple tools together to accomplish a complex task.
 *
 * Cost: ~$1.50 per run
 */

import { test, expect } from '@playwright/test';
import {
  useFigmaTierLifecycle,
  sendAndWait,
  assertToolCalled,
  assertResponseContains,
  assertFigmaNodeExists,
  getFigmaPageNodeCount,
  hasScreenshotInChat,
  skipIfTierFiltered,
  uniqueSuffix,
} from '../helpers/agent-harness.mjs';

const ctx = useFigmaTierLifecycle(test);

test.describe('Tier 4 — Chains', () => {
  test.beforeEach(() => skipIfTierFiltered(test, 4));

  test('4.1 search design system and instantiate', async () => {
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      "Search the design system for button components. If you find one, instantiate it and change its text to 'Click me'. If no button component exists, create one from scratch with that text.",
    );
    expect(toolCalls.length).toBeGreaterThan(1);
    assertResponseContains(response, ['button', 'click me', 'created', 'instantiated', 'text']);
    await assertFigmaNodeExists(ctx.win, 'Click me', {}, ctx.fileKey);
  });

  test('4.2 @smoke create, modify color, and screenshot', async () => {
    const name = `Morph_${uniqueSuffix()}`;
    const { toolCalls } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a blue (#3B82F6) rectangle named '${name}' (200x100), then change its color to green (#22C55E), then take a screenshot to confirm.`,
    );
    assertToolCalled(toolCalls, 'figma_execute', 'figma_create_child', 'figma_render_jsx');
    assertToolCalled(toolCalls, 'figma_screenshot', 'figma_capture_screenshot');
    const screenshot = await hasScreenshotInChat(ctx.win);
    expect(screenshot).toBe(true);
    await assertFigmaNodeExists(ctx.win, 'Morph_', { type: 'RECTANGLE' }, ctx.fileKey);
  });

  test('4.3 JSX render with tokens', async () => {
    const name = `TokenCard_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a card component named '${name}' using figma_render_jsx. The card should have a title, description, and an action button. After creating it, set up a color variable called 'primary' with value #7C3AED and try to bind it to the button's fill.`,
    );
    expect(toolCalls.length).toBeGreaterThan(1);
    assertResponseContains(response, [
      'card', 'token', 'variable', 'primary', 'created', 'render', 'bind', 'color',
    ]);
    await assertFigmaNodeExists(ctx.win, 'TokenCard_', {}, ctx.fileKey);
  });

  test('4.4 create and clone with modifications', async () => {
    const name = `Original_${uniqueSuffix()}`;
    const result = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a red (#EF4444) rectangle named '${name}' (64x64). Clone it 3 times. Rename the clones to 'Clone_Red', 'Clone_Green', 'Clone_Yellow' and change their fills to match their names (#EF4444, #22C55E, #EAB308). Arrange them in a horizontal row with 16px spacing.`,
    );
    expect(result.toolCalls.length).toBeGreaterThan(3);
    assertResponseContains(result.response, [
      'clone', 'red', 'green', 'yellow', 'created', 'spacing', 'row', 'horizontal',
    ]);
    const count = await getFigmaPageNodeCount(ctx.win, ctx.fileKey);
    expect(count).toBeGreaterThanOrEqual(4);
  });

  test('4.5 component with auto-layout and screenshot', async () => {
    const name = `TestComp_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a Figma component (not just a frame) named '${name}'. Inside it, add a vertical auto-layout with: a title text 'Notification', a body text 'You have new messages', and a small dismiss button. Set 12px padding and 8px gap. When done, take a screenshot.`,
    );
    expect(toolCalls.length).toBeGreaterThan(2);
    assertToolCalled(toolCalls, 'figma_screenshot', 'figma_capture_screenshot');
    assertResponseContains(response, [
      'component', 'notification', 'created', 'auto-layout', 'auto layout', 'dismiss', 'padding',
    ]);
    await assertFigmaNodeExists(ctx.win, 'TestComp_', { type: 'COMPONENT' }, ctx.fileKey);
  });

  test('4.6 component analysis', async () => {
    const name = `AnalyzeMe_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a button component named '${name}' with text 'Action', padding 16px, blue (#2563EB) fill, and white text. Then use figma_get_component_details to analyze its structure and properties.`,
    );
    assertToolCalled(toolCalls, 'figma_get_component_details', 'figma_get_component_deep', 'figma_execute');
    assertResponseContains(response, ['component', 'propert', 'structure', 'text', 'fill', 'action']);
    await assertFigmaNodeExists(ctx.win, 'AnalyzeMe_', {}, ctx.fileKey);
  });

  test('4.7 variant arrangement', async () => {
    const name = `BtnSet_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a component set named '${name}' with 4 button variants: Default (blue), Hover (dark blue), Disabled (gray), Active (green). Each variant is a frame with text and colored fill. Then use figma_analyze_component_set to inspect the variants, and figma_arrange_component_set to organize them in a grid.`,
    );
    expect(toolCalls.length).toBeGreaterThan(2);
    assertResponseContains(response, [
      'variant', 'component', 'default', 'hover', 'disabled', 'active', 'arrange', 'grid', 'set',
    ]);
  });

  test('4.8 annotations roundtrip', async () => {
    const name = `NoteTarget_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a frame named '${name}' (200x200, white fill). Add an annotation to it with label 'Design Review' and description 'Spacing needs adjustment per brand guidelines'. Then read back the annotations using figma_get_annotations and confirm they were saved.`,
    );
    assertToolCalled(toolCalls, 'figma_set_annotations', 'figma_execute');
    assertToolCalled(toolCalls, 'figma_get_annotations', 'figma_execute');
    assertResponseContains(response, ['annotation', 'design review', 'spacing', 'saved', 'confirm']);
    await assertFigmaNodeExists(ctx.win, 'NoteTarget_', {}, ctx.fileKey);
  });

  test('4.9 library components discovery', async () => {
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      'Search for any published library components available to this file using figma_get_library_components or figma_search_components. List what you find.',
    );
    assertToolCalled(toolCalls, 'figma_get_library_components', 'figma_search_components', 'figma_design_system');
    assertResponseContains(response, ['component', 'library', 'search', 'found', 'no ', 'available']);
  });
});
