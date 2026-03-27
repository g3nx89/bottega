import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = path.join(os.homedir(), '.bottega');
const CONFIG_PATH = path.join(CONFIG_DIR, 'imagegen.json');

// Never hardcode secrets — load from environment.
export const DEFAULT_IMAGEGEN_API_KEY = process.env.BOTTEGA_GEMINI_KEY ?? process.env.FIGMA_COWORK_GEMINI_KEY ?? '';

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
