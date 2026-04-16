import { describe, expect, it } from 'vitest';
import { AVAILABLE_MODELS, CONTEXT_SIZES, filterLevelsForModel } from '../../../src/main/agent.js';
import { migrateLegacyModelIds } from '../../../src/main/app-state-persistence.js';

describe('Pi SDK 0.67 migration surface', () => {
  describe('AVAILABLE_MODELS registry', () => {
    it('exposes claude-opus-4-7 under anthropic', () => {
      const ids = AVAILABLE_MODELS.anthropic.map((m) => m.id);
      expect(ids).toContain('claude-opus-4-7');
    });

    it('keeps claude-sonnet-4-6 and 4.6 opus variants for rollback', () => {
      const ids = AVAILABLE_MODELS.anthropic.map((m) => m.id);
      expect(ids).toContain('claude-sonnet-4-6');
      expect(ids).toContain('claude-opus-4-6');
      expect(ids).toContain('claude-opus-4-6-1m');
    });
  });

  describe('CONTEXT_SIZES', () => {
    it('records 1M window for claude-opus-4-7', () => {
      expect(CONTEXT_SIZES['claude-opus-4-7']).toBe(1_000_000);
    });
  });

  describe('filterLevelsForModel adaptive thinking', () => {
    const all = ['minimal', 'low', 'medium', 'high', 'xhigh'];

    it('drops minimal on claude-opus-4-7 (adaptive collapses it into low)', () => {
      const levels = filterLevelsForModel('claude-opus-4-7', all);
      expect(levels).not.toContain('minimal');
    });

    it('keeps xhigh on claude-opus-4-7', () => {
      const levels = filterLevelsForModel('claude-opus-4-7', all);
      expect(levels).toContain('xhigh');
    });

    it('keeps xhigh on claude-sonnet-4-6', () => {
      const levels = filterLevelsForModel('claude-sonnet-4-6', all);
      expect(levels).toContain('xhigh');
      expect(levels).not.toContain('minimal');
    });
  });

  describe('migrateLegacyModelIds', () => {
    const base = { version: 1, savedAt: '2026-04-16', activeSlotFileKey: null as string | null };

    it('maps claude-sonnet-4-20250514 → claude-sonnet-4-6', () => {
      const state = {
        ...base,
        slots: [
          {
            fileKey: 'f1',
            fileName: 'F',
            modelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
            promptQueue: [],
          },
        ],
      };
      const out = migrateLegacyModelIds(state);
      expect(out.slots[0]!.modelConfig.modelId).toBe('claude-sonnet-4-6');
      expect(out._migratedModelIds).toBe(true);
    });

    it('maps claude-opus-4-20250514 → claude-opus-4-6', () => {
      const state = {
        ...base,
        slots: [
          {
            fileKey: 'f1',
            fileName: 'F',
            modelConfig: { provider: 'anthropic', modelId: 'claude-opus-4-20250514' },
            promptQueue: [],
          },
        ],
      };
      expect(migrateLegacyModelIds(state).slots[0]!.modelConfig.modelId).toBe('claude-opus-4-6');
    });

    it('maps dated 4.5 family to 4.6 family', () => {
      const state = {
        ...base,
        slots: [
          {
            fileKey: 'a',
            fileName: '',
            modelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929' },
            promptQueue: [],
          },
          {
            fileKey: 'b',
            fileName: '',
            modelConfig: { provider: 'anthropic', modelId: 'claude-opus-4-5-20250929' },
            promptQueue: [],
          },
        ],
      };
      const out = migrateLegacyModelIds(state);
      expect(out.slots[0]!.modelConfig.modelId).toBe('claude-sonnet-4-6');
      expect(out.slots[1]!.modelConfig.modelId).toBe('claude-opus-4-6');
    });

    it('leaves non-legacy ids untouched', () => {
      const state = {
        ...base,
        slots: [
          {
            fileKey: 'f1',
            fileName: '',
            modelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4-6' },
            promptQueue: [],
          },
        ],
      };
      expect(migrateLegacyModelIds(state).slots[0]!.modelConfig.modelId).toBe('claude-sonnet-4-6');
    });

    it('is idempotent via _migratedModelIds flag', () => {
      const state = {
        ...base,
        _migratedModelIds: true,
        slots: [
          {
            fileKey: 'f1',
            fileName: '',
            modelConfig: { provider: 'anthropic', modelId: 'claude-sonnet-4-20250514' },
            promptQueue: [],
          },
        ],
      };
      expect(migrateLegacyModelIds(state).slots[0]!.modelConfig.modelId).toBe('claude-sonnet-4-20250514');
    });
  });
});
