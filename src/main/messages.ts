/**
 * Centralized user-facing strings for the main process.
 *
 * All strings shown to users via dialogs, IPC error responses, or status messages
 * live here. When i18n is added, this module becomes the integration point for
 * a translation framework — swap the exports for locale-aware lookups.
 *
 * Renderer-side strings (HTML, app.js) are separate and handled in the UI layer.
 */

// ── Startup & Instance Lock ──────────────────

export const MSG_PORT_IN_USE_TITLE = 'Port in use';
export const MSG_PORT_IN_USE_BODY = (port: number) =>
  `Port ${port} is already in use by another process.\n\n` +
  'Bottega cannot connect to Figma until the port is freed.\n' +
  'Close the process that is using it and restart Bottega.';

export const MSG_STARTUP_ERROR_TITLE = 'Startup error';
export const MSG_STARTUP_ERROR_BODY = (err: unknown) =>
  `Bottega failed to start: ${err instanceof Error ? err.message : String(err)}`;

// ── Agent & Prompt ───────────────────────────

export const MSG_NO_CREDENTIALS =
  'No credentials configured for this model. Open Settings to log in or add an API key.';

export const MSG_REQUEST_FAILED_FALLBACK = 'Request failed. Check your credentials in Settings.';

// ── Auth / Login ─────────────────────────────

export const MSG_UNKNOWN_PROVIDER = (provider: string) => `Unknown provider: ${provider}`;
export const MSG_LOGIN_IN_PROGRESS = 'Login already in progress';
export const MSG_LOGIN_CANCELLED = 'Login cancelled';
export const MSG_GOOGLE_PROJECT_REQUIRED =
  'This Google account requires a Cloud Project ID. Enter your Google Cloud Project ID in the field below and try again.';
export const MSG_PASTE_AUTH_CODE = 'Paste the authorization code or callback URL:';
export const MSG_PASTE_AUTH_CODE_PLACEHOLDER = 'Code or URL…';

// ── Image Generation ─────────────────────────

export const MSG_IMAGEGEN_NOT_INITIALIZED = 'Image generation not initialized';

// ── Figma Plugin ─────────────────────────────

export const MSG_PLUGIN_NOT_FOUND = 'Plugin files not found in app bundle.';

// ── Diagnostics ──────────────────────────────

export const MSG_EXPORT_DIALOG_TITLE = 'Export Diagnostics';
export const MSG_EXPORT_FILTER_NAME = 'ZIP Archive';
