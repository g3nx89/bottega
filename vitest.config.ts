import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

export default defineConfig({
  define: { '__APP_VERSION__': JSON.stringify(pkg.version) },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/main/**/*.ts'],
      exclude: ['src/main/index.ts', 'src/main/preload.ts', 'src/main/agent.ts'],
      reporter: ['text', 'text-summary'],
      thresholds: {
        statements: 75,
        branches: 69,
        functions: 74,
        lines: 76,
      },
    },
  },
});
