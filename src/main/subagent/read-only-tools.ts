/**
 * Read-only tool filtering for subagents.
 *
 * Derives the read-only tool set from CATEGORY_MAP (single source of truth).
 * Imports ALL tool factories (matching createFigmaTools in tools/index.ts)
 * so new read-only tools added to any factory are automatically included.
 */

import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { CATEGORY_MAP } from '../compression/metrics.js';
import { createAnnotationTools } from '../tools/annotations.js';
import { createBatchTools } from '../tools/batch.js';
import { createComponentTools } from '../tools/components.js';
import { createCoreTools } from '../tools/core.js';
import { createDiscoveryTools } from '../tools/discovery.js';
import type { ToolDeps } from '../tools/index.js';
import { withAbortCheck } from '../tools/index.js';
import { createLayoutTools } from '../tools/layout.js';
import { createManipulationTools } from '../tools/manipulation.js';
import { createStyleTools } from '../tools/style.js';
import { createTokenTools } from '../tools/tokens.js';
// Note: jsx-render and image-gen are excluded entirely (all mutation/generation)

/**
 * Tool names classified as read-only: 'discovery' + 'screenshot' categories.
 * Derived from CATEGORY_MAP — no manual allowlist to maintain.
 */
export const READ_ONLY_TOOL_NAMES = new Set(
  Object.entries(CATEGORY_MAP)
    .filter(([, cat]) => cat === 'discovery' || cat === 'screenshot')
    .map(([name]) => name),
);

/**
 * Create read-only tools for a subagent session.
 * Instantiates ALL tool factories then filters to the read-only set.
 * This ensures new read-only tools added to any factory are automatically picked up.
 * No OperationQueue needed since read-only tools don't mutate.
 */
export function createReadOnlyTools(deps: ToolDeps): ToolDefinition[] {
  const allTools = [
    ...createCoreTools(deps),
    ...createDiscoveryTools(deps),
    ...createComponentTools(deps),
    ...createBatchTools(deps),
    ...createManipulationTools(deps),
    ...createTokenTools(deps),
    ...createLayoutTools(deps),
    ...createStyleTools(deps),
    ...createAnnotationTools(deps),
  ];
  return allTools.filter((t) => READ_ONLY_TOOL_NAMES.has(t.name)).map(withAbortCheck);
}
