import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'figma-desktop-bridge/', 'src/renderer/', 'scripts/', 'tests/'] },
  {
    files: ['src/**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true },
    },
    rules: {
      // ── Type-aware rules (the reason ESLint exists here) ──
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',

      // ── Import boundaries (electron only in entry points) ──
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['electron'],
          message: 'Import electron solo nei file autorizzati (index.ts, preload.ts, ipc-handlers.ts, auto-updater.ts, diagnostics.ts, startup-guards.ts, safe-send.ts)',
        }],
      }],

      // ── IPC boundary: ipcMain.handle only in ipc-handlers.ts ──
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.object.name='ipcMain'][callee.property.name='handle']",
        message: 'ipcMain.handle() deve stare in ipc-handlers.ts',
      }],

      // ── Disable everything Biome already covers or not relevant ──
      // TODO: re-enable incrementally as codebase matures — tracked in TECH-DEBT.md
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/restrict-plus-operands': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/unified-signatures': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      '@typescript-eslint/no-invalid-void-type': 'off',
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/use-unknown-in-catch-variables': 'off',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unnecessary-type-parameters': 'off',
      '@typescript-eslint/no-unnecessary-template-expression': 'off',
      '@typescript-eslint/no-useless-default-assignment': 'off',
      '@typescript-eslint/prefer-reduce-type-parameter': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/related-getter-setter-pairs': 'off',
      '@typescript-eslint/no-deprecated': 'off',
    },
  },
  // Allow electron imports in entry points and infrastructure files
  {
    files: [
      'src/main/index.ts',
      'src/main/preload.ts',
      'src/main/ipc-handlers.ts',
      'src/main/ipc-handlers-auth.ts',
      'src/main/ipc-handlers-figma-auth.ts',
      'src/main/ipc-handlers-reset.ts',
      'src/main/figma-auth-store.ts',
      'src/main/auto-updater.ts',
      'src/main/diagnostics.ts',
      'src/main/startup-guards.ts',
      'src/main/safe-send.ts',
    ],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
      // index.ts has AuthStorage stubs with async () => undefined to match the real async interface
      '@typescript-eslint/require-await': 'off',
    },
  },
  // Disable require-await where async is mandated by Pi SDK interfaces
  // (ToolDefinition.execute returns Promise<AgentToolResult>, pi.on handler
  // accepts Promise<any>|any, AuthStorage.getApiKey is async in the real impl)
  {
    files: [
      'src/main/tools/**/*.ts',
      'src/main/compression/extension-factory.ts',
      'src/main/figma-core.ts',
    ],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
);
