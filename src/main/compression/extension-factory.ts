/**
 * Pi SDK extension factory for ingestion-time compression.
 *
 * Registers a `tool_result` event handler that:
 * 1. Compresses mutation tool results (profile-dependent)
 * 2. Enriches figma_execute results with extracted node IDs
 * 3. Records compression metrics for every tool call
 *
 * Reads the active config on every call — supports runtime profile switching.
 */

import type { CompressionConfigManager } from './compression-config.js';
import { enrichExecuteResult } from './execute-enricher.js';
import { type CompressionMetricsCollector, categorizeToolName } from './metrics.js';
import { compressMutationResult } from './mutation-compressor.js';

const CHARS_PER_TOKEN_ESTIMATE = 4;
const LARGE_RESULT_CHAR_THRESHOLD = 10_000;

/**
 * Creates a Pi SDK extension factory function.
 * Pass this to `DefaultResourceLoader({ extensionFactories: [...] })`.
 */
export function createCompressionExtensionFactory(
  configManager: CompressionConfigManager,
  metrics: CompressionMetricsCollector,
) {
  return (pi: { on: (event: string, handler: (event: any) => Promise<any> | any) => void }) => {
    pi.on('tool_result', async (event: any) => {
      try {
        const config = configManager.getActiveConfig();
        const originalText: string | undefined = event.content?.[0]?.text;
        const charsBefore = typeof originalText === 'string' ? originalText.length : 0;
        let result: { content: any[] } | null = null;

        // 1. Mutation compression (profile-dependent)
        if (config.compressMutationResults && !event.isError) {
          result = compressMutationResult(event.toolName, event.content, event.isError);
        }

        // 2. figma_execute — ID extraction only, NO truncation
        if (!result && event.toolName === 'figma_execute' && !event.isError && config.executeIdExtraction) {
          const enriched = enrichExecuteResult(event.content);
          if (enriched) {
            result = { content: enriched.content };
          }
        }

        // 3. Record metrics (always, even if no compression)
        const wasEnriched = result !== null && event.toolName === 'figma_execute';
        const charsAfter = wasEnriched
          ? charsBefore
          : (result?.content?.[0]?.text?.length ?? (typeof originalText === 'string' ? originalText.length : 0));
        const isLargeResult = event.toolName === 'figma_execute' && charsBefore > LARGE_RESULT_CHAR_THRESHOLD;

        metrics.recordToolCompression({
          toolName: event.toolName,
          category: categorizeToolName(event.toolName),
          charsBefore,
          charsAfter,
          estimatedTokensBefore: Math.ceil(charsBefore / CHARS_PER_TOKEN_ESTIMATE),
          estimatedTokensAfter: Math.ceil(charsAfter / CHARS_PER_TOKEN_ESTIMATE),
          compressionRatio: charsBefore > 0 ? 1 - charsAfter / charsBefore : 0,
          hadError: event.isError,
          largeResult: isLargeResult || undefined,
          timestamp: Date.now(),
        });

        return result; // null = no modification
      } catch {
        return null; // compression failure must never disrupt the agent session
      }
    });
  };
}
