import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts'],
      exclude: ['src/main/index.ts', 'src/main/preload.ts', 'src/main/agent.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
});
