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

export const MSG_EMPTY_TURN_WARNING =
  "I wasn't able to generate a response. This usually means your API key or login session has expired. Please check your credentials in Settings.";

// F13: actionable messages routed by llm_stream_error httpStatus.
export const MSG_ERR_UNAUTHORIZED = (provider: string) => `Session expired. Open Settings and re-login to ${provider}.`;
export const MSG_ERR_FORBIDDEN = (modelId: string, provider: string) =>
  `Model ${modelId} is not available on your ${provider} plan.`;
export const MSG_ERR_NOT_FOUND = (modelId: string, provider: string) =>
  `Model ${modelId} not recognized by ${provider}. Try another model.`;
export const MSG_ERR_RATE_LIMIT = (retryAfterSeconds?: number) =>
  retryAfterSeconds
    ? `Rate limit hit. Wait ${retryAfterSeconds}s and retry.`
    : 'Rate limit hit. Wait a moment and retry.';
export const MSG_ERR_PROVIDER_UNAVAILABLE = (provider: string) =>
  `${provider} is currently unavailable. Retry in a moment.`;
export const MSG_ERR_STREAM_EMPTY = 'The model returned an empty response. Try another model or check credentials.';

/** F13: Route an HTTP status + context to a user-facing message. */
export function messageForStreamError(
  httpStatus: number | null,
  provider: string,
  modelId: string,
  retryAfterSeconds?: number,
): string {
  if (httpStatus === 401) return MSG_ERR_UNAUTHORIZED(provider);
  if (httpStatus === 403) return MSG_ERR_FORBIDDEN(modelId, provider);
  if (httpStatus === 404) return MSG_ERR_NOT_FOUND(modelId, provider);
  if (httpStatus === 429) return MSG_ERR_RATE_LIMIT(retryAfterSeconds);
  if (httpStatus !== null && httpStatus >= 500) return MSG_ERR_PROVIDER_UNAVAILABLE(provider);
  return MSG_ERR_STREAM_EMPTY;
}

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
export const MSG_PLUGIN_UPDATED = (pluginVersion: number, requiredVersion: number) =>
  `The Figma plugin has been updated (v${pluginVersion} \u2192 v${requiredVersion}). ` +
  'Close the plugin in Figma and re-run it from Plugins \u2192 Development \u2192 Bottega Bridge.';
export const MSG_BRIDGE_NOT_CONNECTED = (fileKey: string) =>
  `Figma Bridge not connected for file ${fileKey} \u2014 open the Bridge plugin in Figma Desktop on this file, then retry.`;

// ── Diagnostics ──────────────────────────────

export const MSG_EXPORT_DIALOG_TITLE = 'Export Diagnostics';
export const MSG_EXPORT_FILTER_NAME = 'ZIP Archive';
