import { describe, expect, it, vi } from 'vitest';
import {
  buildProfileDirectives,
  createEmptyProfile,
  deriveContextFromProfile,
  type FigmaFileProfile,
  loadProfile,
  saveProfile,
} from '../../../../src/main/workflows/file-profile.js';

// Mock fs for persistence tests
vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn(),
  },
}));

function createTestProfile(overrides?: Partial<FigmaFileProfile>): FigmaFileProfile {
  return {
    fileKey: 'test-file-key',
    fileName: 'Test File',
    lastScanned: '2026-04-01T00:00:00.000Z',
    lastDsStatus: 'active',
    conventions: {
      naming: { pageStyle: 'PascalCase', componentStyle: 'PascalCase', variableStyle: 'slash-separated' },
      structure: { pageCount: 5, hasSeparatorPages: true, hasFoundationsPages: true, hasCoverPage: true },
      designSystem: {
        variableCollections: ['Primitives', 'Semantics'],
        componentSetCount: 15,
        textStyleCount: 8,
        effectStyleCount: 3,
        paintStyleCount: 12,
        hasPublishedLibrary: true,
      },
      tokens: {
        hasPrimitiveSemanticSplit: true,
        colorModes: ['Light', 'Dark'],
        scopePattern: 'specific',
        hasCodeSyntax: true,
      },
      workflow: { dsOrigin: 'created', preferredMode: 'execution', reusablePatternCount: 8 },
    },
    ...overrides,
  };
}

describe('buildProfileDirectives', () => {
  it('generates directives for slash-separated variables', () => {
    const profile = createTestProfile();
    const directives = buildProfileDirectives(profile);
    expect(directives.some((d) => d.includes('slash-separated'))).toBe(true);
  });

  it('includes color modes directive', () => {
    const profile = createTestProfile();
    const directives = buildProfileDirectives(profile);
    expect(directives.some((d) => d.includes('Light, Dark'))).toBe(true);
  });

  it('includes library directive for published libraries', () => {
    const profile = createTestProfile();
    const directives = buildProfileDirectives(profile);
    expect(directives.some((d) => d.includes('published library'))).toBe(true);
  });

  it('includes primitive/semantic split directive', () => {
    const profile = createTestProfile();
    const directives = buildProfileDirectives(profile);
    expect(directives.some((d) => d.includes('primitive + semantic'))).toBe(true);
  });

  it('returns empty for empty profile', () => {
    const profile = createEmptyProfile('key', 'name');
    const directives = buildProfileDirectives(profile);
    expect(directives).toEqual([]);
  });
});

describe('deriveContextFromProfile', () => {
  it('returns dsStatus from profile', () => {
    const profile = createTestProfile({ lastDsStatus: 'partial' });
    const ctx = deriveContextFromProfile(profile);
    expect(ctx.dsStatus).toBe('partial');
  });

  it('returns dominant library context for large libraries', () => {
    const profile = createTestProfile();
    const ctx = deriveContextFromProfile(profile);
    expect(ctx.libraryContext).toBe('dominant');
  });

  it('returns linked for small libraries', () => {
    const profile = createTestProfile();
    profile.conventions.designSystem.componentSetCount = 5;
    const ctx = deriveContextFromProfile(profile);
    expect(ctx.libraryContext).toBe('linked');
  });

  it('returns none when no published library', () => {
    const profile = createTestProfile();
    profile.conventions.designSystem.hasPublishedLibrary = false;
    const ctx = deriveContextFromProfile(profile);
    expect(ctx.libraryContext).toBe('none');
  });

  it('includes profile directives', () => {
    const profile = createTestProfile();
    const ctx = deriveContextFromProfile(profile);
    expect(ctx.profileDirectives.length).toBeGreaterThan(0);
  });
});

describe('createEmptyProfile', () => {
  it('creates profile with correct fileKey and fileName', () => {
    const profile = createEmptyProfile('abc123', 'My File');
    expect(profile.fileKey).toBe('abc123');
    expect(profile.fileName).toBe('My File');
    expect(profile.lastDsStatus).toBe('none');
  });
});

describe('persistence', () => {
  it('saveProfile writes JSON to disk', async () => {
    const profile = createTestProfile();
    const fsMock = await import('node:fs/promises');
    await saveProfile(profile);
    expect(fsMock.default.mkdir).toHaveBeenCalled();
    expect(fsMock.default.writeFile).toHaveBeenCalled();
  });

  it('loadProfile reads and parses JSON', async () => {
    const fsMock = await import('node:fs/promises');
    const profile = createTestProfile();
    (fsMock.default.readFile as any).mockResolvedValue(JSON.stringify(profile));
    const loaded = await loadProfile('test-file-key');
    expect(loaded?.fileKey).toBe('test-file-key');
  });

  it('loadProfile returns null for missing file', async () => {
    const fsMock = await import('node:fs/promises');
    (fsMock.default.readFile as any).mockRejectedValue(new Error('ENOENT'));
    const loaded = await loadProfile('missing-key');
    expect(loaded).toBeNull();
  });
});
