/**
 * Tier 6 — Advanced Resilience Tests (requires Figma Desktop + Bridge plugin)
 *
 * Validates session durability, model switching, judge convergence,
 * compression profile transitions, long-session stability, and batch
 * operations under realistic load.
 *
 * Cost: ~$2.00-3.00 per run (multi-turn, metrics-heavy)
 */

import { test, expect } from '@playwright/test';
import {
  launchAgentApp,
  closeApp,
  sendAndWait,
  assertToolCalled,
  skipIfTierFiltered,
  uniqueSuffix,
  queryFigma,
  clearFigmaPage,
  captureDiagnostics,
} from '../helpers/agent-harness.mjs';
import {
  getMetrics,
  snapshotMetrics,
  diffMetrics,
} from '../helpers/metrics-client.mjs';

// Custom lifecycle with 120s Figma timeout — the Bridge plugin uses exponential
// backoff (up to 30s between retries) so the default 60s can miss the reconnect.
const ctx = { app: null, win: null, slotId: null, fileKey: null, figmaConnected: false };

test.beforeAll(async () => {
  const envTier = process.env.BOTTEGA_AGENT_TEST_TIER;
  if (envTier !== undefined && envTier !== '' && Number(envTier) !== 6) return;
  const result = await launchAgentApp({ figmaTimeout: 120_000 });
  Object.assign(ctx, result);
});

test.afterAll(async () => { await closeApp(ctx.app); });

test.afterEach(async ({}, testInfo) => {
  if (ctx.slotId && ctx.win) {
    await ctx.win.evaluate((id) => window.api.abort(id), ctx.slotId).catch(() => {});
    await ctx.win.evaluate((id) => window.api.queueClear(id), ctx.slotId).catch(() => {});
  }
  if (ctx.win) await captureDiagnostics(ctx.win, testInfo, ctx.fileKey);
});

test.beforeEach(async () => {
  if (!ctx.win) { test.skip(true, 'Tier filtered out — app not launched'); return; }
  if (!ctx.figmaConnected) { test.skip(true, 'Figma Desktop not connected'); return; }
  try { await queryFigma(ctx.win, 'return 1;', 5_000, ctx.fileKey); }
  catch {
    ctx.figmaConnected = false;
    test.skip(true, 'Figma connection lost');
    return;
  }
  await ctx.win.evaluate((id) => window.api.resetSessionWithClear(id), ctx.slotId);
  await ctx.win.waitForTimeout(300);
  const remaining = await clearFigmaPage(ctx.win, ctx.fileKey);
  if (remaining !== 0) throw new Error(`clearFigmaPage left ${remaining} nodes`);
});

test.describe('Tier 6 — Resilience', () => {
  test.beforeEach(() => skipIfTierFiltered(test, 6));

  test('6.1 model switch mid-session', async () => {
    test.setTimeout(300_000); // 5 min

    // Turn 1: Sonnet creates a blue rectangle
    const name = `ModelSwitch_${uniqueSuffix()}`;
    const turn1 = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a blue (#3B82F6) rectangle named '${name}' (200x100).`,
      90_000,
    );
    expect(turn1.toolCalls.length).toBeGreaterThan(0);

    // Switch to GPT-5.4-mini
    await ctx.win.evaluate(
      ([id]) => window.api.switchModel(id, { provider: 'openai', modelId: 'gpt-5.4-mini' }),
      [ctx.slotId],
    );

    // Turn 2: GPT-5.4-mini changes color to green
    const turn2 = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Change the fill color of '${name}' to green (#22C55E).`,
      90_000,
    );
    expect(turn2.toolCalls.length).toBeGreaterThan(0);

    // Switch back to Sonnet
    await ctx.win.evaluate(
      ([id]) => window.api.switchModel(id, { provider: 'anthropic', modelId: 'claude-sonnet-4-6' }),
      [ctx.slotId],
    );

    // Turn 3: Ask about current color — no crash, meaningful response
    const turn3 = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `What color is the rectangle named '${name}' right now? Take a screenshot to check.`,
      90_000,
    );
    expect(turn3.toolCalls.length).toBeGreaterThan(0);
    // Agent should have taken a screenshot or used a discovery tool — no crash
    expect(turn3.response.length).toBeGreaterThan(0);
  });

  test('6.2 judge convergence measurement', async () => {
    test.setTimeout(300_000); // 5 min

    // Enable judge override so every mutating turn triggers a judge pass
    await ctx.win.evaluate(
      ([id]) => window.api.setJudgeOverride(id, true),
      [ctx.slotId],
    );

    const before = await snapshotMetrics(ctx.win, 'before');

    const name = `JudgeCard_${uniqueSuffix()}`;
    const { toolCalls } = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a card component named '${name}' (320x200) with a vertical auto-layout. ` +
        `Add a title 'Dashboard', a subtitle 'Weekly summary', a divider rectangle, and a footer with 'View all' text. ` +
        `Apply 16px padding, 12px gap, white fill on the card, and a light gray (#F3F4F6) footer background.`,
      250_000,
    );

    expect(toolCalls.length).toBeGreaterThan(0);

    const after = await snapshotMetrics(ctx.win, 'after');
    const delta = diffMetrics(before, after);

    // Judge must have triggered at least once after the mutating turn
    expect(delta['judge.triggeredTotal']).toBeGreaterThan(0);

    // At least one verdict must have been issued (PASS, FAIL, or UNKNOWN)
    const totalVerdicts =
      (delta['judge.verdictCounts.PASS'] ?? 0) +
      (delta['judge.verdictCounts.FAIL'] ?? 0) +
      (delta['judge.verdictCounts.UNKNOWN'] ?? 0);
    expect(totalVerdicts).toBeGreaterThan(0);
  });

  test('6.3 compression profile switch', async () => {
    test.setTimeout(300_000); // 5 min

    // --- balanced profile ---
    await ctx.win.evaluate(() => window.api.compressionSetProfile('balanced'));

    const name1 = `CompTest_bal_${uniqueSuffix()}`;
    const turn1 = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a text node named '${name1}' with content 'Balanced profile active'.`,
      90_000,
    );
    expect(turn1.toolCalls.length).toBeGreaterThan(0);
    expect(turn1.response.length).toBeGreaterThan(0);

    // --- minimal profile ---
    await ctx.win.evaluate(() => window.api.compressionSetProfile('minimal'));

    const turn2 = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Change the text of '${name1}' to 'Minimal profile active'.`,
      90_000,
    );
    expect(turn2.toolCalls.length).toBeGreaterThan(0);
    expect(turn2.response.length).toBeGreaterThan(0);

    // --- creative profile ---
    await ctx.win.evaluate(() => window.api.compressionSetProfile('creative'));

    const turn3 = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Take a screenshot showing '${name1}'.`,
      90_000,
    );
    expect(turn3.toolCalls.length).toBeGreaterThan(0);
    assertToolCalled(turn3.toolCalls, 'figma_screenshot', 'figma_capture_screenshot');
  });

  test('6.4 10-turn session stability', async () => {
    test.setTimeout(900_000); // 15 min

    const startSnap = await snapshotMetrics(ctx.win, 'start');
    const suffix = uniqueSuffix();

    const prompts = [
      `Create a red rectangle named 'Stability_${suffix}' (100x100).`,
      `Change the fill of 'Stability_${suffix}' to blue (#2563EB).`,
      `Add a text node inside 'Stability_${suffix}' with content 'Turn 3'.`,
      `Resize 'Stability_${suffix}' to 200x200.`,
      `Take a screenshot of the current canvas.`,
      `Rename 'Stability_${suffix}' to 'Stability_renamed_${suffix}'.`,
      `Move 'Stability_renamed_${suffix}' to position x=300, y=300.`,
      `Clone 'Stability_renamed_${suffix}' and rename the clone to 'Stability_clone_${suffix}'.`,
      `Delete 'Stability_clone_${suffix}'.`,
      `Take a final screenshot confirming only one element remains.`,
    ];

    for (const prompt of prompts) {
      const result = await sendAndWait(ctx.win, ctx.slotId, prompt, 120_000);
      expect(result.toolCalls.length).toBeGreaterThan(0);
      expect(result.response.length).toBeGreaterThan(0);
    }

    const endSnap = await snapshotMetrics(ctx.win, 'end');
    const delta = diffMetrics(startSnap, endSnap);

    // All 10 turns must have been recorded
    expect(delta['turns.totalEnded']).toBeGreaterThanOrEqual(10);

    // Memory growth cap: RSS increase over 10 turns should stay under 500 MB
    const MB = 1024 * 1024;
    expect(delta['process.rssBytes']).toBeLessThan(500 * MB);
  });

  test('6.5 judge mode transitions', async () => {
    test.setTimeout(300_000); // 5 min

    // --- Judge OFF ---
    await ctx.win.evaluate(
      ([id]) => window.api.setJudgeOverride(id, false),
      [ctx.slotId],
    );

    const beforeOff = await snapshotMetrics(ctx.win, 'before-off');
    const name1 = `JudgeOff_${uniqueSuffix()}`;
    await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a small rectangle named '${name1}' (50x50) with fill #E5E7EB.`,
      90_000,
    );
    const afterOff = await snapshotMetrics(ctx.win, 'after-off');
    const deltaOff = diffMetrics(beforeOff, afterOff);

    // Judge should NOT have triggered while disabled
    expect(deltaOff['judge.triggeredTotal']).toBe(0);

    // --- Judge ON ---
    await ctx.win.evaluate(
      ([id]) => window.api.setJudgeOverride(id, true),
      [ctx.slotId],
    );

    const beforeOn = await snapshotMetrics(ctx.win, 'before-on');
    const name2 = `JudgeOn_${uniqueSuffix()}`;
    await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create a small rectangle named '${name2}' (50x50) with fill #6C5CE7.`,
      90_000,
    );
    const afterOn = await snapshotMetrics(ctx.win, 'after-on');
    const deltaOn = diffMetrics(beforeOn, afterOn);

    // Judge MUST have triggered at least once with override active
    expect(deltaOn['judge.triggeredTotal']).toBeGreaterThan(0);
  });

  test('6.6 batch operations on dense canvas', async () => {
    test.setTimeout(600_000); // 10 min

    const suffix = uniqueSuffix();

    // Turn 1: create 4 cards + 4 buttons in one prompt
    const turn1 = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Create 4 card frames named 'Card_A_${suffix}', 'Card_B_${suffix}', 'Card_C_${suffix}', 'Card_D_${suffix}' ` +
        `(240x160 each, white fill, 12px corner radius, arranged horizontally with 24px spacing). ` +
        `Then create 4 button frames named 'Btn_1_${suffix}', 'Btn_2_${suffix}', 'Btn_3_${suffix}', 'Btn_4_${suffix}' ` +
        `(120x40 each, blue (#2563EB) fill, 8px corner radius, placed below the cards with 32px gap).`,
      250_000,
    );
    expect(turn1.toolCalls.length).toBeGreaterThan(0);
    expect(turn1.response.length).toBeGreaterThan(0);

    // Turn 2: batch-update all border-radius to 16px
    const turn2 = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Update the corner radius of all 8 elements (all 4 cards and all 4 buttons) to 16px.`,
      200_000,
    );
    expect(turn2.toolCalls.length).toBeGreaterThan(0);
    expect(turn2.response.length).toBeGreaterThan(0);

    // Turn 3: batch-update primary fill on all buttons
    const turn3 = await sendAndWait(
      ctx.win,
      ctx.slotId,
      `Change the fill color of all 4 buttons ('Btn_1_${suffix}' through 'Btn_4_${suffix}') to #6C5CE7.`,
      200_000,
    );
    expect(turn3.toolCalls.length).toBeGreaterThan(0);
    expect(turn3.response.length).toBeGreaterThan(0);

    // Verify no crash: agent still responsive after dense mutations
    const metrics = await getMetrics(ctx.win);
    expect(metrics).toBeTruthy();
    expect(metrics.tools.errorCount).toBeLessThanOrEqual(metrics.tools.callCount);
  });
});
