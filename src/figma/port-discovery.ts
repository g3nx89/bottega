/**
 * Port Discovery
 *
 * Simplified for Figma Companion — uses fixed port 9223.
 */

/** Default WebSocket port */
export const DEFAULT_WS_PORT = 9223;

/**
 * Returns the configured port (always 9223 for Figma Companion).
 */
export function getPort(): number {
  return DEFAULT_WS_PORT;
}
