/**
 * Tier 5 — Image Generation Tests (requires Figma Desktop + Bridge plugin + Gemini API key)
 *
 * Validates that the agent can use all 7 image generation tools via the Gemini API.
 * Requires BOTTEGA_GEMINI_KEY in .env or environment.
 *
 * Run separately: npm run test:agent:imagegen
 * Cost: ~$0.50-1.00 per run (Gemini API)
 */

import { test } from '@playwright/test';
import {
  useFigmaTierLifecycle,
  sendAndWait,
  assertToolCalled,
  assertResponseContains,
  assertFigmaNodeExists,
  skipIfTierFiltered,
  uniqueSuffix,
} from '../helpers/agent-harness.mjs';

const ctx = useFigmaTierLifecycle(test, 5);

test.describe('Tier 5 — Image Generation', () => {
  test.beforeEach(async () => {
    skipIfTierFiltered(test, 5);
    // Verify Gemini API key is configured
    const hasKey = await ctx.win.evaluate(() => window.api.getImageGenConfig().then(c => c.hasApiKey));
    test.skip(!hasKey, 'Gemini API key not configured — set BOTTEGA_GEMINI_KEY in .env');
  });

  test('5.1 generate image and apply to node', async () => {
    const name = `GenImg_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a rectangle named '${name}' (400x300). Then use figma_generate_image to generate a "sunset over mountains, photorealistic" image and apply it to the rectangle.`,
    );
    assertToolCalled(toolCalls, 'figma_generate_image', 'figma_execute');
    assertResponseContains(response, ['image', 'generated', 'sunset', 'mountains', 'applied']);
    await assertFigmaNodeExists(ctx.win, 'GenImg_', {}, ctx.fileKey);
  });

  test('5.2 generate app icon', async () => {
    const name = `AppIcon_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a rectangle named '${name}' (128x128). Then use figma_generate_icon to generate a modern flat app icon of "a chat bubble with a heart" and apply it to the rectangle.`,
    );
    assertToolCalled(toolCalls, 'figma_generate_icon', 'figma_execute');
    assertResponseContains(response, ['icon', 'generated', 'chat', 'heart', 'applied']);
    await assertFigmaNodeExists(ctx.win, 'AppIcon_', {}, ctx.fileKey);
  });

  test('5.3 generate seamless pattern with TILE mode', async () => {
    const name = `Pattern_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a rectangle named '${name}' (600x400). Then use figma_generate_pattern to generate a seamless geometric pattern in blue and white, and apply it to the rectangle with TILE scale mode.`,
    );
    assertToolCalled(toolCalls, 'figma_generate_pattern', 'figma_execute');
    assertResponseContains(response, ['pattern', 'generated', 'seamless', 'geometric', 'tile', 'applied']);
    await assertFigmaNodeExists(ctx.win, 'Pattern_', {}, ctx.fileKey);
  });

  test('5.4 generate flowchart diagram', async () => {
    const name = `Diagram_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a rectangle named '${name}' (800x600). Then use figma_generate_diagram to generate a simple flowchart showing "Start -> Process Data -> Decision (Yes/No) -> End". Use professional style with accent colors.`,
    );
    assertToolCalled(toolCalls, 'figma_generate_diagram', 'figma_execute');
    assertResponseContains(response, ['diagram', 'flowchart', 'generated', 'applied']);
    await assertFigmaNodeExists(ctx.win, 'Diagram_', {}, ctx.fileKey);
  });

  test('5.5 edit existing image', async () => {
    const name = `EditImg_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a blue (#3B82F6) rectangle named '${name}' (300x200) and take a screenshot of it. Then use figma_edit_image to edit the node's image, adding "a white star in the center". Apply the result back to the same node.`,
    );
    assertToolCalled(toolCalls, 'figma_edit_image', 'figma_execute');
    assertResponseContains(response, ['edit', 'image', 'star', 'applied']);
    await assertFigmaNodeExists(ctx.win, 'EditImg_', {}, ctx.fileKey);
  });

  test('5.6 generate visual story (multi-step)', async () => {
    test.setTimeout(300_000); // 5 min — generates multiple images sequentially
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      'Use figma_generate_story to create a 3-step visual story showing "a seed growing into a tree": step 1 seed in soil, step 2 small sprout, step 3 full tree. Use consistent style.',
      280_000,
    );
    assertToolCalled(toolCalls, 'figma_generate_story', 'figma_execute');
    assertResponseContains(response, ['story', 'generated', 'seed', 'tree', 'step', 'frame']);
  });

  test('5.7 restore/enhance image', async () => {
    const name = `Restore_${uniqueSuffix()}`;
    const { toolCalls, response } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a rectangle named '${name}' (200x200) with a gray (#9CA3AF) fill. Take a screenshot of it, then use figma_restore_image to enhance it with "sharpen and add subtle texture". Apply the result back.`,
    );
    assertToolCalled(toolCalls, 'figma_restore_image', 'figma_execute');
    assertResponseContains(response, ['restore', 'enhance', 'image', 'applied', 'sharpen']);
    await assertFigmaNodeExists(ctx.win, 'Restore_', {}, ctx.fileKey);
  });
});
