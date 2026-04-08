/**
 * Context pre-fetch — gathers common data once before spawning parallel subagents.
 * Each subagent receives this as a briefing so it doesn't re-fetch the same data.
 */

import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { createChildLogger } from '../../figma/logger.js';
import { analyzeComponents } from './component-analysis.js';
import type { PrefetchDataKey, PrefetchedContext, ScreenshotImage } from './types.js';

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
    // W-001: Expected for subagent read-only tool sets — downgrade from warn to debug
    log.debug({ toolName }, 'Pre-fetch tool not found in tool set');
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
 * Call a named tool and extract the image content block (for screenshot).
 */
async function callToolForImage(
  tools: ToolDefinition[],
  toolName: string,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ScreenshotImage | null> {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    // W-001: Expected for subagent read-only tool sets — downgrade from warn to debug
    log.debug({ toolName }, 'Pre-fetch image tool not found');
    return null;
  }
  try {
    const result = await (tool.execute as any)(`prefetch-${toolName}`, params, signal, undefined, undefined);
    const content = result?.content;
    if (Array.isArray(content)) {
      const imagePart = content.find((c: any) => c.type === 'image');
      if (imagePart?.data) {
        return { type: 'image', data: imagePart.data, mimeType: imagePart.mimeType ?? 'image/png' };
      }
    }
    return null;
  } catch (err: unknown) {
    if ((err as Error)?.name === 'AbortError') throw err;
    log.warn({ err, toolName }, 'Pre-fetch image tool call failed');
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
    callTool(tools, 'figma_get_file_data', { mode: 'briefing' }, signal),
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
    lint: null,
    libraryComponents: null,
    componentAnalysis: null,
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

/**
 * Selective pre-fetch for micro-judges.
 * Only fetches data that the active judges actually need.
 * Runs component analysis as a post-processing step if libraryComponents is fetched.
 */
export async function prefetchForMicroJudges(
  tools: ToolDefinition[],
  neededData: Set<PrefetchDataKey>,
  signal?: AbortSignal,
  fileKey?: string,
  /**
   * UX-003: when provided, the prefetch screenshot is scoped to this node
   * instead of the viewport. This prevents judges from flagging unrelated
   * pre-existing canvas content as "missing" or "misaligned".
   */
  targetNodeId?: string,
): Promise<PrefetchedContext> {
  const result: PrefetchedContext = {
    screenshot: null,
    fileData: null,
    designSystem: null,
    lint: null,
    libraryComponents: null,
    componentAnalysis: null,
    targetNodeId: targetNodeId ?? null,
  };

  // Fetch screenshot separately (returns image, not text)
  let screenshotPromise: Promise<ScreenshotImage | null> | null = null;
  if (neededData.has('screenshot')) {
    // UX-003: pass nodeId when we know the affected target so the bridge
    // returns a cropped image of that node only. `zoom` is deliberately
    // omitted when scoped — the tool auto-fits the node to the frame.
    const screenshotParams = targetNodeId ? { nodeId: targetNodeId } : { zoom: 2 };
    screenshotPromise = callToolForImage(tools, 'figma_screenshot', screenshotParams, signal);
  }

  // Build parallel fetch list for text-based data
  const fetches: Array<{ key: PrefetchDataKey; promise: Promise<string | null> }> = [];
  if (neededData.has('fileData')) {
    fetches.push({ key: 'fileData', promise: callTool(tools, 'figma_get_file_data', { mode: 'full' }, signal) });
  }
  if (neededData.has('lint')) {
    fetches.push({ key: 'lint', promise: callTool(tools, 'figma_lint', {}, signal) });
  }
  if (neededData.has('designSystem')) {
    fetches.push({ key: 'designSystem', promise: callTool(tools, 'figma_design_system', {}, signal) });
  }
  if (neededData.has('libraryComponents') && fileKey) {
    fetches.push({
      key: 'libraryComponents',
      promise: callTool(tools, 'figma_get_library_components', { fileKey }, signal),
    });
  }

  // Execute all in parallel (text fetches + screenshot)
  const allPromises: Promise<any>[] = fetches.map((f) => f.promise);
  if (screenshotPromise) allPromises.push(screenshotPromise);

  const settled = await Promise.allSettled(allPromises);

  // Re-throw abort errors
  for (const r of settled) {
    if (r.status === 'rejected' && (r.reason as Error)?.name === 'AbortError') {
      throw r.reason;
    }
  }

  // Populate text results
  for (let i = 0; i < fetches.length; i++) {
    const s = settled[i]!;
    const key = fetches[i]!.key;
    if (s.status === 'fulfilled' && s.value != null) {
      (result as any)[key] = s.value;
    }
  }

  // Populate screenshot result
  if (screenshotPromise) {
    const screenshotResult = settled[fetches.length];
    if (screenshotResult?.status === 'fulfilled' && screenshotResult.value) {
      result.screenshot = screenshotResult.value;
    }
  }

  // Post-process: run component analysis if we have the data
  if (result.fileData && result.libraryComponents) {
    try {
      // Extract component names from library output — handles multiple formats:
      // - { components: [...], componentSets: [...] } (figma_get_library_components)
      // - [...] (plain array)
      // - newline-separated text
      let componentNames: string[] = [];
      try {
        const parsed = JSON.parse(result.libraryComponents);
        if (Array.isArray(parsed)) {
          componentNames = parsed.map((c: any) => (typeof c === 'string' ? c : (c.name ?? ''))).filter(Boolean);
        } else if (parsed && typeof parsed === 'object') {
          const extractNames = (arr: any[]) =>
            arr.map((c: any) => (typeof c === 'string' ? c : (c.name ?? ''))).filter(Boolean);
          if (Array.isArray(parsed.components)) {
            componentNames.push(...extractNames(parsed.components));
          }
          if (Array.isArray(parsed.componentSets)) {
            componentNames.push(...extractNames(parsed.componentSets));
          }
        }
      } catch {
        componentNames = result.libraryComponents
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
      }
      result.componentAnalysis = analyzeComponents(result.fileData, componentNames);
    } catch (err) {
      log.warn({ err }, 'Component analysis failed — skipping');
    }
  }

  return result;
}
