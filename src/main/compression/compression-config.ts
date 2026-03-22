/**
 * Compression configuration and user-selectable profiles.
 *
 * Each profile tunes compression behavior for a specific type of design session.
 * The active profile can be switched at runtime via IPC — the extension factory
 * reads the live config on every tool_result event.
 */

// ── Config interface ────────────────────────────

export interface CompressionConfig {
  /** Compress mutation tool success results to "OK node=X:Y" */
  compressMutationResults: boolean;
  /** Return compact design system (hex colors, summary components) vs full raw */
  compactDesignSystem: boolean;
  /** Tree projection detail level: standard omits extras, detailed keeps fontSize/opacity/effects */
  treeProjectionDetail: 'standard' | 'detailed';
  /** Prepend extracted node IDs to figma_execute results */
  executeIdExtraction: boolean;
  /** Design system cache TTL in ms */
  designSystemCacheTtlMs: number;
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
      'Compresses mutation results and projects the node tree into compact form. ' +
      'Design system data is cached and compacted. Ideal for 10-30 turn sessions.',
    config: {
      compressMutationResults: true,
      compactDesignSystem: true,
      treeProjectionDetail: 'standard',
      executeIdExtraction: true,
      designSystemCacheTtlMs: 60_000,
    },
  },
  creative: {
    id: 'creative',
    label: 'Creative',
    description:
      'For intensive design sessions. When creating many elements (full forms, entire pages, ' +
      'component sets with variants), the agent runs dozens of mutations with few re-fetches. ' +
      'Maximizes compression to keep context clean during long sessions (30+ turns). ' +
      'Uses shorter cache TTLs and compact design system to minimize stale data.',
    config: {
      compressMutationResults: true,
      compactDesignSystem: true,
      treeProjectionDetail: 'standard',
      executeIdExtraction: true,
      designSystemCacheTtlMs: 30_000,
    },
  },
  exploration: {
    id: 'exploration',
    label: 'Exploration',
    description:
      'For analysis and auditing existing files. When exploring file structure, ' +
      'doing design reviews, or analyzing components and tokens. The agent needs more ' +
      'detail in nodes (fontSize, opacity, effects) and design system (full variable values ' +
      'per mode). Mutations are still compressed since they are rare in this type of session.',
    config: {
      compressMutationResults: true,
      compactDesignSystem: false,
      treeProjectionDetail: 'detailed',
      executeIdExtraction: true,
      designSystemCacheTtlMs: 60_000,
    },
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    description:
      'For quick fixes and debugging. Short sessions (< 10 turns) where mutation compression is disabled. ' +
      'All mutation results pass through in full form. Tree data is still projected in detailed mode. ' +
      'Also useful for diagnosing tool issues — you can see exactly what Figma returns for mutations. ' +
      'Design system caching remains active to avoid duplicate calls.',
    config: {
      compressMutationResults: false,
      compactDesignSystem: false,
      treeProjectionDetail: 'detailed',
      executeIdExtraction: true,
      designSystemCacheTtlMs: 60_000,
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
