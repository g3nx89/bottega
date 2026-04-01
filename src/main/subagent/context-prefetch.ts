/**
 * Context pre-fetch — gathers common data once before spawning parallel subagents.
 * Each subagent receives this as a briefing so it doesn't re-fetch the same data.
 */

import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { createChildLogger } from '../../figma/logger.js';
import type { PrefetchedContext } from './types.js';

const log = createChildLogger({ component: 'subagent-prefetch' });

/**
 * Call a named tool's execute function. Returns the text content or null on error.
 */
async function callTool(
  tools: ToolDefinition[],
  toolName: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string | null> {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    log.warn({ toolName }, 'Pre-fetch tool not found in tool set');
    return null;
  }
  try {
    // Bottega tools accept `any` as ctx — cast to satisfy ToolDefinition's ExtensionContext param
    const result = await (tool.execute as any)(`prefetch-${toolName}`, params, signal, undefined, undefined);
    // Extract text from result content array
    const content = result?.content;
    if (Array.isArray(content)) {
      const textPart = content.find((c: any) => c.type === 'text');
      return (textPart as any)?.text ?? null;
    }
    return null;
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') throw err;
    log.warn({ err, toolName }, 'Pre-fetch tool call failed');
    return null;
  }
}

/**
 * Pre-fetch common context data for subagents.
 * Runs 3 reads in parallel — all are independent.
 * Returns partial data on individual tool failures (does not throw).
 * Throws only on AbortError.
 */
export async function prefetchCommonContext(tools: ToolDefinition[], signal?: AbortSignal): Promise<PrefetchedContext> {
  // Screenshot omitted from prefetch: subagents take their own when needed.
  // Saves a WS roundtrip + PNG encode per batch.
  const [fileDataResult, designSystemResult] = await Promise.allSettled([
    callTool(tools, 'figma_get_file_data', {}, signal),
    callTool(tools, 'figma_design_system', {}, signal),
  ]);

  // Re-throw abort errors
  for (const r of [fileDataResult, designSystemResult]) {
    if (r.status === 'rejected' && (r.reason as Error)?.name === 'AbortError') {
      throw r.reason;
    }
  }

  return {
    screenshot: null,
    fileData: fileDataResult.status === 'fulfilled' ? fileDataResult.value : null,
    designSystem: designSystemResult.status === 'fulfilled' ? designSystemResult.value : null,
  };
}

/** Format pre-fetched context into a briefing string for subagent prompts. */
export function formatBriefing(context: PrefetchedContext): string {
  const sections: string[] = [];

  if (context.fileData) {
    sections.push(`## File Structure (briefing — verify via tools)\n${context.fileData}`);
  }
  if (context.designSystem) {
    sections.push(`## Design System (briefing — verify via tools)\n${context.designSystem}`);
  }
  // Screenshot is binary data — don't include as text. Subagents will take their own screenshots.
  if (context.screenshot) {
    sections.push(
      '## Screenshot\nA viewport screenshot was captured during pre-fetch. Take a fresh screenshot to verify current state.',
    );
  }

  return sections.length > 0
    ? `# Pre-fetched Briefing\n\n${sections.join('\n\n')}`
    : 'No pre-fetched data available. Start with direct observation.';
}
