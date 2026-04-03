/**
 * Connector shape compatibility tests.
 *
 * Verifies that compactDesignSystem(), figma_design_system tool, and
 * figma_setup_tokens idempotent path all correctly handle the real
 * Desktop Bridge response shapes (flat variables + separate collections).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { compactDesignSystem, DesignSystemCache } from '../../../../src/main/compression/design-system-cache.js';
import { createDiscoveryTools } from '../../../../src/main/tools/discovery.js';
import { createTokenTools } from '../../../../src/main/tools/tokens.js';
import {
  GET_LOCAL_COMPONENTS_RESPONSE,
  GET_VARIABLES_EMPTY_RESPONSE,
  GET_VARIABLES_RESPONSE,
} from '../../../fixtures/connector-responses.js';
import { createTestToolDeps } from '../../../helpers/mock-connector.js';

// ── compactDesignSystem with real flat shape ─────────────────────────────────

describe('compactDesignSystem — real Desktop Bridge flat shape', () => {
  it('produces dsStatus: active when variables exist', () => {
    const result = compactDesignSystem(GET_VARIABLES_RESPONSE);
    expect(result.dsStatus).toBe('active');
  });

  it('produces one collection named Tokens', () => {
    const result = compactDesignSystem(GET_VARIABLES_RESPONSE);
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0].name).toBe('Tokens');
  });

  it('maps flat variables into the collection with correct names', () => {
    const result = compactDesignSystem(GET_VARIABLES_RESPONSE);
    const col = result.variables[0];
    expect(Object.keys(col.vars)).toContain('colors/primary');
    expect(Object.keys(col.vars)).toContain('spacing/md');
  });

  it('converts COLOR variable to hex in correct mode', () => {
    const result = compactDesignSystem(GET_VARIABLES_RESPONSE);
    const col = result.variables[0];
    // colors/primary: r=0.65, g=0.35, b=1, a=1
    expect(col.vars['colors/primary'].type).toBe('COLOR');
    expect(col.vars['colors/primary'].values.Light).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('preserves FLOAT variable value as-is', () => {
    const result = compactDesignSystem(GET_VARIABLES_RESPONSE);
    const col = result.variables[0];
    expect(col.vars['spacing/md'].type).toBe('FLOAT');
    expect(col.vars['spacing/md'].values.Light).toBe(16);
  });

  it('exposes correct mode names on the collection', () => {
    const result = compactDesignSystem(GET_VARIABLES_RESPONSE);
    expect(result.variables[0].modes).toEqual(['Light']);
  });
});

describe('compactDesignSystem — empty Desktop Bridge response', () => {
  it('produces dsStatus: none when no collections exist', () => {
    const result = compactDesignSystem(GET_VARIABLES_EMPTY_RESPONSE);
    expect(result.dsStatus).toBe('none');
  });

  it('returns empty variables array', () => {
    const result = compactDesignSystem(GET_VARIABLES_EMPTY_RESPONSE);
    expect(result.variables).toEqual([]);
  });

  it('returns empty components array', () => {
    const result = compactDesignSystem(GET_VARIABLES_EMPTY_RESPONSE);
    expect(result.components).toEqual([]);
  });
});

// ── figma_design_system tool — real response normalization ───────────────────

describe('figma_design_system tool — normalizes real connector response', () => {
  let deps: ReturnType<typeof createTestToolDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestToolDeps();
    // Override config to enable compact output so we can inspect the compact result
    deps.configManager.getActiveConfig.mockReturnValue({
      defaultSemanticMode: 'full',
      compactDesignSystem: true,
      designSystemCacheTtlMs: 60000,
      outputFormat: 'json',
    });
    // Use a real DesignSystemCache so the set/get round-trip works
    deps.designSystemCache = new DesignSystemCache();
    deps.fileKey = 'abc123';

    deps.connector.getVariables.mockResolvedValue(GET_VARIABLES_RESPONSE);
    deps.connector.getLocalComponents.mockResolvedValue(GET_LOCAL_COMPONENTS_RESPONSE);

    const tools = createDiscoveryTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_design_system');
  });

  it('returns dsStatus: active from real response', async () => {
    const result = await tool.execute('call1', { forceRefresh: true }, null, null, null);
    const data = JSON.parse(result.content[0].text);
    expect(data.dsStatus).toBe('active');
  });

  it('includes Tokens collection in variables', async () => {
    const result = await tool.execute('call1', { forceRefresh: true }, null, null, null);
    const data = JSON.parse(result.content[0].text);
    expect(data.variables).toHaveLength(1);
    expect(data.variables[0].name).toBe('Tokens');
  });

  it('includes both variables from the flat array', async () => {
    const result = await tool.execute('call1', { forceRefresh: true }, null, null, null);
    const data = JSON.parse(result.content[0].text);
    const varNames = Object.keys(data.variables[0].vars);
    expect(varNames).toContain('colors/primary');
    expect(varNames).toContain('spacing/md');
  });

  it('caches the result on second call', async () => {
    await tool.execute('call1', { forceRefresh: true }, null, null, null);
    await tool.execute('call2', {}, null, null, null);
    // getVariables should only be called once (second call hits cache)
    expect(deps.connector.getVariables).toHaveBeenCalledTimes(1);
  });
});

// ── figma_setup_tokens — idempotent path with real response shape ────────────

describe('figma_setup_tokens — finds existing collection from real response shape', () => {
  let deps: ReturnType<typeof createTestToolDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestToolDeps();
    // Return the real flat-shape response from getVariables
    deps.connector.getVariables.mockResolvedValue(GET_VARIABLES_RESPONSE);

    const tools = createTokenTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_setup_tokens');
  });

  it('detects the existing Tokens collection and does NOT create a new one', async () => {
    await tool.execute(
      'call1',
      {
        collectionName: 'Tokens',
        modes: ['Light'],
        variables: [
          {
            name: 'colors/primary',
            type: 'COLOR',
            values: { Light: { r: 0.65, g: 0.35, b: 1 } },
          },
        ],
      },
      null,
      null,
      null,
    );

    expect(deps.connector.createVariableCollection).not.toHaveBeenCalled();
  });

  it('returns the existing collection id from real response', async () => {
    const result = await tool.execute(
      'call1',
      {
        collectionName: 'Tokens',
        modes: ['Light'],
        variables: [],
      },
      null,
      null,
      null,
    );

    const data = JSON.parse(result.content[0].text);
    expect(data.collectionId).toBe('VariableCollectionID:1:0');
  });

  it('updates existing variable found via flat variables array', async () => {
    await tool.execute(
      'call1',
      {
        collectionName: 'Tokens',
        modes: ['Light'],
        variables: [
          {
            name: 'colors/primary',
            type: 'COLOR',
            values: { Light: { r: 1, g: 0, b: 0 } },
          },
        ],
      },
      null,
      null,
      null,
    );

    // Should update the existing variable, not create a new one
    expect(deps.connector.createVariable).not.toHaveBeenCalled();
    expect(deps.connector.updateVariable).toHaveBeenCalledWith('VariableID:1:1', '1:0', { r: 1, g: 0, b: 0 });
  });
});
