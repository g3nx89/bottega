// @vitest-environment happy-dom

import { createRequire } from 'node:module';
import { beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

type Guard = {
  advance(): number;
  isCurrent(gen: number): boolean;
  value(): number;
};

beforeEach(() => {
  delete require.cache[require.resolve('../../../src/renderer/generation-guard.js')];
  require('../../../src/renderer/generation-guard.js');
});

describe('createGenerationGuard', () => {
  it('exposes createGenerationGuard on the window global', () => {
    expect(typeof (window as any).createGenerationGuard).toBe('function');
  });

  it('advance() returns a monotonic counter starting at 1', () => {
    const guard: Guard = (window as any).createGenerationGuard();
    expect(guard.value()).toBe(0);
    expect(guard.advance()).toBe(1);
    expect(guard.advance()).toBe(2);
    expect(guard.value()).toBe(2);
  });

  it('isCurrent(gen) is true only for the most recent advance()', () => {
    const guard: Guard = (window as any).createGenerationGuard();
    const gen1 = guard.advance();
    expect(guard.isCurrent(gen1)).toBe(true);
    const gen2 = guard.advance();
    expect(guard.isCurrent(gen1)).toBe(false);
    expect(guard.isCurrent(gen2)).toBe(true);
  });

  it('guards are independent: one instance does not affect another', () => {
    const a: Guard = (window as any).createGenerationGuard();
    const b: Guard = (window as any).createGenerationGuard();
    a.advance();
    a.advance();
    const genB = b.advance();
    expect(b.isCurrent(genB)).toBe(true);
    expect(a.value()).toBe(2);
    expect(b.value()).toBe(1);
  });

  it('simulates the stale-write pattern: older generation is discarded', async () => {
    const guard: Guard = (window as any).createGenerationGuard();
    const writes: string[] = [];

    async function simulatedWrite(label: string, delayMs: number) {
      const gen = guard.advance();
      await new Promise((r) => setTimeout(r, delayMs));
      if (!guard.isCurrent(gen)) return;
      writes.push(label);
    }

    // Start slow write first, fast write second — fast wins, slow bails out.
    const slow = simulatedWrite('slow', 30);
    const fast = simulatedWrite('fast', 5);
    await Promise.all([slow, fast]);
    expect(writes).toEqual(['fast']);
  });
});
