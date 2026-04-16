/**
 * Playbook — thinking-level survives the full Bottega turn pipeline.
 *
 * The toolbar's effort dropdown flips `session.setThinkingLevel()` between
 * prompts. This test guards the invariant that setting / clamping the level
 * does not perturb tool execution, compression hooks, or event routing —
 * i.e. level changes are a pure-metadata operation from the pipeline's POV.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { type BottegaTestSession, createBottegaTestSession } from '../../helpers/bottega-test-session.js';
import { calls, says, when } from '../../helpers/playbook.js';

let t: BottegaTestSession | null = null;

afterEach(() => {
  t?.dispose();
  t = null;
});

describe('Playbook — thinking level interaction with turn pipeline', () => {
  it('applies setThinkingLevel between turns and still runs tools + events normally', async () => {
    t = await createBottegaTestSession({
      mockTools: { figma_status: '{"connected": true}' },
    });

    // Default session model (claude-sonnet-4-6) supports reasoning but not xhigh.
    const session = t.session;
    expect(session.supportsThinking()).toBe(true);

    // Change level mid-"session" (between runs) — simulating the user picking
    // a new effort from the toolbar while the agent is idle.
    session.setThinkingLevel('low');
    expect(session.thinkingLevel).toBe('low');

    await t.run(when('First turn', [calls('figma_status'), says('done 1')]));

    // Pipeline events are unaffected: tool ran, result flowed, playbook consumed.
    expect(t.events.toolSequence()).toEqual(['figma_status']);
    expect(t.playbook.consumed).toBe(2);

    // Flip again before the next prompt — must still take effect.
    session.setThinkingLevel('high');
    expect(session.thinkingLevel).toBe('high');

    await t.run(when('Second turn', [calls('figma_status'), says('done 2')]));
    expect(t.events.toolSequence()).toEqual(['figma_status', 'figma_status']);
  });

  it('clamps xhigh silently on a non-xhigh model without disrupting the next turn', async () => {
    t = await createBottegaTestSession({
      mockTools: { figma_status: '{"connected": true}' },
    });

    const session = t.session;
    session.setThinkingLevel('xhigh');
    // Sonnet 4.6 clamps to the highest supported tier (high). The UI relies on
    // this value being readable so it can repaint the chip with the effective
    // level instead of the requested one.
    expect(session.thinkingLevel).toBe('high');

    await t.run(when('Go', [calls('figma_status'), says('ok')]));

    expect(t.events.toolCallsFor('figma_status')).toHaveLength(1);
    // Post-turn the level is still the clamped value — no drift.
    expect(session.thinkingLevel).toBe('high');
  });

  it('exposes a stable availableLevels set that always starts with "off"', async () => {
    t = await createBottegaTestSession();
    const levels = t.session.getAvailableThinkingLevels();
    expect(levels[0]).toBe('off');
    expect(levels).toContain('medium');
    // Sonnet 4.6: no xhigh.
    expect(levels).not.toContain('xhigh');
  });
});
