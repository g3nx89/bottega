/**
 * Playbook tests for design quality workflows (scripts 30-37).
 *
 * Generated from QA Run 5 (2026-04-10) findings. Tests the design quality
 * tool chains discovered during functional testing of the design-quality suite.
 *
 * Covers:
 * 1. Token setup + binding verification (script 30)
 * 2. Complex page layout via render_jsx (script 31)
 * 3. Rule adherence: auto-layout + lint pipeline (script 34)
 * 4. Cross-tool chain: discover → instantiate → modify → lint (script 35)
 * 5. Batch operations across multiple elements (script 36)
 * 6. Multi-screen consistency with batch tools (script 37)
 */

import { afterEach, describe, expect, it } from 'vitest';
import { type BottegaTestSession, createBottegaTestSession } from '../../helpers/bottega-test-session.js';
import { createMockConnector } from '../../helpers/mock-connector.js';
import { calls, says, when } from '../../helpers/playbook.js';

let t: BottegaTestSession | null = null;

afterEach(() => {
  t?.dispose();
  t = null;
});

// ═══════════════════════════════════════════════════════════
// 1. Token Setup + Binding Verification (Script 30)
// ═══════════════════════════════════════════════════════════

describe('Design quality — token pipeline', () => {
  it('sets up token collection via figma_setup_tokens', async () => {
    const connector = createMockConnector();
    connector.createVariableCollection.mockResolvedValue({
      success: true,
      collectionId: 'VariableCollectionId:1:0',
      name: 'Brand',
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      mockTools: {
        figma_setup_tokens: JSON.stringify({
          success: true,
          collectionId: 'VariableCollectionId:1:0',
          name: 'Brand',
          variables: [
            { name: 'colors/primary', resolvedType: 'COLOR', value: '#5B4FF5' },
            { name: 'colors/secondary', resolvedType: 'COLOR', value: '#00C9A7' },
            { name: 'spacing/sm', resolvedType: 'FLOAT', value: 8 },
            { name: 'spacing/md', resolvedType: 'FLOAT', value: 16 },
            { name: 'radii/sm', resolvedType: 'FLOAT', value: 4 },
          ],
        }),
      },
    });

    await t.run(
      when('Set up a token collection called Brand with colors primary=#5B4FF5', [
        calls('figma_setup_tokens', {
          collectionName: 'Brand',
          tokens: {
            'colors/primary': { type: 'COLOR', value: '#5B4FF5' },
            'colors/secondary': { type: 'COLOR', value: '#00C9A7' },
            'spacing/sm': { type: 'FLOAT', value: 8 },
            'spacing/md': { type: 'FLOAT', value: 16 },
            'radii/sm': { type: 'FLOAT', value: 4 },
          },
        }),
        says(
          'Brand token collection created with 5 variables: colors/primary, colors/secondary, spacing/sm, spacing/md, radii/sm.',
        ),
      ]),
    );

    expect(t.events.toolCallsFor('figma_setup_tokens')).toHaveLength(1);
    expect(t.events.toolSequence()).toEqual(['figma_setup_tokens']);
  });

  it('creates card with token bindings via render_jsx + bind_variable', async () => {
    let cardNodeId = '';

    t = await createBottegaTestSession({
      mockTools: {
        figma_render_jsx: JSON.stringify({ nodeId: '10:1', name: 'BrandCard' }),
        figma_bind_variable: JSON.stringify({ success: true, boundCount: 3 }),
        figma_screenshot: JSON.stringify({ base64: 'iVBOR...' }),
      },
    });

    await t.run(
      when('Create BrandCard using only Brand tokens', [
        calls('figma_render_jsx', {
          jsx: '<Frame name="BrandCard" width={320} height={200} cornerRadius={16} padding={40}><Text name="Title">Card Title</Text></Frame>',
        }).chain(() => {
          cardNodeId = '10:1';
        }),
        calls('figma_bind_variable', () => ({
          nodeId: cardNodeId || '10:1',
          bindings: [
            { property: 'fills', variableName: 'colors/surface' },
            { property: 'cornerRadius', variableName: 'radii/lg' },
            { property: 'paddingTop', variableName: 'spacing/xl' },
          ],
        })),
        calls('figma_screenshot'),
        says('BrandCard created with all Brand token bindings applied.'),
      ]),
    );

    expect(t.events.toolSequence()).toEqual(['figma_render_jsx', 'figma_bind_variable', 'figma_screenshot']);
  });
});

// ═══════════════════════════════════════════════════════════
// 2. Complex Page Layout (Script 31)
// ═══════════════════════════════════════════════════════════

describe('Design quality — complex page layout', () => {
  it('creates hero section with multiple render_jsx calls', async () => {
    t = await createBottegaTestSession({
      mockTools: {
        figma_status: JSON.stringify({ connected: true, fileKey: 'abc123' }),
        figma_render_jsx: JSON.stringify({ nodeId: '20:1', name: 'Hero' }),
        figma_execute: JSON.stringify({ success: true }),
        figma_screenshot: JSON.stringify({ base64: 'iVBOR...' }),
      },
    });

    await t.run(
      when('Create a hero section with headline, subtitle, and CTA buttons', [
        calls('figma_status'),
        calls('figma_render_jsx', {
          jsx: '<Frame name="Hero" width={1440} height={600} layoutMode="VERTICAL" primaryAxisAlignItems="CENTER"><Text name="Headline" fontSize={72}>Build Faster</Text></Frame>',
        }),
        calls('figma_render_jsx', {
          jsx: '<Frame name="CTAs" layoutMode="HORIZONTAL" itemSpacing={16}><Frame name="Primary CTA" cornerRadius={12} padding={16}><Text>Get Started</Text></Frame></Frame>',
        }),
        calls('figma_screenshot'),
        says('Hero section created with headline, subtitle, and CTA buttons.'),
      ]),
    );

    expect(t.events.toolCallsFor('figma_render_jsx')).toHaveLength(2);
    expect(t.events.toolSequence()).toEqual([
      'figma_status',
      'figma_render_jsx',
      'figma_render_jsx',
      'figma_screenshot',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════
// 3. Rule Adherence: Auto-Layout + Lint (Script 34)
// ═══════════════════════════════════════════════════════════

describe('Design quality — rule adherence', () => {
  it('creates auto-layout card then verifies with lint', async () => {
    const connector = createMockConnector();
    connector.createFromJsx.mockResolvedValue({ nodeId: '30:1', name: 'RuleCard' });
    connector.lintDesign.mockResolvedValue({
      success: true,
      issues: [],
      summary: { critical: 0, warnings: 0, info: 2 },
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      mockTools: {
        figma_render_jsx: JSON.stringify({ nodeId: '30:1', name: 'RuleCard' }),
        figma_get_file_data: JSON.stringify({
          document: {
            children: [
              {
                id: '30:1',
                name: 'RuleCard',
                type: 'FRAME',
                layoutMode: 'VERTICAL',
                paddingTop: 24,
                paddingRight: 24,
                paddingBottom: 24,
                paddingLeft: 24,
                itemSpacing: 20,
                children: [
                  { id: '30:2', name: 'Heading', type: 'TEXT' },
                  { id: '30:3', name: 'Body', type: 'TEXT' },
                  { id: '30:4', name: 'Button', type: 'FRAME' },
                ],
              },
            ],
          },
        }),
        figma_screenshot: JSON.stringify({ base64: 'iVBOR...' }),
        figma_lint: JSON.stringify({
          success: true,
          issues: [],
          summary: { critical: 0, warnings: 0, info: 2 },
        }),
      },
    });

    await t.run(
      when('Create a RuleCard with vertical auto-layout, 24px padding, 20px gap, heading + body + button', [
        calls('figma_render_jsx', {
          jsx: '<Frame name="RuleCard" layoutMode="VERTICAL" padding={24} itemSpacing={20}><Text name="Heading" fontSize={24}>Title</Text><Text name="Body" fontSize={16}>Body text</Text><Frame name="Button" cornerRadius={8} padding={12}><Text>Click me</Text></Frame></Frame>',
        }),
        calls('figma_get_file_data', { nodeId: '30:1' }),
        calls('figma_screenshot'),
        says(
          'RuleCard created. Auto-layout: vertical, padding 24px all sides, gap 20px. Children: Heading, Body, Button in correct order.',
        ),
      ]),
    );

    // Verify correct tool pipeline
    expect(t.events.toolSequence()).toEqual(['figma_render_jsx', 'figma_get_file_data', 'figma_screenshot']);

    // Second turn: lint
    await t.run(
      when('Lint the RuleCard', [
        calls('figma_lint', { nodeId: '30:1' }),
        says('Lint passed: 0 critical, 0 warnings, 2 info items.'),
      ]),
    );

    expect(t.events.toolCallsFor('figma_lint')).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════
// 4. Cross-Tool Chain (Script 35)
// ═══════════════════════════════════════════════════════════

describe('Design quality — cross-tool chain', () => {
  it('discover → instantiate → modify → screenshot → lint', async () => {
    t = await createBottegaTestSession({
      mockTools: {
        figma_search_components: JSON.stringify([{ id: '40:1', name: 'Card', type: 'COMPONENT' }]),
        figma_instantiate: JSON.stringify({ nodeId: '40:10', name: 'Card Instance' }),
        figma_set_fills: JSON.stringify({ success: true, nodeId: '40:10' }),
        figma_resize: JSON.stringify({ success: true, nodeId: '40:10' }),
        figma_screenshot: JSON.stringify({ base64: 'iVBOR...' }),
        figma_lint: JSON.stringify({ success: true, issues: [], summary: { critical: 0 } }),
      },
    });

    // Step 1: Discover
    await t.run(
      when('Find available components', [
        calls('figma_search_components', { query: '*' }),
        says('Found 1 component: Card.'),
      ]),
    );

    // Step 2: Instantiate
    await t.run(
      when('Instantiate the Card component', [
        calls('figma_instantiate', { componentId: '40:1' }),
        says('Card instance created.'),
      ]),
    );

    // Step 3: Modify
    await t.run(
      when('Change the instance fill to red and resize to 240x56', [
        calls('figma_set_fills', { nodeId: '40:10', fills: [{ type: 'SOLID', color: '#E11D48' }] }),
        calls('figma_resize', { nodeId: '40:10', width: 240, height: 56 }),
        calls('figma_screenshot'),
        says('Instance modified: red fill, 240x56.'),
      ]),
    );

    // Step 4: Lint
    await t.run(
      when('Lint the modified instance', [
        calls('figma_lint', { nodeId: '40:10' }),
        says('Lint passed with no critical issues.'),
      ]),
    );

    // Full chain verification
    const allTools = t.events.toolSequence();
    expect(allTools).toEqual([
      'figma_search_components',
      'figma_instantiate',
      'figma_set_fills',
      'figma_resize',
      'figma_screenshot',
      'figma_lint',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════
// 5. Batch Operations (Script 36)
// ═══════════════════════════════════════════════════════════

describe('Design quality — batch operations', () => {
  it('applies batch fills across multiple elements', async () => {
    const connector = createMockConnector();
    connector.batchSetFills.mockResolvedValue({
      success: true,
      results: [
        { nodeId: '50:1', success: true },
        { nodeId: '50:2', success: true },
        { nodeId: '50:3', success: true },
      ],
    });

    t = await createBottegaTestSession({
      toolDeps: { connector },
      mockTools: {
        figma_batch_set_fills: JSON.stringify({
          success: true,
          results: [
            { nodeId: '50:1', success: true },
            { nodeId: '50:2', success: true },
            { nodeId: '50:3', success: true },
          ],
        }),
        figma_screenshot: JSON.stringify({ base64: 'iVBOR...' }),
      },
    });

    await t.run(
      when('Change the primary color to #E11D48 across all 3 cards', [
        calls('figma_batch_set_fills', {
          updates: [
            { nodeId: '50:1', fills: [{ type: 'SOLID', color: '#E11D48' }] },
            { nodeId: '50:2', fills: [{ type: 'SOLID', color: '#E11D48' }] },
            { nodeId: '50:3', fills: [{ type: 'SOLID', color: '#E11D48' }] },
          ],
        }),
        calls('figma_screenshot'),
        says('Primary color updated to #E11D48 across all 3 cards.'),
      ]),
    );

    expect(t.events.toolCallsFor('figma_batch_set_fills')).toHaveLength(1);
    expect(t.events.toolSequence()).toEqual(['figma_batch_set_fills', 'figma_screenshot']);
  });
});

// ═══════════════════════════════════════════════════════════
// 6. Multi-Screen Consistency (Script 37)
// ═══════════════════════════════════════════════════════════

describe('Design quality — multi-screen consistency', () => {
  it('applies consistent nav bar changes across 3 screens with batch tools', async () => {
    t = await createBottegaTestSession({
      mockTools: {
        figma_get_file_data: JSON.stringify({
          document: {
            children: [
              { id: '60:1', name: 'Home', type: 'FRAME' },
              { id: '60:2', name: 'Settings', type: 'FRAME' },
              { id: '60:3', name: 'Profile', type: 'FRAME' },
            ],
          },
        }),
        figma_execute: JSON.stringify({ success: true }),
        figma_batch_set_fills: JSON.stringify({
          success: true,
          results: [
            { nodeId: '60:11', success: true },
            { nodeId: '60:21', success: true },
            { nodeId: '60:31', success: true },
          ],
        }),
        figma_batch_set_text: JSON.stringify({
          success: true,
          results: [
            { nodeId: '60:12', success: true },
            { nodeId: '60:22', success: true },
            { nodeId: '60:32', success: true },
          ],
        }),
        figma_screenshot: JSON.stringify({ base64: 'iVBOR...' }),
      },
    });

    // Step 1: Add nav bars to each screen
    await t.run(
      when('Add an identical navigation bar to each of the 3 screens', [
        calls('figma_get_file_data', { depth: 1 }),
        calls('figma_execute'),
        calls('figma_execute'),
        calls('figma_execute'),
        calls('figma_screenshot'),
        says('Navigation bar added to Home, Settings, and Profile screens.'),
      ]),
    );

    // Step 2: Batch color change across all nav bars
    await t.run(
      when('Change the nav bar background to #1A1A2E across all screens', [
        calls('figma_batch_set_fills', {
          updates: [
            { nodeId: '60:11', fills: [{ type: 'SOLID', color: '#1A1A2E' }] },
            { nodeId: '60:21', fills: [{ type: 'SOLID', color: '#1A1A2E' }] },
            { nodeId: '60:31', fills: [{ type: 'SOLID', color: '#1A1A2E' }] },
          ],
        }),
        calls('figma_screenshot'),
        says('Nav bar color updated to #1A1A2E across all 3 screens.'),
      ]),
    );

    // Verify batch tool was used (not individual set_fills per screen)
    expect(t.events.toolCallsFor('figma_batch_set_fills')).toHaveLength(1);
  });
});
