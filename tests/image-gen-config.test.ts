import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_IMAGEGEN_API_KEY, effectiveApiKey } from '../src/main/image-gen/config.js';

describe('image-gen config', () => {
  describe('effectiveApiKey', () => {
    it('should return custom key when set', () => {
      expect(effectiveApiKey({ apiKey: 'custom-key-123' })).toBe('custom-key-123');
    });

    it('should return DEFAULT_IMAGEGEN_API_KEY when no custom key', () => {
      expect(effectiveApiKey({})).toBe(DEFAULT_IMAGEGEN_API_KEY);
    });

    it('should return DEFAULT_IMAGEGEN_API_KEY when apiKey is empty string', () => {
      expect(effectiveApiKey({ apiKey: '' })).toBe(DEFAULT_IMAGEGEN_API_KEY);
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
