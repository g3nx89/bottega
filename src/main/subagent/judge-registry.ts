/**
 * Judge registry — single source of truth for all micro-judge definitions.
 * Pure data + helper functions, zero I/O.
 */

import type { ActivationTier, MicroJudgeId, PrefetchDataKey } from './types.js';

export interface MicroJudgeDefinition {
  id: MicroJudgeId;
  label: string;
  description: string;
  defaultModel: string;
  tiers: Set<ActivationTier>;
  dataNeeds: PrefetchDataKey[];
  /** For narrow tier: specific tool categories that trigger this judge. */
  triggerCategories?: Set<string>;
}

const JUDGE_REGISTRY = new Map<MicroJudgeId, MicroJudgeDefinition>([
  [
    'alignment',
    {
      id: 'alignment',
      label: 'Alignment',
      description: 'Layout precision, auto-layout, pixel offsets',
      defaultModel: 'claude-haiku-4-5',
      tiers: new Set<ActivationTier>(['full', 'visual']),
      dataNeeds: ['fileData'],
    },
  ],
  [
    'token_compliance',
    {
      id: 'token_compliance',
      label: 'Token Compliance',
      description: 'Design token usage, hardcoded values, lint violations',
      defaultModel: 'claude-haiku-4-5',
      tiers: new Set<ActivationTier>(['full', 'visual', 'narrow']),
      dataNeeds: ['lint', 'designSystem'],
      triggerCategories: new Set(['ds']),
    },
  ],
  [
    'visual_hierarchy',
    {
      id: 'visual_hierarchy',
      label: 'Visual Hierarchy',
      description: 'Typography scale, primary action prominence',
      defaultModel: 'claude-haiku-4-5',
      tiers: new Set<ActivationTier>(['full', 'visual']),
      dataNeeds: ['screenshot', 'designSystem'],
    },
  ],
  [
    'completeness',
    {
      id: 'completeness',
      label: 'Completeness',
      description: 'All requested elements present vs task description',
      defaultModel: 'claude-haiku-4-5',
      tiers: new Set<ActivationTier>(['full']),
      dataNeeds: ['screenshot', 'fileData'],
    },
  ],
  [
    'consistency',
    {
      id: 'consistency',
      label: 'Consistency',
      description: 'Uniform spacing, sizing across similar elements',
      defaultModel: 'claude-haiku-4-5',
      tiers: new Set<ActivationTier>(['full', 'visual']),
      dataNeeds: ['fileData', 'lint'],
    },
  ],
  [
    'naming',
    {
      id: 'naming',
      label: 'Naming',
      description: 'Semantic names, no auto-generated names, consistent convention',
      defaultModel: 'claude-haiku-4-5',
      tiers: new Set<ActivationTier>(['full', 'narrow']),
      dataNeeds: ['fileData'],
      triggerCategories: new Set(['mutation']),
    },
  ],
  [
    'componentization',
    {
      id: 'componentization',
      label: 'Componentization',
      description: 'Duplicate detection, library usage, detached instances',
      defaultModel: 'claude-haiku-4-5',
      tiers: new Set<ActivationTier>(['full']),
      dataNeeds: ['fileData', 'libraryComponents'],
    },
  ],
]);

/** All micro-judge IDs in registry order. */
export const ALL_MICRO_JUDGE_IDS: MicroJudgeId[] = [...JUDGE_REGISTRY.keys()];

/** Get a judge definition by ID. Throws if not found. */
export function getJudgeDefinition(id: MicroJudgeId): MicroJudgeDefinition {
  const def = JUDGE_REGISTRY.get(id);
  if (!def) throw new Error(`Unknown micro-judge: ${id}`);
  return def;
}

/**
 * Determine which judges should run for a given tier and tool set.
 * Filters by tier membership, structural-only constraint, and narrow trigger categories.
 *
 * @param toolCategories Optional set of tool category strings (from categorizeToolName).
 *   Required for narrow tier to filter by triggerCategories. If omitted, narrow tier
 *   includes all judges that match the tier.
 */
export function getActiveJudges(
  tier: ActivationTier,
  toolNames: string[],
  disabledJudges?: Set<MicroJudgeId>,
  toolCategories?: Set<string>,
): MicroJudgeId[] {
  const toolNameSet = new Set(toolNames);
  const hasRename = toolNameSet.has('figma_rename');

  const result: MicroJudgeId[] = [];
  for (const [id, def] of JUDGE_REGISTRY) {
    // Skip disabled judges
    if (disabledJudges?.has(id)) continue;

    // Must be in this tier
    if (!def.tiers.has(tier)) continue;

    // For narrow tier with triggerCategories: only activate if a matching category is present
    if (tier === 'narrow' && def.triggerCategories) {
      // Naming judge triggers on rename tool specifically
      if (id === 'naming' && hasRename) {
        result.push(id);
        continue;
      }
      // Check if any tool category matches this judge's trigger categories
      if (toolCategories) {
        const hasMatch = [...def.triggerCategories].some((cat) => toolCategories.has(cat));
        if (!hasMatch) continue;
      }
    }

    result.push(id);
  }

  return result;
}

/** Union all data needs for a set of judges. */
export function getDataNeedsForJudges(judgeIds: MicroJudgeId[]): Set<PrefetchDataKey> {
  const needs = new Set<PrefetchDataKey>();
  for (const id of judgeIds) {
    const def = JUDGE_REGISTRY.get(id);
    if (def) {
      for (const need of def.dataNeeds) {
        needs.add(need);
      }
    }
  }
  return needs;
}
