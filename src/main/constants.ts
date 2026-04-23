/**
 * Leaf-module constants shared across main-process modules. Kept in its own
 * file to avoid circular imports — every other main module can import from
 * here without pulling in additional graph.
 */

/**
 * Sentinel `fileKey` used by multi-tab slots that have no connected Figma
 * file yet. Pairs with `slot-manager`'s slot bookkeeping and with
 * REST-tool `fileKey` guards in `tools/discovery.ts`.
 */
export const UNBOUND_FILE_KEY = '__unbound__'; // nosemgrep: hard-coded-password — sentinel value, not a password

/**
 * True when the app is running under the Playwright/e2e test harness (set via
 * the `BOTTEGA_TEST_MODE` env var by `tests/e2e/helpers/launch.mjs`). Centralized
 * so each consumer checks the same flag and the env-var name lives in one place.
 */
export const isTestMode = (): boolean => !!process.env.BOTTEGA_TEST_MODE;
