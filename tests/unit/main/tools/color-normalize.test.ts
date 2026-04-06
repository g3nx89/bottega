import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OperationQueue } from '../../../../src/main/operation-queue.js';
import { createJsxRenderTools } from '../../../../src/main/tools/jsx-render.js';
import { createMockConnector } from '../../../helpers/mock-connector.js';

/**
 * normalizeHexColor is a private function in jsx-render.ts.
 * We test it indirectly via figma_create_icon, which calls
 * normalizeHexColor(params.color ?? '#000000') before passing
 * the result to connector.createIcon().
 */

function createTestDeps() {
  const connector = createMockConnector();
  const operationQueue = new OperationQueue();
  return {
    connector,
    operationQueue,
    wsServer: {} as any,
    figmaAPI: {} as any,
    designSystemCache: {} as any,
    configManager: {} as any,
    fileKey: 'test',
  };
}

// Mock the icon-loader module so we don't need real Iconify fetches
vi.mock('../../../../src/main/icon-loader.js', () => ({
  loadIconSvg: vi.fn().mockResolvedValue('<svg></svg>'),
  resolveIcons: vi.fn().mockResolvedValue(undefined),
}));

describe('normalizeHexColor (via figma_create_icon)', () => {
  let deps: ReturnType<typeof createTestDeps>;
  let tool: any;

  beforeEach(() => {
    deps = createTestDeps();
    const tools = createJsxRenderTools(deps);
    tool = tools.find((t: any) => t.name === 'figma_create_icon');
  });

  /**
   * Helper: execute figma_create_icon with a given color and return
   * the color argument that was passed to connector.createIcon().
   */
  async function getPassedColor(inputColor: string): Promise<string> {
    await tool.execute('call1', { name: 'mdi:home', color: inputColor }, null, null, null);
    // connector.createIcon(svg, size, color, opts) — color is 3rd arg
    return deps.connector.createIcon.mock.calls[deps.connector.createIcon.mock.calls.length - 1][2];
  }

  it('passes through valid hex color unchanged: #FF0000', async () => {
    const color = await getPassedColor('#FF0000');
    expect(color).toBe('#FF0000');
  });

  it('passes through short hex color unchanged: #abc', async () => {
    const color = await getPassedColor('#abc');
    expect(color).toBe('#abc');
  });

  it('converts CSS named color "red" to #FF0000', async () => {
    const color = await getPassedColor('red');
    expect(color).toBe('#FF0000');
  });

  it('converts CSS named color case-insensitively: "BLUE" to #0000FF', async () => {
    const color = await getPassedColor('BLUE');
    expect(color).toBe('#0000FF');
  });

  it('handles multi-word color "dark gray" by extracting known word "gray" to #808080', async () => {
    const color = await getPassedColor('dark gray');
    expect(color).toBe('#808080');
  });

  it('falls back to #000000 for completely unknown color names', async () => {
    const color = await getPassedColor('unknowncolor');
    expect(color).toBe('#000000');
  });

  it('converts "green" to #008000', async () => {
    const color = await getPassedColor('green');
    expect(color).toBe('#008000');
  });

  it('converts "Purple" (mixed case) to #800080', async () => {
    const color = await getPassedColor('Purple');
    expect(color).toBe('#800080');
  });

  it('defaults to #000000 when no color param is provided', async () => {
    await tool.execute('call1', { name: 'mdi:home' }, null, null, null);
    const color = deps.connector.createIcon.mock.calls[0][2];
    expect(color).toBe('#000000');
  });

  it('handles "light blue" by extracting known word "blue" to #0000FF', async () => {
    const color = await getPassedColor('light blue');
    expect(color).toBe('#0000FF');
  });
});
