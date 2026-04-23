/**
 * Ambient globals used by the main process for test-harness introspection.
 * Consuming both tests and `src/main/tools/index.ts` can read/write these
 * without ad-hoc casts.
 */
export {};

declare global {
  var __BOTTEGA_TOOL_NAMES__: readonly string[] | undefined;
}
