import { describe, expect, it, vi } from 'vitest';
import { CompressionConfigManager } from '../../../../src/main/compression/compression-config.js';
import { createCompressionExtensionFactory } from '../../../../src/main/compression/extension-factory.js';
import { CompressionMetricsCollector } from '../../../../src/main/compression/metrics.js';

// Mock the logger
vi.mock('../../../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

function createMockPi() {
  const handlers: Record<string, (...args: any[]) => any> = {};
  return {
    on(event: string, handler: (...args: any[]) => any) {
      handlers[event] = handler;
    },
    getHandler(event: string) {
      return handlers[event];
    },
  };
}

function makeToolResultEvent(overrides: any = {}) {
  return {
    toolName: 'figma_set_fills',
    toolCallId: 'tc_1',
    content: [{ type: 'text', text: JSON.stringify({ success: true, node: { id: '42:15', name: 'Rect' } }) }],
    isError: false,
    ...overrides,
  };
}

function setup(profile: 'balanced' | 'creative' | 'exploration' | 'minimal' = 'balanced') {
  const configManager = new CompressionConfigManager();
  configManager.setProfile(profile);
  const metrics = new CompressionMetricsCollector('test', 'model', 200_000);
  const factory = createCompressionExtensionFactory(configManager, metrics);
  const mockPi = createMockPi();
  factory(mockPi);
  const handler = mockPi.getHandler('tool_result');
  return { configManager, metrics, handler };
}

describe('createCompressionExtensionFactory', () => {
  it('registers a tool_result handler', () => {
    const configManager = new CompressionConfigManager();
    const metrics = new CompressionMetricsCollector('test', 'model', 200_000);
    const factory = createCompressionExtensionFactory(configManager, metrics);
    const mockPi = createMockPi();
    factory(mockPi);
    expect(mockPi.getHandler('tool_result')).toBeDefined();
  });
});

describe('tool_result handler — mutation compression', () => {
  it('compresses mutation tool results in balanced profile', async () => {
    const { handler } = setup('balanced');
    const result = await handler(makeToolResultEvent());
    expect(result).not.toBeNull();
    expect(result.content[0].text).toBe('OK node=42:15');
  });

  it('does NOT compress mutations in minimal profile', async () => {
    const { handler } = setup('minimal');
    const result = await handler(makeToolResultEvent());
    expect(result).toBeNull();
  });

  it('passes through error results unmodified', async () => {
    const { handler } = setup('balanced');
    const result = await handler(makeToolResultEvent({ isError: true }));
    expect(result).toBeNull();
  });

  it('does not compress non-mutation tools', async () => {
    const { handler } = setup('balanced');
    const result = await handler(
      makeToolResultEvent({
        toolName: 'figma_status',
        content: [{ type: 'text', text: '{"connected":true}' }],
      }),
    );
    expect(result).toBeNull();
  });
});

describe('tool_result handler — execute enrichment', () => {
  it('enriches figma_execute results with ID prefix', async () => {
    const { handler } = setup('balanced');
    const result = await handler(
      makeToolResultEvent({
        toolName: 'figma_execute',
        content: [{ type: 'text', text: '{"nodeId":"99:10","name":"Frame"}' }],
      }),
    );
    expect(result).not.toBeNull();
    expect(result.content[0].text).toContain('Returned IDs: 99:10');
    expect(result.content[0].text).toContain('"nodeId":"99:10"');
  });

  it('preserves full execute result (no truncation)', async () => {
    const { handler } = setup('balanced');
    const largeText = '{"id":"1:2",' + 'x'.repeat(50_000) + '}';
    const result = await handler(
      makeToolResultEvent({
        toolName: 'figma_execute',
        content: [{ type: 'text', text: largeText }],
      }),
    );
    expect(result).not.toBeNull();
    expect(result.content[0].text).toContain('Returned IDs: 1:2');
    // Full content preserved — length is original + prefix
    expect(result.content[0].text.length).toBeGreaterThan(50_000);
  });

  it('does not modify execute result without IDs', async () => {
    const { handler } = setup('balanced');
    const result = await handler(
      makeToolResultEvent({
        toolName: 'figma_execute',
        content: [{ type: 'text', text: '{"status":"ok"}' }],
      }),
    );
    expect(result).toBeNull();
  });

  it('does not modify execute errors', async () => {
    const { handler } = setup('balanced');
    const result = await handler(
      makeToolResultEvent({
        toolName: 'figma_execute',
        content: [{ type: 'text', text: '{"error":"boom","id":"1:2"}' }],
        isError: true,
      }),
    );
    expect(result).toBeNull();
  });
});

describe('tool_result handler — metrics', () => {
  it('records metrics for every tool call', async () => {
    const { handler, metrics } = setup('balanced');
    await handler(makeToolResultEvent());
    await handler(
      makeToolResultEvent({
        toolName: 'figma_execute',
        content: [{ type: 'text', text: '{"ok":true}' }],
      }),
    );
    const session = metrics.getSessionMetrics();
    expect(session.totalToolCalls).toBe(2);
  });

  it('flags large figma_execute results in metrics', async () => {
    const { handler, metrics } = setup('balanced');
    const spy = vi.spyOn(metrics, 'recordToolCompression');
    const largeText = '{"id":"1:2",' + 'x'.repeat(15_000) + '}';
    await handler(
      makeToolResultEvent({
        toolName: 'figma_execute',
        content: [{ type: 'text', text: largeText }],
      }),
    );
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ largeResult: true }));
  });

  it('does not flag small figma_execute results', async () => {
    const { handler, metrics } = setup('balanced');
    const spy = vi.spyOn(metrics, 'recordToolCompression');
    await handler(
      makeToolResultEvent({
        toolName: 'figma_execute',
        content: [{ type: 'text', text: '{"id":"1:2"}' }],
      }),
    );
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ largeResult: undefined }));
  });
});

describe('tool_result handler — profile switching', () => {
  it('respects profile change mid-session', async () => {
    const { handler, configManager } = setup('balanced');

    // Balanced: mutations compressed
    const r1 = await handler(makeToolResultEvent());
    expect(r1).not.toBeNull();
    expect(r1.content[0].text).toBe('OK node=42:15');

    // Switch to minimal: mutations NOT compressed
    configManager.setProfile('minimal');
    const r2 = await handler(makeToolResultEvent());
    expect(r2).toBeNull();

    // Switch back to balanced
    configManager.setProfile('balanced');
    const r3 = await handler(makeToolResultEvent());
    expect(r3).not.toBeNull();
  });

  it('respects executeIdExtraction config', async () => {
    const { handler, configManager } = setup('balanced');

    // balanced has executeIdExtraction: true
    const r1 = await handler(
      makeToolResultEvent({
        toolName: 'figma_execute',
        content: [{ type: 'text', text: '{"id":"5:6"}' }],
      }),
    );
    expect(r1).not.toBeNull();

    // All profiles currently have executeIdExtraction: true,
    // but we can verify the config is read each time
    const config = configManager.getActiveConfig();
    expect(config.executeIdExtraction).toBe(true);
  });
});

describe('tool_result handler — semantic extraction compatibility', () => {
  it('mutation compression works regardless of outputFormat (balanced=yaml)', async () => {
    const { handler, configManager } = setup('balanced');
    expect(configManager.getActiveConfig().outputFormat).toBe('yaml');
    const result = await handler(makeToolResultEvent());
    expect(result).not.toBeNull();
    expect(result.content[0].text).toBe('OK node=42:15');
  });

  it('mutation compression works regardless of outputFormat (exploration=json)', async () => {
    const { handler, configManager } = setup('exploration');
    expect(configManager.getActiveConfig().outputFormat).toBe('json');
    const result = await handler(makeToolResultEvent());
    expect(result).not.toBeNull();
    expect(result.content[0].text).toBe('OK node=42:15');
  });

  it('metrics record charsBefore/charsAfter correctly for any format', async () => {
    const { handler, metrics } = setup('balanced');
    const spy = vi.spyOn(metrics, 'recordToolCompression');

    await handler(makeToolResultEvent());

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        charsBefore: expect.any(Number),
        charsAfter: expect.any(Number),
      }),
    );
    const call = spy.mock.calls[0][0] as any;
    expect(call.charsBefore).toBeGreaterThan(0);
    expect(call.charsAfter).toBeGreaterThan(0);
    expect(call.charsAfter).toBeLessThan(call.charsBefore);
  });

  it('all profiles have defaultSemanticMode and outputFormat fields', () => {
    for (const profile of ['balanced', 'creative', 'exploration', 'minimal'] as const) {
      const { configManager } = setup(profile);
      const config = configManager.getActiveConfig();
      expect(config.defaultSemanticMode).toBeDefined();
      expect(config.outputFormat).toBeDefined();
      expect(['json', 'yaml']).toContain(config.outputFormat);
    }
  });

  it('execute enrichment unaffected by outputFormat setting', async () => {
    const { handler, configManager } = setup('balanced');
    expect(configManager.getActiveConfig().outputFormat).toBe('yaml');

    const result = await handler(
      makeToolResultEvent({
        toolName: 'figma_execute',
        content: [{ type: 'text', text: '{"nodeId":"99:10","name":"Frame"}' }],
      }),
    );
    expect(result).not.toBeNull();
    expect(result.content[0].text).toContain('Returned IDs: 99:10');
  });
});
