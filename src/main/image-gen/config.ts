import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonOrQuarantine } from '../fs-utils.js';

const CONFIG_DIR = path.join(os.homedir(), '.bottega');
const CONFIG_PATH = path.join(CONFIG_DIR, 'imagegen.json');

export interface ImageGenSettings {
  apiKey?: string;
  model?: string;
}

/**
 * Return the user-provided API key, or empty string. Image generation is
 * disabled when this returns ''. Bottega does not ship a fallback key —
 * users provide their own from aistudio.google.com/apikey.
 */
export function effectiveApiKey(settings: ImageGenSettings): string {
  return settings.apiKey || '';
}

/** Load settings synchronously (used once at startup). */
export function loadImageGenSettings(): ImageGenSettings {
  const parsed = readJsonOrQuarantine<ImageGenSettings>(
    CONFIG_PATH,
    (v): v is ImageGenSettings => !!v && typeof v === 'object' && !Array.isArray(v),
  );
  return parsed ?? {};
}

/** Save settings asynchronously (used from IPC handlers). */
export async function saveImageGenSettings(settings: ImageGenSettings): Promise<void> {
  await fs.promises.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(settings), { encoding: 'utf8', mode: 0o600 });
}
