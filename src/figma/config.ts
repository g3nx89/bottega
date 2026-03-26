/**
 * Configuration for Bottega
 */

import { DEFAULT_WS_PORT } from './port-discovery.js';

export interface FigmaConfig {
  port: number;
  figmaToken?: string;
}

export function getDefaultConfig(): FigmaConfig {
  return { port: DEFAULT_WS_PORT };
}
