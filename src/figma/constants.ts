/**
 * Shared constants for the Figma layer. Separate from `errors.ts` so
 * non-error modules (e.g. `figma-api.ts` header selection) can import token
 * prefixes without pulling in the full error-handling graph.
 */

/**
 * Figma access-token prefixes. PATs are issued as `figd_*`; OAuth bearer
 * tokens are `figu_*`. Used for header-scheme selection and as the source
 * of truth for the fallback redaction regex.
 */
export const FIGMA_PAT_PREFIX = 'figd_';
export const FIGMA_OAUTH_PREFIX = 'figu_';
