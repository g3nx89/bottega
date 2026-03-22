import { describe, expect, it, vi } from 'vitest';
import {
  CompressionMetricsCollector,
  categorizeToolName,
  type ToolCompressionEvent,
} from '../../src/main/compression/metrics.js';

// Mock the logger to avoid pino initialization issues in tests
vi.mock('../../src/figma/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

// Override METRICS_DIR by mocking fs operations to use temp dir
// Instead, we test the public API and verify via getSessionMetrics()

function makeEvent(overrides: Partial<ToolCompressionEvent> = {}): ToolCompressionEvent {
  return {
    toolName: 'figma_set_fills',
    category: 'mutation',
    charsBefore: 800,
    charsAfter: 40,
    estimatedTokensBefore: 200,
    estimatedTokensAfter: 10,
    compressionRatio: 0.95,
    hadError: false,
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('categorizeToolName', () => {
  it('categorizes mutation tools', () => {
    expect(categorizeToolName('figma_set_fills')).toBe('mutation');
    expect(categorizeToolName('figma_delete')).toBe('mutation');
    expect(categorizeToolName('figma_clone')).toBe('mutation');
    expect(categorizeToolName('figma_instantiate')).toBe('mutation');
  });

  it('categorizes jsx render tools as mutation (they produce node IDs)', () => {
    expect(categorizeToolName('figma_render_jsx')).toBe('mutation');
    expect(categorizeToolName('figma_create_icon')).toBe('mutation');
    expect(categorizeToolName('figma_bind_variable')).toBe('mutation');
  });

  it('categorizes discovery tools', () => {
    expect(categorizeToolName('figma_get_file_data')).toBe('discovery');
    expect(categorizeToolName('figma_design_system')).toBe('discovery');
    expect(categorizeToolName('figma_search_components')).toBe('discovery');
  });

  it('categorizes execute tool', () => {
    expect(categorizeToolName('figma_execute')).toBe('execute');
  });

  it('categorizes screenshot tools', () => {
    expect(categorizeToolName('figma_screenshot')).toBe('screenshot');
  });

  it('returns other for unknown tools', () => {
    expect(categorizeToolName('unknown_tool')).toBe('other');
    expect(categorizeToolName('figma_status')).toBe('other');
  });
});

describe('CompressionMetricsCollector', () => {
  it('initializes with correct defaults', () => {
    const collector = new CompressionMetricsCollector('session-1', 'claude-sonnet-4-6', 1_000_000);
    const metrics = collector.getSessionMetrics();
    expect(metrics.sessionId).toBe('session-1');
    expect(metrics.modelId).toBe('claude-sonnet-4-6');
    expect(metrics.contextWindowSize).toBe(1_000_000);
    expect(metrics.totalTurns).toBe(0);
    expect(metrics.totalToolCalls).toBe(0);
    expect(metrics.totalTokensSaved).toBe(0);
    expect(metrics.compactionTriggered).toBe(false);
  });

  it('recordToolCompression accumulates tool calls', () => {
    const collector = new CompressionMetricsCollector('s1', 'model', 200_000);
    collector.recordToolCompression(makeEvent());
    collector.recordToolCompression(makeEvent({ toolName: 'figma_resize', category: 'mutation' }));
    collector.recordToolCompression(
      makeEvent({
        toolName: 'figma_execute',
        category: 'execute',
        charsBefore: 5000,
        charsAfter: 5000,
        estimatedTokensBefore: 1250,
        estimatedTokensAfter: 1250,
        compressionRatio: 0,
      }),
    );

    const metrics = collector.getSessionMetrics();
    expect(metrics.totalToolCalls).toBe(3);
  });

  it('calculates total token savings correctly', () => {
    const collector = new CompressionMetricsCollector('s1', 'model', 200_000);
    collector.recordToolCompression(makeEvent({ estimatedTokensBefore: 200, estimatedTokensAfter: 10 }));
    collector.recordToolCompression(makeEvent({ estimatedTokensBefore: 500, estimatedTokensAfter: 50 }));

    const metrics = collector.getSessionMetrics();
    expect(metrics.totalTokensSaved).toBe(190 + 450);
  });

  it('routes tool calls by category', () => {
    const collector = new CompressionMetricsCollector('s1', 'model', 200_000);
    collector.recordToolCompression(makeEvent({ category: 'mutation' }));
    collector.recordToolCompression(makeEvent({ category: 'mutation' }));
    collector.recordToolCompression(makeEvent({ category: 'discovery' }));

    const metrics = collector.getSessionMetrics();
    expect(metrics.toolCallsByCategory['mutation']).toBe(2);
    expect(metrics.toolCallsByCategory['discovery']).toBe(1);
  });

  it('tracks compression by category', () => {
    const collector = new CompressionMetricsCollector('s1', 'model', 200_000);
    collector.recordToolCompression(
      makeEvent({
        category: 'mutation',
        estimatedTokensBefore: 200,
        estimatedTokensAfter: 10,
      }),
    );
    collector.recordToolCompression(
      makeEvent({
        category: 'mutation',
        estimatedTokensBefore: 300,
        estimatedTokensAfter: 15,
      }),
    );

    const metrics = collector.getSessionMetrics();
    expect(metrics.compressionByCategory['mutation']).toEqual({
      totalBefore: 500,
      totalAfter: 25,
    });
  });

  it('recordContextUsage tracks peak', () => {
    const collector = new CompressionMetricsCollector('s1', 'model', 200_000);
    collector.recordContextUsage(50_000);
    collector.recordContextUsage(120_000);
    collector.recordContextUsage(80_000);

    const metrics = collector.getSessionMetrics();
    expect(metrics.peakContextTokens).toBe(120_000);
  });

  it('recordTurn increments turn count', () => {
    const collector = new CompressionMetricsCollector('s1', 'model', 200_000);
    collector.recordTurn();
    collector.recordTurn();
    collector.recordTurn();
    expect(collector.getSessionMetrics().totalTurns).toBe(3);
  });

  it('recordCompaction sets flag', () => {
    const collector = new CompressionMetricsCollector('s1', 'model', 200_000);
    expect(collector.getSessionMetrics().compactionTriggered).toBe(false);
    collector.recordCompaction();
    expect(collector.getSessionMetrics().compactionTriggered).toBe(true);
  });

  it('recordModelSwitch increments count', () => {
    const collector = new CompressionMetricsCollector('s1', 'model', 200_000);
    collector.recordModelSwitch();
    collector.recordModelSwitch();
    expect(collector.getSessionMetrics().modelSwitchCount).toBe(2);
  });

  it('getSessionMetrics returns a copy', () => {
    const collector = new CompressionMetricsCollector('s1', 'model', 200_000);
    const m1 = collector.getSessionMetrics();
    collector.recordTurn();
    const m2 = collector.getSessionMetrics();
    expect(m1.totalTurns).toBe(0);
    expect(m2.totalTurns).toBe(1);
  });

  it('flush with empty buffer is a no-op', async () => {
    const collector = new CompressionMetricsCollector('s1', 'model', 200_000);
    await expect(collector.flush()).resolves.toBeUndefined();
  });
});
