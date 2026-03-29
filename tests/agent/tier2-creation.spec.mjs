/**
 * Tier 2 — Creation Tests (requires Figma Desktop + Bridge plugin)
 *
 * Validates that the agent can create Figma nodes from an empty page.
 * Each test clears the page, sends a creation prompt, and verifies
 * the node exists in Figma via the oracle.
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
  skipIfTierFiltered,
  uniqueSuffix,
} from '../helpers/agent-harness.mjs';

const ctx = useFigmaTierLifecycle(test);

test.describe('Tier 2 — Creation', () => {
  test.beforeEach(() => skipIfTierFiltered(test, 2));

  test('2.1 @smoke gradient rectangle', async () => {
    const name = `Hero_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a rectangle named '${name}' that is 400x200 pixels. Fill it with a linear gradient from purple (#7C3AED) to blue (#3B82F6), and add a 2px white border.`,
    );
    assertToolCalled(toolCalls, 'figma_execute', 'figma_create_child', 'figma_render_jsx');
    assertResponseContains(response, ['hero', 'gradient', 'rectangle', 'created', 'purple']);
    await assertFigmaNodeExists(ctx.win, 'Hero_', {}, ctx.fileKey);
  });

  test('2.2 text layout with auto-layout', async () => {
    const name = `Layout_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a vertical auto-layout frame named '${name}' with 16px spacing containing: a heading 'Welcome to Bottega', a paragraph of lorem ipsum text, and a button that says 'Get Started'.`,
    );
    expect(toolCalls.length).toBeGreaterThan(0);
    assertResponseContains(response, [
      'welcome', 'get started', 'layout', 'auto', 'frame', 'vertical', 'text', 'button',
    ]);
    const count = await getFigmaPageNodeCount(ctx.win, ctx.fileKey);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('2.3 icon grid', async () => {
    const name = `IconGrid_${uniqueSuffix()}`;
    const { toolCalls } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a 2x2 grid of icons in a frame named '${name}': a star (mdi:star), a heart (mdi:heart), a home (mdi:home), and a gear (mdi:cog). Each icon 24x24, 8px gap.`,
    );
    assertToolCalled(toolCalls, 'figma_create_icon', 'figma_render_jsx', 'figma_execute');
    await assertFigmaNodeExists(ctx.win, 'IconGrid_', {}, ctx.fileKey);
  });

  test('2.4 button component', async () => {
    const name = `PrimaryBtn_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a button named '${name}' with text 'Submit', padding 12px horizontal and 8px vertical, corner radius 8px, solid blue (#2563EB) background.`,
    );
    expect(toolCalls.length).toBeGreaterThan(0);
    assertResponseContains(response, ['button', 'submit', 'created']);
    await assertFigmaNodeExists(ctx.win, 'PrimaryBtn_', {}, ctx.fileKey);
  });

  test('2.5 app header', async () => {
    const name = `Header_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a mobile app header named '${name}': 375px wide, 44px tall, white background. Back arrow icon left, centered title 'Profile', settings gear icon right.`,
    );
    expect(toolCalls.length).toBeGreaterThan(0);
    assertResponseContains(response, ['header', 'profile']);
    await assertFigmaNodeExists(ctx.win, 'Header_', {}, ctx.fileKey);
  });

  test('2.6 color swatches', async () => {
    const name = `Swatches_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create 5 colored circles in a horizontal row, each 48x48, in a frame named '${name}': Red (#EF4444), Orange (#F97316), Yellow (#EAB308), Green (#22C55E), Blue (#3B82F6). Name each circle after its color.`,
    );
    expect(toolCalls.length).toBeGreaterThan(0);
    assertResponseContains(response, ['red', 'blue', 'swatch', 'circle', 'color']);
    const count = await getFigmaPageNodeCount(ctx.win, ctx.fileKey);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('2.7 product card', async () => {
    const name = `Card_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a product card named '${name}' (320x400) with auto-layout: gray (#E5E7EB) image placeholder (320x200), title 'Product Name', price '$29.99', and a short description. Proper spacing and padding.`,
    );
    expect(toolCalls.length).toBeGreaterThan(0);
    assertResponseContains(response, [
      'card', '29.99', 'product', 'created', 'placeholder', 'price', 'auto',
    ]);
    await assertFigmaNodeExists(ctx.win, 'Card_', {}, ctx.fileKey);
  });

  test('2.8 annotations', async () => {
    const name = `Annotated_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a rectangle named '${name}' (200x100, light gray fill) and add an annotation to it with the label 'Needs review' and description 'Check spacing with design team'.`,
    );
    expect(toolCalls.length).toBeGreaterThan(0);
    assertResponseContains(response, ['annotation', 'review', 'annotated', 'created']);
    await assertFigmaNodeExists(ctx.win, 'Annotated_', {}, ctx.fileKey);
  });

  test('2.9 lint design', async () => {
    const name = `LintTarget_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a frame named '${name}' with 3 child rectangles of different sizes and random spacing. Then run figma_lint on the frame to check for design issues.`,
    );
    assertToolCalled(toolCalls, 'figma_lint', 'figma_execute');
    assertResponseContains(response, ['lint', 'issue', 'check', 'rule', 'finding', 'design']);
    await assertFigmaNodeExists(ctx.win, 'LintTarget_', {}, ctx.fileKey);
  });

  test('2.10 image fill from URL', async () => {
    const name = `ImgFill_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a rectangle named '${name}' (300x200) and set its fill to an image from this URL: https://picsum.photos/300/200. Use figma_set_image_fill.`,
    );
    assertToolCalled(toolCalls, 'figma_set_image_fill', 'figma_execute');
    assertResponseContains(response, ['image', 'fill', 'rectangle', 'created', 'set']);
    await assertFigmaNodeExists(ctx.win, 'ImgFill_', {}, ctx.fileKey);
  });
});
