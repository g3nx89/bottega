import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertPathWithin,
  validateCheckpointId,
  validateExternalCheckpointId,
  validateFileKey,
  validateScope,
  validateUndoToken,
} from '../../../../src/main/rewind/validation.js';

const VALID_UUID = '11111111-2222-3333-4444-555555555555';

describe('rewind validation', () => {
  describe('validateFileKey', () => {
    it('accepts alphanumeric keys up to 64 chars with _ and -', () => {
      expect(validateFileKey('abcXYZ_-0123')).toBe('abcXYZ_-0123');
      expect(validateFileKey('a'.repeat(64))).toHaveLength(64);
    });

    it('rejects empty, too-long, non-string, or unsafe keys', () => {
      expect(() => validateFileKey('')).toThrow('rewind: invalid fileKey');
      expect(() => validateFileKey('a'.repeat(65))).toThrow();
      expect(() => validateFileKey('has space')).toThrow();
      expect(() => validateFileKey('../evil')).toThrow();
      expect(() => validateFileKey(undefined)).toThrow();
      expect(() => validateFileKey(123)).toThrow();
    });
  });

  describe('validateCheckpointId', () => {
    it('accepts safe filenames up to 128 chars', () => {
      expect(validateCheckpointId('cp-123_abc')).toBe('cp-123_abc');
      expect(validateCheckpointId('a'.repeat(128))).toHaveLength(128);
    });

    it('rejects paths, dots, and separators', () => {
      expect(() => validateCheckpointId('a'.repeat(129))).toThrow();
      expect(() => validateCheckpointId('../foo')).toThrow();
      expect(() => validateCheckpointId('foo/bar')).toThrow();
      expect(() => validateCheckpointId('cp.json')).toThrow();
      expect(() => validateCheckpointId('')).toThrow();
    });
  });

  describe('validateExternalCheckpointId', () => {
    it('accepts canonical lowercase UUID', () => {
      expect(validateExternalCheckpointId(VALID_UUID)).toBe(VALID_UUID);
    });

    it('accepts uppercase hex UUID variants', () => {
      const upper = VALID_UUID.toUpperCase();
      expect(validateExternalCheckpointId(upper)).toBe(upper);
    });

    it('rejects non-UUID shapes', () => {
      expect(() => validateExternalCheckpointId('not-a-uuid')).toThrow('rewind: invalid checkpointId');
      expect(() => validateExternalCheckpointId(`${VALID_UUID}x`)).toThrow();
      expect(() => validateExternalCheckpointId('11111111-2222-3333-4444-55555555555')).toThrow();
      expect(() => validateExternalCheckpointId(42)).toThrow();
    });
  });

  describe('validateUndoToken', () => {
    it('accepts a valid UUID', () => {
      expect(validateUndoToken(VALID_UUID)).toBe(VALID_UUID);
    });

    it('rejects anything else', () => {
      expect(() => validateUndoToken('')).toThrow('rewind: invalid undoToken');
      expect(() => validateUndoToken('plain-string')).toThrow();
      expect(() => validateUndoToken(null)).toThrow();
    });
  });

  describe('validateScope', () => {
    it('accepts the two known scopes', () => {
      expect(validateScope('last-turn')).toBe('last-turn');
      expect(validateScope('to-checkpoint')).toBe('to-checkpoint');
    });

    it('rejects unknown or malformed scopes', () => {
      expect(() => validateScope('all')).toThrow('rewind: invalid scope');
      expect(() => validateScope('')).toThrow();
      expect(() => validateScope(null)).toThrow();
      expect(() => validateScope(['last-turn'])).toThrow();
    });
  });

  describe('assertPathWithin', () => {
    const root = path.resolve('/tmp/rewind-root');

    it('allows paths inside the root', () => {
      expect(() => assertPathWithin(root, path.join(root, 'file-1', 'cp-1.json'))).not.toThrow();
    });

    it('allows the exact root path', () => {
      expect(() => assertPathWithin(root, root)).not.toThrow();
    });

    it('rejects parent-directory escapes', () => {
      expect(() => assertPathWithin(root, path.join(root, '..', 'other'))).toThrow('rewind: path escape detected');
    });

    it('rejects sibling-prefix collisions', () => {
      // `/tmp/rewind-root-sibling` starts with `/tmp/rewind-root` but is not within it.
      expect(() => assertPathWithin(root, `${root}-sibling/file.json`)).toThrow('rewind: path escape detected');
    });
  });
});
