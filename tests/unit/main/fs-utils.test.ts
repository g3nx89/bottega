import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { quarantineFile, quarantineRoot, readJsonOrQuarantine } from '../../../src/main/fs-utils.js';

describe('fs-utils quarantine', () => {
  let tmpDir: string;
  let quarantineDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `bottega-fs-utils-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    quarantineDir = path.join(tmpDir, '.corrupted');
    mkdirSync(tmpDir, { recursive: true });
    process.env.BOTTEGA_QUARANTINE_ROOT = quarantineDir;
  });

  afterEach(() => {
    delete process.env.BOTTEGA_QUARANTINE_ROOT;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('quarantineRoot', () => {
    it('uses env override when set', () => {
      expect(quarantineRoot('/any/source.json')).toBe(quarantineDir);
    });

    it('falls back to sibling .corrupted when env unset', () => {
      delete process.env.BOTTEGA_QUARANTINE_ROOT;
      expect(quarantineRoot('/home/x/state.json')).toBe('/home/x/.corrupted');
    });
  });

  describe('quarantineFile', () => {
    it('moves an existing file into a timestamped dir', () => {
      const src = path.join(tmpDir, 'foo.json');
      writeFileSync(src, '{"a":1}');
      const dest = quarantineFile(src, 'test');
      expect(dest).not.toBeNull();
      expect(existsSync(src)).toBe(false);
      expect(existsSync(dest!)).toBe(true);
      expect(path.basename(dest!)).toBe('foo.json');
      expect(dest!.startsWith(quarantineDir)).toBe(true);
    });

    it('returns null for non-existent path without throwing', () => {
      expect(quarantineFile(path.join(tmpDir, 'missing.json'), 'test')).toBeNull();
    });
  });

  describe('readJsonOrQuarantine', () => {
    it('returns parsed value on well-formed JSON', () => {
      const p = path.join(tmpDir, 'good.json');
      writeFileSync(p, '{"a":42}');
      expect(readJsonOrQuarantine(p)).toEqual({ a: 42 });
      expect(existsSync(p)).toBe(true);
    });

    it('returns null and quarantines malformed JSON', () => {
      const p = path.join(tmpDir, 'bad.json');
      writeFileSync(p, '{broken');
      expect(readJsonOrQuarantine(p)).toBeNull();
      expect(existsSync(p)).toBe(false);
      const tsDirs = readdirSync(quarantineDir);
      expect(tsDirs.length).toBe(1);
      expect(readdirSync(path.join(quarantineDir, tsDirs[0]))).toContain('bad.json');
    });

    it('returns null and quarantines when validator rejects', () => {
      const p = path.join(tmpDir, 'wrong-shape.json');
      writeFileSync(p, '{"a":1}');
      const validator = (v: unknown): v is { b: string } =>
        typeof v === 'object' && v !== null && typeof (v as any).b === 'string';
      expect(readJsonOrQuarantine(p, validator)).toBeNull();
      expect(existsSync(p)).toBe(false);
    });

    it('returns null for non-existent file (no quarantine needed)', () => {
      const p = path.join(tmpDir, 'missing.json');
      expect(readJsonOrQuarantine(p)).toBeNull();
      expect(existsSync(quarantineDir)).toBe(false);
    });

    it('accepts well-formed JSON that passes validator', () => {
      const p = path.join(tmpDir, 'good-shape.json');
      writeFileSync(p, '{"b":"ok"}');
      const validator = (v: unknown): v is { b: string } =>
        typeof v === 'object' && v !== null && typeof (v as any).b === 'string';
      expect(readJsonOrQuarantine(p, validator)).toEqual({ b: 'ok' });
    });
  });
});
