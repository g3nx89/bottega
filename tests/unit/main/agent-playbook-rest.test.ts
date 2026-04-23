/**
 * Playbook coverage for the REST-only tools (`figma_whoami`,
 * `figma_get_file_versions`, `figma_get_dev_resources`). Confirms the agent
 * pipeline wires them, TypeBox param validation accepts the documented
 * shapes, and compression doesn't crash on REST JSON payloads.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { type BottegaTestSession, createBottegaTestSession } from '../../helpers/bottega-test-session.js';
import { calls, says, when } from '../../helpers/playbook.js';

let t: BottegaTestSession | null = null;

afterEach(() => {
  t?.dispose();
  t = null;
});

describe('Playbook — REST tools', () => {
  it('figma_whoami runs end-to-end with empty params', async () => {
    t = await createBottegaTestSession({
      mockTools: {
        figma_whoami: '{"id":"U-1","handle":"alice"}',
      },
    });

    await t.run(when('Who am I?', [calls('figma_whoami'), says('You are alice.')]));

    const callsRec = t.events.toolCallsFor('figma_whoami');
    const results = t.events.toolResultsFor('figma_whoami');
    expect(callsRec).toHaveLength(1);
    expect(callsRec[0]!.input).toEqual({});
    expect(results).toHaveLength(1);
    expect(results[0]!.text).toContain('alice');
    expect(results[0]!.isError).toBe(false);
  });

  it('figma_get_file_versions forwards pagination params verbatim', async () => {
    t = await createBottegaTestSession({
      mockTools: {
        figma_get_file_versions: '{"versions":[]}',
      },
    });

    await t.run(
      when('List versions', [
        calls('figma_get_file_versions', { pageSize: 10, before: 100 }),
        says('No versions found.'),
      ]),
    );

    const callsRec = t.events.toolCallsFor('figma_get_file_versions');
    expect(callsRec).toHaveLength(1);
    expect(callsRec[0]!.input).toEqual({ pageSize: 10, before: 100 });
    expect(t.events.toolResultsFor('figma_get_file_versions')[0]!.isError).toBe(false);
  });

  it('figma_get_dev_resources forwards nodeIds filter verbatim', async () => {
    t = await createBottegaTestSession({
      mockTools: {
        figma_get_dev_resources: '{"dev_resources":[]}',
      },
    });

    await t.run(
      when('Dev resources for a node', [
        calls('figma_get_dev_resources', { nodeIds: ['1:2'] }),
        says('None attached.'),
      ]),
    );

    const callsRec = t.events.toolCallsFor('figma_get_dev_resources');
    expect(callsRec).toHaveLength(1);
    expect(callsRec[0]!.input).toEqual({ nodeIds: ['1:2'] });
    expect(t.events.toolResultsFor('figma_get_dev_resources')[0]!.text).toContain('dev_resources');
  });
});
