/**
 * Configuration for Bottega
 */

export interface FigmaConfig {
  port: number;
  figmaToken?: string;
}

export function getDefaultConfig(): FigmaConfig {
  return { port: 9223 };
}
