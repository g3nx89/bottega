/**
 * Ambient globals used by the main process for test-harness introspection.
 * Consuming both tests and `src/main/tools/index.ts` can read/write these
 * without ad-hoc casts.
 */
export {};

declare global {
  // eslint-disable-next-line no-var
  var __BOTTEGA_TOOL_NAMES__: readonly string[] | undefined;
}
