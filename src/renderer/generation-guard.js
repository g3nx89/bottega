(() => {
  'use strict';

  /**
   * Monotonic counter + guard pair for fire-and-forget async writes.
   *
   * Usage:
   *   const guard = window.createGenerationGuard();
   *   const gen = guard.advance();
   *   const value = await fetchSomething();
   *   if (!guard.isCurrent(gen)) return; // a newer advance() superseded us
   *   writeState(value);
   *
   * Models the same pattern as captureTurnGuard() in src/main/session-events.ts
   * so renderer hot paths (tab switch, effort sync, rewind bind) can discard
   * stale writes instead of letting them overwrite newer state.
   */
  function createGenerationGuard() {
    let current = 0;
    return {
      advance() {
        current += 1;
        return current;
      },
      isCurrent(gen) {
        return gen === current;
      },
      value() {
        return current;
      },
    };
  }

  window.createGenerationGuard = createGenerationGuard;
})();
