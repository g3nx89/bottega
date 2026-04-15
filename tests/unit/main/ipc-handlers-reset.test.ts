import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Temp bottega dir — injected via setupResetHandlers({ paths: ... }).
const tmpHome = path.join(os.tmpdir(), `bottega-reset-test-${Date.now()}`);
mkdirSync(tmpHome, { recursive: true });
const bottegaDir = path.join(tmpHome, '.bottega');
const appSupportDir = path.join(tmpHome, 'appsupport');
const logsDir = path.join(tmpHome, 'logs');

// Mock electron — dialog returns Continue (1) unless test overrides.
const dialogShowMessageBox = vi.fn().mockResolvedValue({ response: 1 });
const appRelaunch = vi.fn();
const appExit = vi.fn();
const handlers: Record<string, (...args: any[]) => any> = {};
vi.mock('electron', () => ({
  app: {
    relaunch: (...args: any[]) => appRelaunch(...args),
    exit: (...args: any[]) => appExit(...args),
  },
  dialog: { showMessageBox: (...args: any[]) => dialogShowMessageBox(...args) },
  ipcMain: {
    handle: (channel: string, fn: any) => {
      handlers[channel] = fn;
    },
  },
  safeStorage: { isEncryptionAvailable: () => false },
}));

// Mock agent module so OAUTH_PROVIDER_MAP is stable.
vi.mock('../../../src/main/agent.js', () => ({
  OAUTH_PROVIDER_MAP: { anthropic: 'anthropic', openai: 'openai-codex', google: 'google-gemini-cli' },
}));

import { setupResetHandlers } from '../../../src/main/ipc-handlers-reset.js';

function makeInfra() {
  return {
    authStorage: {
      logout: vi.fn(),
      remove: vi.fn(),
    },
  } as any;
}

function seed(files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(bottegaDir, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
}

describe('setupResetHandlers', () => {
  let infra: ReturnType<typeof makeInfra>;

  beforeEach(() => {
    rmSync(bottegaDir, { recursive: true, force: true });
    mkdirSync(bottegaDir, { recursive: true });
    infra = makeInfra();
    for (const k of Object.keys(handlers)) delete handlers[k];
    setupResetHandlers({ infra, paths: { bottegaDir, appSupportDir, logsDir } });
    dialogShowMessageBox.mockResolvedValue({ response: 1 });
    appRelaunch.mockClear();
    appExit.mockClear();
  });

  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  describe('app:reset-auth', () => {
    it('removes auth files and wipes authStorage for every known provider', async () => {
      seed({
        'auth-meta.json': '{}',
        'figma-auth.json': '{}',
        'last-auth-snapshot.json': '{}',
        'last-good-model.json': '{}',
        'sessions/abc.json': '{"msgs":[]}',
      });
      const res = await handlers['app:reset-auth']();
      expect(res.ok).toBe(true);
      expect(existsSync(path.join(bottegaDir, 'auth-meta.json'))).toBe(false);
      expect(existsSync(path.join(bottegaDir, 'figma-auth.json'))).toBe(false);
      expect(existsSync(path.join(bottegaDir, 'last-auth-snapshot.json'))).toBe(false);
      expect(existsSync(path.join(bottegaDir, 'last-good-model.json'))).toBe(false);
      // Sessions preserved.
      expect(existsSync(path.join(bottegaDir, 'sessions/abc.json'))).toBe(true);
      // Each provider logged out.
      expect(infra.authStorage.logout).toHaveBeenCalledWith('anthropic');
      expect(infra.authStorage.logout).toHaveBeenCalledWith('openai-codex');
      expect(infra.authStorage.logout).toHaveBeenCalledWith('google-gemini-cli');
    });

    it('is a no-op when user cancels the dialog', async () => {
      dialogShowMessageBox.mockResolvedValueOnce({ response: 0 });
      seed({ 'auth-meta.json': '{}' });
      const res = await handlers['app:reset-auth']();
      expect(res).toEqual({ ok: false, cancelled: true });
      expect(existsSync(path.join(bottegaDir, 'auth-meta.json'))).toBe(true);
      expect(infra.authStorage.logout).not.toHaveBeenCalled();
    });
  });

  describe('app:clear-history', () => {
    it('removes sessions + file-sessions.json but keeps auth', async () => {
      seed({
        'auth-meta.json': '{}',
        'figma-auth.json': '{}',
        'file-sessions.json': '{}',
        'sessions/abc.json': '{}',
        'subagent-runs/run1.json': '{}',
      });
      const res = await handlers['app:clear-history']();
      expect(res.ok).toBe(true);
      expect(existsSync(path.join(bottegaDir, 'sessions'))).toBe(false);
      expect(existsSync(path.join(bottegaDir, 'subagent-runs'))).toBe(false);
      expect(existsSync(path.join(bottegaDir, 'file-sessions.json'))).toBe(false);
      // Auth preserved.
      expect(existsSync(path.join(bottegaDir, 'auth-meta.json'))).toBe(true);
      expect(existsSync(path.join(bottegaDir, 'figma-auth.json'))).toBe(true);
      expect(infra.authStorage.logout).not.toHaveBeenCalled();
    });
  });

  describe('app:factory-reset', () => {
    it('wipes ~/.bottega, logs out every provider, and relaunches', async () => {
      seed({
        'auth-meta.json': '{}',
        'sessions/abc.json': '{}',
        'random.json': '{}',
      });
      const res = await handlers['app:factory-reset']();
      expect(res.ok).toBe(true);
      expect(existsSync(bottegaDir)).toBe(false);
      expect(infra.authStorage.logout).toHaveBeenCalledWith('openai-codex');
      expect(appRelaunch).toHaveBeenCalledTimes(1);
      expect(appExit).toHaveBeenCalledWith(0);
    });

    it('does nothing when cancelled', async () => {
      dialogShowMessageBox.mockResolvedValueOnce({ response: 0 });
      seed({ 'auth-meta.json': '{}' });
      const res = await handlers['app:factory-reset']();
      expect(res).toEqual({ ok: false, cancelled: true });
      expect(existsSync(path.join(bottegaDir, 'auth-meta.json'))).toBe(true);
      expect(appRelaunch).not.toHaveBeenCalled();
      expect(appExit).not.toHaveBeenCalled();
    });
  });

  it('survives missing files — idempotent', async () => {
    // Empty .bottega dir.
    readdirSync(bottegaDir); // sanity
    const res = await handlers['app:reset-auth']();
    expect(res.ok).toBe(true);
  });
});
