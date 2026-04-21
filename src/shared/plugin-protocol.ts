/**
 * Protocol version for the Figma Desktop Bridge ↔ main handshake.
 *
 * This constant MUST stay in sync with `PLUGIN_VERSION` in
 * `figma-desktop-bridge/ui.html`. When either side bumps the number, update
 * both together — a mismatch closes the WebSocket with code 4001
 * (VERSION_MISMATCH) and the user sees "Figma non connesso" with no hint
 * as to why.
 */
export const PLUGIN_PROTOCOL_VERSION = 2;
