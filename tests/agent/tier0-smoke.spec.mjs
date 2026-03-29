/**
 * Tier 0 — Smoke Tests (no Figma required)
 *
 * Validates that the agent can respond using real Anthropic API
 * without needing a Figma Desktop connection.
 *
 * Cost: ~$0.03 per run
 */

import { test, expect } from '@playwright/test';
import {
  launchAgentAppNoFigma,
  closeApp,
  sendAndWait,
  assertResponseContains,
  assertAgentStable,
  captureDiagnostics,
  skipIfTierFiltered,
} from '../helpers/agent-harness.mjs';

let app, win, slotId;

test.beforeAll(async () => {
  ({ app, win, slotId } = await launchAgentAppNoFigma());
});

test.afterAll(async () => {
  await closeApp(app);
});

test.afterEach(async ({}, testInfo) => {
  await captureDiagnostics(win, testInfo);
});

test.beforeEach(async () => {
  skipIfTierFiltered(test, 0);
  await win.evaluate((id) => window.__testResetChat?.(id), slotId);
});

test.describe('Tier 0 — Smoke (no Figma)', () => {
  test('0.1 @smoke agent lists available tools', async () => {
    const { response } = await sendAndWait(
      win,
      slotId,
      'List the tools you have available for working with Figma.',
      120_000,
    );
    expect(response.length).toBeGreaterThan(0);
    assertResponseContains(response, ['execute', 'screenshot', 'create', 'figma']);
    await assertAgentStable(win);
  });

  test('0.2 agent describes capabilities', async () => {
    const { response } = await sendAndWait(
      win,
      slotId,
      'What can you help me with? Describe your capabilities briefly.',
      120_000,
    );
    expect(response.length).toBeGreaterThan(0);
    assertResponseContains(response, ['design', 'figma', 'component', 'create']);
    await assertAgentStable(win);
  });
});
