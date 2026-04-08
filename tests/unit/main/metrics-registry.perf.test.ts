import { describe, expect, it, vi } from 'vitest';
import { MetricsRegistry } from '../../../src/main/metrics-registry.js';

/**
 * Performance budget for `MetricsRegistry.snapshot()` (Fase 4 / Task 4.12).
 *
 * The runner calls `getMetrics(page)` twice per QA step (before + after the
 * prompt), so a 25-step script makes 50 snapshot calls per run. We want each
 * call to be < 10ms typical, < 25ms p99 — anything slower starts adding visible
 * overhead to the QA pipeline.
 *
 * Synchronous-only — uses fake slot/ws state to keep the test deterministic.
 * Real Electron deps would add I/O variance unrelated to the registry itself.
 */
describe('MetricsRegistry perf', () => {
  it('snapshot() < 10ms mean and < 25ms p99 over 1000 iterations', () => {
    const reg = new MetricsRegistry();

    // Realistic state: 4 slots (max tabs), 10 distinct tools recorded, some
    // judge counters populated. This sizes the per-name maps similarly to a
    // long-running session.
    for (let i = 0; i < 4; i++) reg.recordJudgeTriggered();
    reg.recordJudgeSkipped('no-connector');
    reg.recordJudgeSkipped('no-mutations');
    reg.recordJudgeSkipped('disabled');
    for (const v of ['PASS', 'PASS', 'FAIL', 'UNKNOWN'] as const) reg.recordJudgeVerdict(v);
    const toolNames = [
      'figma_screenshot',
      'figma_set_fills',
      'figma_set_strokes',
      'figma_set_text',
      'figma_resize',
      'figma_move',
      'figma_create_child',
      'figma_render_jsx',
      'figma_get_file_data',
      'figma_search_components',
    ];
    for (const name of toolNames) {
      for (let i = 0; i < 5; i++) reg.recordToolCall(name, 80 + i, true);
    }

    const slots = Array.from({ length: 4 }, (_, i) => ({
      id: `slot-${i}`,
      fileKey: `fk${i}`,
      fileName: `File${i}.fig`,
      isStreaming: false,
      isConnected: true,
      modelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
      queueLength: 0,
      lastContextTokens: 1234 + i,
      turnIndex: 5,
      lastCompletedTurnIndex: 4,
      sessionToolHistory: new Set(toolNames),
      lastTurnToolNames: toolNames.slice(0, 3),
      lastTurnMutatedNodeIds: ['1:2', '1:3', '1:4'],
      judgeOverride: null as boolean | null,
    }));

    const slotInfos = slots.map((s) => ({
      id: s.id,
      fileKey: s.fileKey,
      fileName: s.fileName,
      isStreaming: s.isStreaming,
      isConnected: s.isConnected,
      modelConfig: s.modelConfig,
      queueLength: s.queueLength,
      lastContextTokens: s.lastContextTokens,
    }));

    const slotById = new Map(slots.map((s) => [s.id, s]));
    const deps = {
      slotManager: {
        listSlots: vi.fn(() => slotInfos),
        getSlot: vi.fn((id: string) => slotById.get(id)),
      } as any,
      wsServer: {
        getConnectedFiles: vi.fn(() => [
          { fileKey: 'fk0', fileName: 'File0.fig', isActive: true },
          { fileKey: 'fk1', fileName: 'File1.fig', isActive: false },
        ]),
        getActiveFileKey: vi.fn(() => 'fk0'),
      } as any,
      getJudgeInProgress: () => new Set(['slot-2']) as ReadonlySet<string>,
    };

    // Warm-up: JIT compilation, allocations
    for (let i = 0; i < 50; i++) reg.snapshot(deps);

    const N = 1000;
    const samples: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      reg.snapshot(deps);
      samples[i] = performance.now() - t0;
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / N;
    const p99 = samples[Math.floor(N * 0.99)];

    expect(mean).toBeLessThan(10);
    expect(p99).toBeLessThan(25);
  });
});
