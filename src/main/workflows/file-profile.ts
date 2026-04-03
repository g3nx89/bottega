/**
 * File Profile Persistence — Step 9
 *
 * Stores per-file Figma conventions and design system metadata in
 * ~/.bottega/profiles/<fileKey>.json. Used to inject profile directives
 * into the system prompt via deriveContextFromProfile → ContextInput.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface FigmaFileProfile {
  fileKey: string;
  fileName: string;
  lastScanned: string; // ISO date
  lastDsStatus: 'none' | 'partial' | 'active';
  conventions: {
    naming: {
      pageStyle: string; // e.g. 'PascalCase', 'lowercase', 'kebab-case'
      componentStyle: string; // e.g. 'PascalCase', 'slash-separated'
      variableStyle: string; // e.g. 'slash-separated', 'camelCase'
    };
    structure: {
      pageCount: number;
      hasSeparatorPages: boolean;
      hasFoundationsPages: boolean;
      hasCoverPage: boolean;
    };
    designSystem: {
      variableCollections: string[];
      componentSetCount: number;
      textStyleCount: number;
      effectStyleCount: number;
      paintStyleCount: number;
      hasPublishedLibrary: boolean;
    };
    tokens: {
      hasPrimitiveSemanticSplit: boolean;
      colorModes: string[];
      scopePattern: string; // 'specific' | 'all' | 'mixed'
      hasCodeSyntax: boolean;
    };
    workflow: {
      dsOrigin: 'created' | 'forked' | 'imported' | 'unknown';
      preferredMode: string; // interaction mode
      lastApprovedDsChangeAt?: string;
      reusablePatternCount: number;
    };
  };
}

/** Build convention directives for system prompt injection. */
export function buildProfileDirectives(profile: FigmaFileProfile): string[] {
  const directives: string[] = [];

  const { naming, designSystem, tokens } = profile.conventions;

  if (naming.variableStyle) {
    directives.push(
      `Variable naming: use ${naming.variableStyle} style (e.g. ${naming.variableStyle === 'slash-separated' ? 'colors/primary' : 'colorsPrimary'})`,
    );
  }
  if (naming.componentStyle) {
    directives.push(`Component naming: use ${naming.componentStyle} style`);
  }
  if (tokens.colorModes.length > 0) {
    directives.push(`Color modes: ${tokens.colorModes.join(', ')} — ALWAYS set values for all modes`);
  }
  if (designSystem.hasPublishedLibrary) {
    directives.push('This file has a published library — prefer instantiating over creating from scratch');
  }
  if (tokens.hasPrimitiveSemanticSplit) {
    directives.push('Token architecture: primitive + semantic split — maintain this pattern');
  }

  return directives;
}

/** Derive DesignWorkflowContext input from a file profile. */
export function deriveContextFromProfile(profile: FigmaFileProfile): {
  dsStatus: 'none' | 'partial' | 'active';
  libraryContext: 'none' | 'linked' | 'dominant';
  profileDirectives: string[];
} {
  const directives = buildProfileDirectives(profile);

  const ds = profile.conventions.designSystem;
  let libraryContext: 'none' | 'linked' | 'dominant' = 'none';
  if (ds.hasPublishedLibrary) {
    libraryContext = ds.componentSetCount > 10 ? 'dominant' : 'linked';
  }

  return {
    dsStatus: profile.lastDsStatus,
    libraryContext,
    profileDirectives: directives,
  };
}

/** Create a default empty profile for a new file. */
export function createEmptyProfile(fileKey: string, fileName: string): FigmaFileProfile {
  return {
    fileKey,
    fileName,
    lastScanned: new Date().toISOString(),
    lastDsStatus: 'none',
    conventions: {
      naming: { pageStyle: '', componentStyle: '', variableStyle: '' },
      structure: { pageCount: 0, hasSeparatorPages: false, hasFoundationsPages: false, hasCoverPage: false },
      designSystem: {
        variableCollections: [],
        componentSetCount: 0,
        textStyleCount: 0,
        effectStyleCount: 0,
        paintStyleCount: 0,
        hasPublishedLibrary: false,
      },
      tokens: { hasPrimitiveSemanticSplit: false, colorModes: [], scopePattern: 'mixed', hasCodeSyntax: false },
      workflow: { dsOrigin: 'unknown', preferredMode: 'execution', reusablePatternCount: 0 },
    },
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const PROFILES_DIR = path.join(os.homedir(), '.bottega', 'profiles');

/** Persist a profile to ~/.bottega/profiles/<fileKey>.json */
export async function saveProfile(profile: FigmaFileProfile): Promise<void> {
  await fs.mkdir(PROFILES_DIR, { recursive: true });
  const filePath = path.join(PROFILES_DIR, `${profile.fileKey}.json`);
  await fs.writeFile(filePath, JSON.stringify(profile, null, 2), 'utf-8');
}

/** Load a profile from disk; returns null if not found. */
export async function loadProfile(fileKey: string): Promise<FigmaFileProfile | null> {
  try {
    const filePath = path.join(PROFILES_DIR, `${fileKey}.json`);
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data) as FigmaFileProfile;
  } catch {
    return null;
  }
}
