/**
 * Compression configuration and user-selectable profiles.
 *
 * Each profile tunes compression behavior for a specific type of design session.
 * The active profile can be switched at runtime via IPC — the extension factory
 * reads the live config on every tool_result event.
 */

import type { SemanticMode } from './semantic-modes.js';

// ── Config interface ────────────────────────────

export interface CompressionConfig {
  /** Compress mutation tool success results to "OK node=X:Y" */
  compressMutationResults: boolean;
  /** Return compact design system (hex colors, summary components) vs full raw */
  compactDesignSystem: boolean;
  /** Default semantic mode for figma_get_file_data when not specified by the LLM */
  defaultSemanticMode: SemanticMode;
  /** Prepend extracted node IDs to figma_execute results */
  executeIdExtraction: boolean;
  /** Design system cache TTL in ms */
  designSystemCacheTtlMs: number;
  /** Output format for discovery tool results */
  outputFormat: 'json' | 'yaml';
}

// ── Profile types ───────────────────────────────

export type CompressionProfile = 'balanced' | 'creative' | 'exploration' | 'minimal';

export interface CompressionProfileDef {
  id: CompressionProfile;
  label: string;
  /** Extended description shown in settings UI (tooltip/popover) */
  description: string;
  config: CompressionConfig;
}

// ── Profile definitions ─────────────────────────

export const COMPRESSION_PROFILES: Record<CompressionProfile, CompressionProfileDef> = {
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    description:
      'Default profile. Balances token savings and information completeness. ' +
      'Best for most sessions: component design, layout creation, feedback iteration. ' +
      'Compresses mutation results and extracts the node tree with semantic modes. ' +
      'YAML output for token efficiency. Design system data is cached and compacted. Ideal for 10-30 turn sessions.',
    config: {
      compressMutationResults: true,
      compactDesignSystem: true,
      defaultSemanticMode: 'full',
      executeIdExtraction: true,
      designSystemCacheTtlMs: 60_000,
      outputFormat: 'yaml',
    },
  },
  creative: {
    id: 'creative',
    label: 'Creative',
    description:
      'For intensive design sessions. When creating many elements (full forms, entire pages, ' +
      'component sets with variants), the agent runs dozens of mutations with few re-fetches. ' +
      'Maximizes compression to keep context clean during long sessions (30+ turns). ' +
      'YAML output for token efficiency. Uses shorter cache TTLs and compact design system to minimize stale data.',
    config: {
      compressMutationResults: true,
      compactDesignSystem: true,
      defaultSemanticMode: 'full',
      executeIdExtraction: true,
      designSystemCacheTtlMs: 30_000,
      outputFormat: 'yaml',
    },
  },
  exploration: {
    id: 'exploration',
    label: 'Exploration',
    description:
      'For analysis and auditing existing files. When exploring file structure, ' +
      'doing design reviews, or analyzing components and tokens. The agent needs full ' +
      'detail in nodes and design system (full variable values per mode). ' +
      'JSON output for maximum detail. Mutations are still compressed since they are rare in this type of session.',
    config: {
      compressMutationResults: true,
      compactDesignSystem: false,
      defaultSemanticMode: 'full',
      executeIdExtraction: true,
      designSystemCacheTtlMs: 60_000,
      outputFormat: 'json',
    },
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    description:
      'For quick fixes and debugging. Short sessions (< 10 turns) where mutation compression is disabled. ' +
      'All mutation results pass through in full form. JSON output for easy debugging. ' +
      'Also useful for diagnosing tool issues — you can see exactly what Figma returns for mutations. ' +
      'Design system caching remains active to avoid duplicate calls.',
    config: {
      compressMutationResults: false,
      compactDesignSystem: false,
      defaultSemanticMode: 'full',
      executeIdExtraction: true,
      designSystemCacheTtlMs: 60_000,
      outputFormat: 'json',
    },
  },
};

export const DEFAULT_PROFILE: CompressionProfile = 'balanced';

const VALID_PROFILES = new Set<string>(Object.keys(COMPRESSION_PROFILES));
const PROFILE_LIST: CompressionProfileDef[] = Object.values(COMPRESSION_PROFILES);

// ── Runtime manager ─────────────────────────────

export class CompressionConfigManager {
  private activeProfile: CompressionProfile = DEFAULT_PROFILE;

  getActiveConfig(): CompressionConfig {
    return COMPRESSION_PROFILES[this.activeProfile].config;
  }

  getActiveProfile(): CompressionProfile {
    return this.activeProfile;
  }

  setProfile(profile: CompressionProfile): void {
    if (!VALID_PROFILES.has(profile)) {
      throw new Error(`Invalid compression profile: "${profile}". Valid: ${[...VALID_PROFILES].join(', ')}`);
    }
    this.activeProfile = profile;
  }

  getProfiles(): CompressionProfileDef[] {
    return PROFILE_LIST;
  }
}
