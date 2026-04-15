import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { effectiveApiKey } from '../../../src/main/image-gen/config.js';

describe('image-gen config', () => {
  describe('effectiveApiKey', () => {
    it('returns the user-provided key when set', () => {
      expect(effectiveApiKey({ apiKey: 'custom-key-123' })).toBe('custom-key-123');
    });

    it('returns empty string when no key is set (image gen disabled)', () => {
      expect(effectiveApiKey({})).toBe('');
    });

    it('returns empty string when apiKey is the empty string', () => {
      expect(effectiveApiKey({ apiKey: '' })).toBe('');
    });
  });

  describe('save + load roundtrip via real filesystem', () => {
    let tmpDir: string;
    let tmpConfigPath: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bottega-test-'));
      tmpConfigPath = path.join(tmpDir, 'imagegen.json');
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should roundtrip settings through the filesystem', () => {
      const settings = { apiKey: 'roundtrip-key', model: 'gemini-2.0-flash' };

      fs.writeFileSync(tmpConfigPath, JSON.stringify(settings), 'utf8');
      const loaded = JSON.parse(fs.readFileSync(tmpConfigPath, 'utf8'));

      expect(loaded).toEqual(settings);
      expect(effectiveApiKey(loaded)).toBe('roundtrip-key');
    });
  });
});
