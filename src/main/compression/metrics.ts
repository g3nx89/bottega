/**
 * Compression metrics collection — JSONL append-only persistence.
 *
 * Records per-tool-call compression events and per-session aggregates.
 * Data is used to calibrate Phase 2-3 thresholds and monitor compression health.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChildLogger } from '../../figma/logger.js';

const log = createChildLogger({ component: 'compression-metrics' });

const METRICS_DIR = path.join(os.homedir(), '.bottega', 'metrics');
const AUTO_FLUSH_THRESHOLD = 20;
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB rotation threshold

/** Rotate a JSONL file if it exceeds MAX_FILE_SIZE_BYTES. */
async function rotateIfNeeded(filePath: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE_BYTES) {
      const rotated = `${filePath}.${new Date().toISOString().slice(0, 10)}`;
      await fs.rename(filePath, rotated);
    }
  } catch {
    // File doesn't exist yet or stat failed — nothing to rotate
  }
}

// ── Event types ─────────────────────────────────

export interface ToolCompressionEvent {
  toolName: string;
  category: ToolCategory;
  charsBefore: number;
  charsAfter: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  compressionRatio: number;
  hadError: boolean;
  largeResult?: boolean;
  timestamp: number;
}

export interface SessionMetrics {
  sessionId: string;
  modelId: string;
  contextWindowSize: number;
  totalTurns: number;
  totalToolCalls: number;
  totalTokensSaved: number;
  peakContextTokens: number;
  compactionTriggered: boolean;
  modelSwitchCount: number;
  durationMs: number;
  toolCallsByCategory: Record<string, number>;
  compressionByCategory: Record<string, { totalBefore: number; totalAfter: number }>;
}

export type ToolCategory = 'mutation' | 'discovery' | 'screenshot' | 'execute' | 'other';

// ── Category routing ────────────────────────────

export const CATEGORY_MAP: Record<string, ToolCategory> = {
  figma_set_fills: 'mutation',
  figma_set_strokes: 'mutation',
  figma_set_text: 'mutation',
  figma_set_image_fill: 'mutation',
  figma_resize: 'mutation',
  figma_move: 'mutation',
  figma_create_child: 'mutation',
  figma_clone: 'mutation',
  figma_delete: 'mutation',
  figma_rename: 'mutation',
  figma_instantiate: 'mutation',
  figma_set_instance_properties: 'mutation',
  figma_arrange_component_set: 'mutation',
  figma_setup_tokens: 'mutation',
  figma_render_jsx: 'mutation',
  figma_create_icon: 'mutation',
  figma_bind_variable: 'mutation',
  figma_batch_set_text: 'mutation',
  figma_batch_set_fills: 'mutation',
  figma_batch_transform: 'mutation',
  figma_auto_layout: 'mutation',
  figma_set_variant: 'mutation',
  figma_set_text_style: 'mutation',
  figma_set_effects: 'mutation',
  figma_set_opacity: 'mutation',
  figma_set_corner_radius: 'mutation',
  figma_scan_text_nodes: 'discovery',
  figma_set_annotations: 'mutation',
  figma_screenshot: 'screenshot',
  figma_screenshot_rest: 'screenshot',
  figma_get_file_data: 'discovery',
  figma_search_components: 'discovery',
  figma_get_library_components: 'discovery',
  figma_get_component_details: 'discovery',
  figma_get_component_deep: 'discovery',
  figma_analyze_component_set: 'discovery',
  figma_design_system: 'discovery',
  figma_status: 'discovery',
  figma_get_selection: 'discovery',
  figma_get_annotations: 'discovery',
  figma_get_annotation_categories: 'discovery',
  figma_lint: 'discovery',
  figma_execute: 'execute',
  task_create: 'other',
  task_update: 'other',
  task_list: 'other',
};

export function categorizeToolName(toolName: string): ToolCategory {
  return CATEGORY_MAP[toolName] ?? 'other';
}

// ── Collector ───────────────────────────────────

export class CompressionMetricsCollector {
  private sessionMetrics: SessionMetrics;
  private buffer: string[] = [];
  private startTime: number;
  private dirEnsured = false;

  constructor(sessionId: string, modelId: string, contextWindowSize: number) {
    this.startTime = Date.now();
    this.sessionMetrics = {
      sessionId,
      modelId,
      contextWindowSize,
      totalTurns: 0,
      totalToolCalls: 0,
      totalTokensSaved: 0,
      peakContextTokens: 0,
      compactionTriggered: false,
      modelSwitchCount: 0,
      durationMs: 0,
      toolCallsByCategory: {},
      compressionByCategory: {},
    };
  }

  recordToolCompression(event: ToolCompressionEvent): void {
    this.sessionMetrics.totalToolCalls++;
    this.sessionMetrics.totalTokensSaved += event.estimatedTokensBefore - event.estimatedTokensAfter;

    const cat = event.category;
    this.sessionMetrics.toolCallsByCategory[cat] = (this.sessionMetrics.toolCallsByCategory[cat] || 0) + 1;

    if (!this.sessionMetrics.compressionByCategory[cat]) {
      this.sessionMetrics.compressionByCategory[cat] = { totalBefore: 0, totalAfter: 0 };
    }
    const cc = this.sessionMetrics.compressionByCategory[cat];
    cc.totalBefore += event.estimatedTokensBefore;
    cc.totalAfter += event.estimatedTokensAfter;

    this.buffer.push(JSON.stringify(event));

    if (this.buffer.length >= AUTO_FLUSH_THRESHOLD) {
      this.flush().catch((err) => log.warn({ err }, 'Metrics auto-flush failed'));
    }
  }

  recordContextUsage(inputTokens: number): void {
    if (inputTokens > this.sessionMetrics.peakContextTokens) {
      this.sessionMetrics.peakContextTokens = inputTokens;
    }
  }

  recordTurn(): void {
    this.sessionMetrics.totalTurns++;
  }

  recordCompaction(): void {
    this.sessionMetrics.compactionTriggered = true;
  }

  recordModelSwitch(): void {
    this.sessionMetrics.modelSwitchCount++;
  }

  getSessionMetrics(): SessionMetrics {
    return { ...this.sessionMetrics };
  }

  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    await fs.mkdir(METRICS_DIR, { recursive: true });
    this.dirEnsured = true;
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const lines = this.buffer.splice(0);
    try {
      await this.ensureDir();
      const eventsFile = path.join(METRICS_DIR, 'compression-events.jsonl');
      await rotateIfNeeded(eventsFile);
      await fs.appendFile(eventsFile, lines.join('\n') + '\n');
    } catch (err) {
      log.warn({ err }, 'Failed to write compression events');
    }
  }

  async finalize(durationMs?: number): Promise<void> {
    this.sessionMetrics.durationMs = durationMs ?? Date.now() - this.startTime;
    await this.flush();

    try {
      await this.ensureDir();
      const sessionsFile = path.join(METRICS_DIR, 'sessions.jsonl');
      await fs.appendFile(sessionsFile, JSON.stringify(this.sessionMetrics) + '\n');
      log.info(
        {
          turns: this.sessionMetrics.totalTurns,
          toolCalls: this.sessionMetrics.totalToolCalls,
          tokensSaved: this.sessionMetrics.totalTokensSaved,
        },
        'Session metrics finalized',
      );
    } catch (err) {
      log.warn({ err }, 'Failed to write session metrics');
    }
  }
}
