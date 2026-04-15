/**
 * Shared credential + storage shapes for auth-related modules.
 *
 * Pi SDK's AuthStorage exposes an internal `AuthCredential` union; this file
 * re-states the shape for Bottega-internal consumption so downstream modules
 * (auth-meta, auth-refresh, startup-auth, model-probe) don't each redeclare
 * anonymous types — previously a drift trap.
 */

export interface ApiKeyCredential {
  type: 'api_key';
  key: string;
}

export interface OAuthCredential {
  type: 'oauth';
  /** Newer Pi SDK OAuth credentials. */
  access?: string;
  /** Older naming — kept for forward-compat with stored files. */
  accessToken?: string;
  refresh?: string;
  refreshToken?: string;
}

export type StoredCredential = ApiKeyCredential | OAuthCredential;

/** Extract the bearer token from any credential shape. */
export function readToken(cred: StoredCredential | undefined | null): string {
  if (!cred) return '';
  if (cred.type === 'api_key') return cred.key ?? '';
  return cred.access ?? cred.accessToken ?? '';
}
