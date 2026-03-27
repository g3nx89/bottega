/**
 * Design system cache with compact/raw access.
 *
 * Caches figma_design_system results in memory and returns either compact
 * or raw data depending on the active compression profile.
 */

import { rgbaToHex } from './color-utils.js';

// ── Compact interfaces ───────────────────────────

export interface CompactVariableCollection {
  name: string;
  modes: string[];
  vars: Record<string, { type: string; values: Record<string, string | number | boolean> }>;
}

export interface CompactComponent {
  name: string;
  key: string;
  variants?: string[];
  props?: string[];
}

export interface CompactDesignSystem {
  variables: CompactVariableCollection[];
  components: CompactComponent[];
}

// ── Compaction logic ─────────────────────────────

function isColorValue(v: unknown): v is { r: number; g: number; b: number; a?: number } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'r' in v &&
    'g' in v &&
    'b' in v &&
    typeof (v as any).r === 'number' &&
    typeof (v as any).g === 'number' &&
    typeof (v as any).b === 'number'
  );
}

function convertValue(value: unknown): string | number | boolean {
  if (isColorValue(value)) {
    return rgbaToHex(value);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

export function compactDesignSystem(raw: any): CompactDesignSystem {
  const rawVariables: any[] = Array.isArray(raw?.variables) ? raw.variables : [];
  const rawComponents: any[] = Array.isArray(raw?.components) ? raw.components : [];

  const variables: CompactVariableCollection[] = rawVariables.map((collection: any) => {
    const modeList: Array<{ modeId: string; name: string }> = Array.isArray(collection.modes) ? collection.modes : [];
    const modeNames = modeList.map((m) => m.name);

    // Build a modeId → modeName lookup for value keys
    const modeIdToName: Record<string, string> = {};
    for (const m of modeList) {
      modeIdToName[m.modeId] = m.name;
    }

    // Variables may be embedded objects or referenced by variableIds
    const embeddedVars: any[] = Array.isArray(collection.variables) ? collection.variables : [];

    const vars: Record<string, { type: string; values: Record<string, string | number | boolean> }> = {};

    for (const variable of embeddedVars) {
      const varName: string = variable.name ?? '';
      const resolvedType: string = variable.resolvedType ?? variable.type ?? 'UNKNOWN';
      const valuesByMode: Record<string, unknown> = variable.valuesByMode ?? {};

      const values: Record<string, string | number | boolean> = {};
      for (const [modeId, value] of Object.entries(valuesByMode)) {
        const modeName = modeIdToName[modeId] ?? modeId;
        values[modeName] = convertValue(value);
      }

      vars[varName] = { type: resolvedType, values };
    }

    return {
      name: collection.name ?? '',
      modes: modeNames,
      vars,
    };
  });

  // Group components by componentSetName when available
  const setVariants: Record<string, string[]> = {};
  for (const comp of rawComponents) {
    const setName: string | undefined = comp.componentSetName;
    if (setName) {
      if (!setVariants[setName]) setVariants[setName] = [];
      setVariants[setName].push(comp.name ?? '');
    }
  }

  const components: CompactComponent[] = rawComponents.map((comp: any) => {
    const result: CompactComponent = {
      name: comp.name ?? '',
      key: comp.key ?? '',
    };

    const setName: string | undefined = comp.componentSetName;
    if (setName && setVariants[setName]) {
      result.variants = setVariants[setName];
    }

    const compProps = comp.componentProperties;
    if (compProps && typeof compProps === 'object') {
      const propNames = Object.keys(compProps);
      if (propNames.length > 0) {
        result.props = propNames;
      }
    }

    return result;
  });

  return { variables, components };
}

// ── Cache ────────────────────────────────────────

interface CacheEntry {
  compact: CompactDesignSystem;
  raw: any;
  timestamp: number;
}

const DEFAULT_FILE_KEY = '__global__'; // nosemgrep: hard-coded-password — sentinel value, not a password

export class DesignSystemCache {
  private entries = new Map<string, CacheEntry>();
  private readonly getTtlMs: () => number;

  constructor(ttlMs: number | (() => number) = 60_000) {
    this.getTtlMs = typeof ttlMs === 'function' ? ttlMs : () => ttlMs;
  }

  get(compact: true, fileKey?: string): CompactDesignSystem | null;
  get(compact: false, fileKey?: string): unknown | null;
  get(compact: boolean, fileKey?: string): CompactDesignSystem | unknown | null;
  get(compact: boolean, fileKey?: string): CompactDesignSystem | unknown | null {
    const key = fileKey || DEFAULT_FILE_KEY;
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp >= this.getTtlMs()) {
      this.entries.delete(key);
      return null;
    }
    return compact ? entry.compact : entry.raw;
  }

  set(raw: any, fileKey?: string): { compact: CompactDesignSystem; raw: any } {
    const compact = compactDesignSystem(raw);
    this.entries.set(fileKey || DEFAULT_FILE_KEY, { compact, raw, timestamp: Date.now() });
    return { compact, raw };
  }

  /** Invalidate a specific file's cache, or all caches if no fileKey. */
  invalidate(fileKey?: string): void {
    if (fileKey) {
      this.entries.delete(fileKey);
    } else {
      this.entries.clear();
    }
  }

  isValid(fileKey?: string): boolean {
    const key = fileKey || DEFAULT_FILE_KEY;
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (Date.now() - entry.timestamp >= this.getTtlMs()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }
}
