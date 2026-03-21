import fs from 'fs';
import os from 'os';
import path from 'path';

const CONFIG_DIR = path.join(os.homedir(), '.figma-cowork');
const CONFIG_PATH = path.join(CONFIG_DIR, 'imagegen.json');

export const DEFAULT_IMAGEGEN_API_KEY = 'AIzaSyA8-13dueNNhNCCqbTNzO3A1em9dAbd_Bg';

export interface ImageGenSettings {
  apiKey?: string;
  model?: string;
}

/** Return the user's key if set, otherwise the built-in default. */
export function effectiveApiKey(settings: ImageGenSettings): string {
  return settings.apiKey || DEFAULT_IMAGEGEN_API_KEY;
}

/** Load settings synchronously (used once at startup). */
export function loadImageGenSettings(): ImageGenSettings {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** Save settings asynchronously (used from IPC handlers). */
export async function saveImageGenSettings(settings: ImageGenSettings): Promise<void> {
  await fs.promises.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(CONFIG_PATH, JSON.stringify(settings), { encoding: 'utf8', mode: 0o600 });
}
