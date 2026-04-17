/**
 * Figma plugin sync — copy bundled plugin files to userData and auto-register
 * in Figma's settings.json when possible. Used by app startup and by the
 * manual install IPC handler.
 */

import { execFile } from 'node:child_process';
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import { createChildLogger } from '../figma/logger.js';
import { MSG_PLUGIN_NOT_FOUND } from './messages.js';

const PLUGIN_MANIFEST = 'manifest.json';
const PLUGIN_ID = 'bottega-bridge';
const PLUGIN_NAME = 'Bottega Bridge';
const pluginLog = createChildLogger({ component: 'plugin-sync' });

function getPluginSourcePath(): string | null {
  const candidates = [
    join(process.resourcesPath, 'figma-desktop-bridge'),
    join(app.getAppPath(), 'figma-desktop-bridge'),
    // Dev mode: app.getAppPath() points to dist/, plugin is at project root
    join(app.getAppPath(), '..', 'figma-desktop-bridge'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, PLUGIN_MANIFEST))) return dir;
  }
  return null;
}

export function getPluginTargetPath(): string {
  return join(app.getPath('userData'), 'figma-plugin');
}

/** Absolute path to the installed plugin manifest (for shell.showItemInFolder and existsSync checks). */
export function getInstalledManifestPath(): string {
  return join(getPluginTargetPath(), PLUGIN_MANIFEST);
}

function getFigmaSettingsPath(): string {
  return join(homedir(), 'Library', 'Application Support', 'Figma', 'settings.json');
}

const execFileAsync = promisify(execFile);

async function isFigmaRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('pgrep', ['-x', 'Figma'], { timeout: 3000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

interface FigmaExtEntry {
  id: number;
  manifestPath: string;
  lastKnownName?: string;
  lastKnownPluginId?: string;
  fileMetadata: {
    type: 'manifest' | 'code' | 'ui';
    codeFileId?: number;
    uiFileIds?: number[];
    manifestFileId?: number;
  };
}

/** Read-only check: is the plugin already registered in Figma's settings.json? Safe to call anytime. */
function isPluginRegistered(): boolean {
  try {
    const raw = readFileSync(getFigmaSettingsPath(), 'utf-8');
    const settings = JSON.parse(raw);
    const extensions: FigmaExtEntry[] = settings.localFileExtensions ?? [];
    return extensions.some((e) => e.fileMetadata?.type === 'manifest' && e.lastKnownPluginId === PLUGIN_ID);
  } catch {
    return false;
  }
}

/**
 * Check if plugin is registered in Figma's settings.json; if not, append entries.
 * Single file read — avoids double parse. Never removes existing entries.
 * Must only be called when Figma is NOT running (Figma overwrites on exit).
 * Returns 'already' if already registered, 'registered' if newly added, 'failed' otherwise.
 */
function ensurePluginRegistered(pluginDir: string): 'already' | 'registered' | 'failed' {
  const settingsPath = getFigmaSettingsPath();
  let settings: any;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      pluginLog.warn('Figma settings.json not found — cannot auto-register plugin');
    } else {
      pluginLog.warn({ err }, 'Failed to read Figma settings');
    }
    return 'failed';
  }

  try {
    const extensions: FigmaExtEntry[] = settings.localFileExtensions ?? [];

    if (extensions.some((e) => e.fileMetadata?.type === 'manifest' && e.lastKnownPluginId === PLUGIN_ID)) {
      return 'already';
    }

    const maxId = extensions.reduce((max, e) => Math.max(max, e.id), 0);
    const mId = maxId + 1;
    const cId = maxId + 2;
    const uId = maxId + 3;

    extensions.push(
      {
        id: mId,
        manifestPath: join(pluginDir, 'manifest.json'),
        lastKnownName: PLUGIN_NAME,
        lastKnownPluginId: PLUGIN_ID,
        fileMetadata: { type: 'manifest', codeFileId: cId, uiFileIds: [uId] },
      },
      {
        id: cId,
        manifestPath: join(pluginDir, 'code.js'),
        fileMetadata: { type: 'code', manifestFileId: mId },
      },
      {
        id: uId,
        manifestPath: join(pluginDir, 'ui.html'),
        fileMetadata: { type: 'ui', manifestFileId: mId },
      },
    );

    settings.localFileExtensions = extensions;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    pluginLog.info({ mId, pluginDir }, 'Plugin auto-registered in Figma settings.json');
    return 'registered';
  } catch (err) {
    pluginLog.warn({ err }, 'Failed to auto-register plugin in Figma settings');
    return 'failed';
  }
}

export interface PluginSyncResult {
  synced: boolean;
  autoRegistered: boolean;
  alreadyRegistered: boolean;
  figmaRunning: boolean;
  error?: string;
}

/** Check if installed plugin files differ from the bundled source. */
function pluginNeedsSync(src: string, dest: string): boolean {
  try {
    for (const file of [PLUGIN_MANIFEST, 'code.js', 'ui.html']) {
      const srcFile = join(src, file);
      const destFile = join(dest, file);
      // Size mismatch is a cheap early-out. Identical sizes still need a byte
      // compare — same-length edits (e.g. PLUGIN_VERSION 1→2) would slip past
      // a size-only check and leave the dest stale.
      const srcSize = statSync(srcFile).size;
      let destSize: number;
      try {
        destSize = statSync(destFile).size;
      } catch {
        return true;
      }
      if (srcSize !== destSize) return true;
      if (!readFileSync(srcFile).equals(readFileSync(destFile))) return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Sync plugin files from app bundle to userData and auto-register in Figma if needed.
 * Called at startup and from the manual install IPC handler.
 */
export async function syncFigmaPlugin(): Promise<PluginSyncResult> {
  const src = getPluginSourcePath();
  if (!src) {
    pluginLog.warn('Plugin source not found — skipping sync');
    return {
      synced: false,
      autoRegistered: false,
      alreadyRegistered: false,
      figmaRunning: false,
      error: MSG_PLUGIN_NOT_FOUND,
    };
  }

  const dest = getPluginTargetPath();
  try {
    if (pluginNeedsSync(src, dest)) {
      cpSync(src, dest, { recursive: true, force: true });
      pluginLog.info({ dest }, 'Plugin files synced');
    }
  } catch (err: any) {
    pluginLog.error({ err }, 'Failed to sync plugin files');
    return { synced: false, autoRegistered: false, alreadyRegistered: false, figmaRunning: false, error: err.message };
  }

  const figmaRunning = await isFigmaRunning();
  let autoRegistered = false;
  let alreadyRegistered = isPluginRegistered();

  if (!alreadyRegistered && !figmaRunning) {
    const result = ensurePluginRegistered(dest);
    alreadyRegistered = result === 'already';
    autoRegistered = result === 'registered';
  }

  return { synced: true, autoRegistered, alreadyRegistered, figmaRunning };
}
