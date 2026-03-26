/**
 * Port Discovery
 *
 * Bottega uses a fixed port (9280) distinct from figma-console-mcp (9223-9232)
 * to prevent cross-tool conflicts when both run simultaneously.
 */

/** Default WebSocket port for Bottega Bridge. */
export const DEFAULT_WS_PORT = 9280;

/** Returns the configured port (always 9280 for Bottega). */
export function getPort(): number {
  return DEFAULT_WS_PORT;
}
